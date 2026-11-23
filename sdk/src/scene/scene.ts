// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from '../ecs/world';
import { type Entity, INVALID_ENTITY } from '../types';
import { upgradeEntityComponents } from './legacyComponents';
import { isPrefabEntry, type SceneEntry } from './sceneEntry';
import { canDefer, cutToRoot, isDeferredInstance, rootOnly, rootOverrides, type DeferredRecord, VARIANT_KEY } from '../prefab/deferred';
import { expandVirtualRequested, registerDeferredInstances } from './deferredInstances';
import { validateScene } from './validateScene';
import { discardSceneEntities, runSceneLoad, scenePhaseRunner } from './sceneLoadAttempt';
import { getComponent, Name, Camera, RuntimeOnly, Disabled } from '../ecs/component';
import { deepClone } from '../util/deepClone';
import { AssetScope } from '../asset/AssetLease';
import type { PrefabResult } from '../asset/AssetLoader';
import { requireResourceManager } from '../wasm/resourceManager';
import { validateComponentData, formatValidationErrors } from '../util/validation';
import { log } from '../util/logger';
import { prepareSpawnOwnership, type PreparedSpawnOwnership } from '../prefab/preparedAssetOwnership';
import { ESTELLA_SCENE_GENERATOR } from '../util/provenance';
import {
    expandEntry,
    preloadNestedPrefabs,
    migratePrefabData,
    type PrefabData,
    type ProcessedEntity,
} from '../prefab/index';

// =============================================================================
// Types
// =============================================================================

export interface SceneEntityData {
    id: number;
    name: string;
    parent: number | null;
    children: number[];
    components: SceneComponentData[];
    visible?: boolean;
}

export interface SceneComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface SliceBorder {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface TextureMetadata {
    version: string;
    type: 'texture';
    sliceBorder: SliceBorder;
}

export interface SceneData {
    /**
     * Format version: one integer that only counts up. Files written before it
     * became an integer carry a `"major.minor"` string, which
     * {@link migrateSceneData} normalizes — read it through
     * {@link parseSceneFormatVersion}, never by comparing it directly.
     */
    version: number | string;
    name: string;
    /** Origin tag of the engine that wrote this scene (see provenance.ts). */
    generator?: string;
    entities: SceneEntityData[];
    textureMetadata?: Record<string, TextureMetadata>;
    /**
     * Set by {@link expandScenePrefabs} on the scene it answers, never written to a file: the virtual instances it left as roots
     * alone, and what each is made from. The loader hands them to the world once the entities exist.
     */
    deferredInstances?: DeferredRecord[];
}

export interface LoadedSceneAssets {
    texturePaths: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
    /**
     * The receipts the preload produced, handed to whoever owns the scene.
     * Present means the owner releases through these and must not also release
     * the same assets by path — that is the double free this replaces.
     */
    scope?: import('../asset/AssetLease').AssetScope;
}

/** Settled asset preparations and their total. Joining an in-flight scene load replays its latest counts.
 *  @beta */
export type SceneLoadProgressCallback = (loaded: number, total: number) => void;

export type MissingAssetCallback = (missing: import('../asset/Assets').MissingAsset[]) => void;

export interface SceneLoadOptions {
    assets?: import('../asset/Assets').Assets;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
    onProgress?: SceneLoadProgressCallback;
    /** @internal Verify the owning scene before prepared work enters the World. */
    assertCurrent?: () => void;
    /**
     * Invoked once during load with the list of asset refs that could not
     * be loaded (unresolved UUID or fetch failure). Fires even if the list
     * is empty — callers that want "missing asset" UI wire this up.
     */
    onMissingAssets?: MissingAssetCallback;
    /**
     * If true, throw after preloading when any asset is missing; the
     * scene is not spawned. Default is false (legacy behaviour: missing
     * assets get handle 0, scene loads anyway).
     */
    abortOnMissingAssets?: boolean;
    /**
     * Authored ids this document may reference that live in another one — the
     * persistent rows a streamed cell is allowed to name. Absent = a reference
     * outside the document resolves to nothing, which is what it always did.
     */
    externalEntities?: ReadonlyMap<number, Entity>;
    /**
     * Where a load's time went, phase by phase. Most of it runs between frames —
     * off every system timer there is — so a profiler watching the frame loop
     * sees the cost and cannot say what it was.
     *
     * A name may be dotted, and a dot means containment: `spawn.components` is
     * part of `spawn`, so a reader sums the roots and never the whole list.
     */
    onPhase?: ScenePhaseSink;
}

/**
 * Where a load's time went. Dotted names nest; see {@link SceneLoadOptions.onPhase}.
 *
 * @experimental
 */
export type ScenePhaseSink = (phase: string, ms: number) => void;

export class MissingAssetsError extends Error {
    readonly missing: import('../asset/Assets').MissingAsset[];
    constructor(missing: import('../asset/Assets').MissingAsset[]) {
        super(`Scene load aborted: ${missing.length} asset(s) missing`);
        this.name = 'MissingAssetsError';
        this.missing = missing;
    }
}

// =============================================================================
// Asset Field Types
// =============================================================================

/**
 * The asset kinds a component field may hold — a closed set, because each one
 * names a registered loader. Adding one means adding the loader too.
 *
 * @public
 */
export type AssetFieldType = 'terrain-layer' | 'terrain-layer-info' | 'physical-material' | 'image' | 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'sound-event' | 'video' | 'tilemap' | 'tileset' | 'timeline' | 'statemachine' | 'behaviortree' | 'scriptgraph' | 'animatorcontroller' | 'avatar' | 'mesh' | 'environment' | 'probeVolume' | 'prefab' | 'groom';

// =============================================================================
// Component Query Helpers (read from self-describing ComponentDef)
// =============================================================================

export function getComponentAssetFields(componentType: string): string[] {
    const comp = getComponent(componentType);
    if (!comp) return [];
    const fields: string[] = [];
    for (const { field } of comp.assetFields) {
        fields.push(field);
    }
    if (comp.skeletalFields) {
        fields.push(comp.skeletalFields.skeletonField);
        fields.push(comp.skeletalFields.atlasField);
    }
    return fields;
}

export function getComponentAssetFieldDescriptors(
    componentType: string,
): readonly { field: string; type: AssetFieldType }[] {
    return getComponent(componentType)?.assetFields ?? [];
}

/** The skeleton/atlas pair a component carries, and whose runtime it belongs to. */
export function getComponentSkeletalFieldDescriptor(
    componentType: string,
): { skeletonField: string; atlasField: string; runtime: string } | null {
    return getComponent(componentType)?.skeletalFields ?? null;
}

// =============================================================================
// Entity Reference Remapping
// =============================================================================

/**
 * Resolve a document's entity references to live entities.
 *
 * `external` answers for authored ids that live in ANOTHER document — the rows a
 * streamed cell is allowed to name in the persistent world. An id neither map
 * knows is cleared, never left as a number that names a different entity.
 */
export function remapEntityFields(
    compData: SceneComponentData,
    entityMap: Map<number, Entity>,
    external?: ReadonlyMap<number, Entity>,
): void {
    const comp = getComponent(compData.type);
    if (!comp || comp.entityFields.length === 0) return;
    const data = compData.data as Record<string, unknown>;
    const remap = (editorId: unknown): unknown => {
        if (typeof editorId !== 'number' || editorId === INVALID_ENTITY) return editorId;
        // No entity has a negative id: one is a field's own "none", which older documents wrote as -1.
        if (editorId < 0) return INVALID_ENTITY;
        const runtimeId = entityMap.get(editorId) ?? external?.get(editorId);
        if (runtimeId === undefined) {
            log.warn(
                'scene',
                `Entity reference not found: ${compData.type}.${field} ` +
                `references entity ${editorId} which does not exist`,
            );
        }
        return runtimeId !== undefined ? runtimeId : INVALID_ENTITY;
    };
    // A field can name ONE entity or a list of them (a skin's joints). A list
    // that skipped this kept the document's own ids, which name other entities
    // at runtime — the reference silently resolves to the wrong thing.
    let field = '';
    for (field of comp.entityFields) {
        const value = data[field];
        data[field] = Array.isArray(value) ? value.map(remap) : remap(value);
    }
}

// =============================================================================
// Component serialization codecs (out-of-band data)
// =============================================================================

/**
 * Hook for a component whose full state does not fit the plain field record —
 * e.g. TilemapLayer's tile chunks live in a C++ blob. Registered by the owning
 * plugin (see tilemapPlugin) so the generic (de)serializer carries no
 * component-specific knowledge.
 */
export interface SceneComponentCodec {
    /** Serialize: write out-of-band state into the plain record. */
    exportData?(entity: number, data: Record<string, unknown>): void;
    /**
     * Out-of-band field keys. Stripped from `data` before validation/insert
     * (so the component insert doesn't choke on them) and passed to
     * {@link importData} after insert.
     */
    outOfBandFields?: readonly string[];
    /** Deserialize: reapply out-of-band state after the component is inserted. */
    importData?(entity: number, outOfBand: Record<string, unknown>): void;
}

const sceneComponentCodecs = new Map<string, SceneComponentCodec>();
const worldComponentCodecs = new WeakMap<World, Map<string, SceneComponentCodec>>();

/** @internal A world's component codecs take precedence over host defaults. */
export function registerWorldSceneComponentCodec(world: World, type: string, codec: SceneComponentCodec): () => void {
    let codecs = worldComponentCodecs.get(world);
    if (!codecs) worldComponentCodecs.set(world, codecs = new Map());
    codecs.set(type, codec);
    return () => {
        if (codecs.get(type) === codec) codecs.delete(type);
        if (codecs.size === 0) worldComponentCodecs.delete(world);
    };
}

export type SceneExportFilter = (entity: Entity, component: string, data: Record<string, unknown>) => void;

const worldExportFilters = new WeakMap<World, Set<SceneExportFilter>>();

/** @internal */
export function registerWorldSceneExportFilter(world: World, filter: SceneExportFilter): () => void {
    let filters = worldExportFilters.get(world);
    if (!filters) worldExportFilters.set(world, filters = new Set());
    filters.add(filter);
    return () => {
        filters.delete(filter);
        if (filters.size === 0) worldExportFilters.delete(world);
    };
}

function sceneComponentCodec(world: World, type: string): SceneComponentCodec | undefined {
    return worldComponentCodecs.get(world)?.get(type) ?? sceneComponentCodecs.get(type);
}

/** Register a custom (de)serializer for a component type. Idempotent. */
export function registerSceneComponentCodec(type: string, codec: SceneComponentCodec): void {
    sceneComponentCodecs.set(type, codec);
}

/**
 * What a component carries beside its fields — a MeshRenderer's inline `geometry`:
 * saved with the scene by its codec, but no field, so no inspector or set_field
 * reaches it. Empty for a component without such data.
 */
export function sceneOutOfBandFields(type: string): readonly string[] {
    return sceneComponentCodecs.get(type)?.outOfBandFields ?? declaredOutOfBand.get(type) ?? [];
}

// MeshRenderer's inline geometry, said here rather than by a top-level call in render/meshRenderer.ts: a statement there
// rides whichever shared chunk the bundler puts it in, and is lost with it when a game uses none of that chunk's names.
const declaredOutOfBand = new Map<string, readonly string[]>([['MeshRenderer', ['geometry']]]);

/**
 * @internal Say which data a component carries beside its fields before its codec
 * is installed (codecs install with their plugin, which a tool asking about a
 * component may never build).
 */
export function declareSceneOutOfBandFields(type: string, fields: readonly string[]): void {
    declaredOutOfBand.set(type, fields);
}

// =============================================================================
// Prefab instance entries (runtime play == ship)
// =============================================================================

/** True if any scene entry is a prefab instance (cheap gate before expansion). */
export function sceneHasPrefabEntries(scene: SceneData): boolean {
    return (scene.entities as SceneEntry[]).some(isPrefabEntry);
}

/** Resolves a prefab asset ref to its PrefabData, or null when unresolvable. */
export type PrefabAssetResolver = (ref: string) => Promise<PrefabData | null>;

/** Expansion copies the prefab documents. Their asset receipts end when the copy is complete. */
export async function expandScenePrefabAssets(
    scene: SceneData, assets: Pick<import('../asset/Assets').Assets, 'acquireTyped'>,
): Promise<SceneData> {
    checkSceneFormat(scene);
    const sources = new AssetScope();
    try {
        return await expandScenePrefabs(scene, async ref => {
            try {
                const lease = sources.add(await assets.acquireTyped<PrefabResult>('prefab', ref));
                return (lease.value.data as PrefabData) ?? null;
            } catch (error) {
                log.warn('scene', `Failed to load prefab "${ref}": ${error}`);
                return null;
            }
        });
    } finally { sources.releaseAll(); }
}

const toSceneEntityData = (e: ProcessedEntity): SceneEntityData => ({
    id: e.id,
    name: e.name,
    parent: e.parent,
    children: e.children,
    components: e.components,
    visible: e.visible,
});

/**
 * Expand every prefab-instance entry in a scene into ordinary entity records,
 * leaving non-prefab entities untouched. Each instance is flattened via
 * `expandEntry` (the shared prefab core) with its nested prefabs preloaded, so
 * the result is a plain SceneData ready for migration + spawn. Async because
 * resolving prefab (and nested-prefab) assets is async; an unresolvable prefab
 * drops that one instance with a warning rather than aborting the whole scene.
 */
export async function expandScenePrefabs(
    scene: SceneData,
    loadPrefab: PrefabAssetResolver,
    options?: { expandVirtual?: boolean },
): Promise<SceneData> {
    const expandVirtual = options?.expandVirtual ?? expandVirtualRequested();
    const entries = scene.entities as SceneEntry[];
    // Allocate fresh ids for expanded internals above every id already in the
    // file, so they never collide with non-prefab entities or instance roots
    // (which keep their stable scene id across save/load).
    let nextId = 0;
    for (const e of entries) nextId = Math.max(nextId, e.id);
    const allocateId = () => ++nextId;

    const out: SceneEntityData[] = [];
    const deferred: DeferredRecord[] = [];
    for (const entry of entries) {
        if (!isPrefabEntry(entry)) {
            out.push(entry);
            continue;
        }
        if (expandVirtual && entry.overrides.some((o) => o.type === 'metadata_set' && o.metadataKey === VARIANT_KEY)) continue;
        const raw = await loadPrefab(entry.prefab);
        if (!raw) {
            log.warn('scene', `Prefab instance "${entry.prefab}" could not be resolved; instance skipped`);
            continue;
        }
        const prefab = migratePrefabData(raw).data;
        // Preload nested prefabs into a cache so the sync flatten resolver never
        // misses — `flattenPrefab` throws on an unresolved nested ref.
        const cache = new Map<string, PrefabData>();
        try {
            await preloadNestedPrefabs(
                prefab,
                async (ref) => {
                    const d = await loadPrefab(ref);
                    if (!d) throw new Error(`nested prefab "${ref}" not found`);
                    return migratePrefabData(d).data;
                },
                cache,
            );
        } catch (e) {
            log.warn('scene', `Prefab instance "${entry.prefab}" has an unresolved nested prefab; instance skipped (${e})`);
            continue;
        }
        // A virtual instance is made as its root alone (see prefab/deferred.ts); instances inside it are left to whoever opens it.
        const virtual = !expandVirtual && isDeferredInstance(prefab, entry.overrides) && canDefer(entry.overrides, prefab)
            && entry.added.length === 0 && entry.removed.length === 0;
        const stub = virtual ? rootOnly(prefab) : null;
        const { entities: expanded, unresolved: unresolvedAll } = expandEntry(
            stub ?? prefab, stub ? { ...entry, overrides: rootOverrides(prefab, entry.overrides) } : entry, allocateId,
            (ref) => cache.get(ref) ?? null, expandVirtual ? undefined : deferred);
        const entities = virtual && !stub ? cutToRoot(expanded, entry.id) : expanded;
        const unresolved = virtual ? [] : unresolvedAll;
        if (virtual) deferred.push({ id: entry.id, prefab: entry.prefab, overrides: entry.overrides.map((o) => ({ ...o })) });
        if (unresolved.length > 0) {
            const targets = [...new Set(unresolved.map((o) => o.prefabEntityId))].join(', ');
            log.warn('scene', `Prefab instance "${entry.prefab}" (entity ${entry.id}) overrides `
                + `${unresolved.length} thing(s) on ${targets}, which the prefab has no entity for; `
                + 'those overrides change nothing');
        }
        for (const pe of entities) out.push(toSceneEntityData(pe));
    }
    return deferred.length > 0 ? { ...scene, entities: out, deferredInstances: deferred } : { ...scene, entities: out };
}

// =============================================================================
// Scene Migration — versioned, idempotent, non-mutating (mirrors prefab/migrate)
// =============================================================================

/**
 * Current scene format version — bump by one per migration step below.
 *
 * An integer, not semver: this number only has to answer "older, current, or
 * newer", and dotted ones cannot. `parseFloat` sorts "1.10" below "1.2".
 *
 * 2: `Light2D` and `Mesh2D` renamed to `Light` and `MeshRenderer`. An engine
 *    from before the rename reads the new names as components it has never
 *    heard of and drops them, which is a scene that loads and has no lights —
 *    so it must refuse the file instead, and the version is what tells it to.
 * 3: the flat physics components took the `2D` suffix the 3D ones already had
 *    (`RigidBody` → `RigidBody2D`, the four colliders, `CharacterController`).
 *    Same reasoning as 2, and worse here: an older engine drops the bodies and
 *    loads a level whose floor nothing collides with.
 * 4: the flat joints took the 3D set's words, which are also the industry's
 *    (`RevoluteJoint2D` → `HingeJoint2D`, prismatic → slider, weld → fixed).
 *    Same reasoning again: dropped joints load a machine whose parts fall apart.
 */
export const SCENE_FORMAT_VERSION = 4;

export interface SceneMigrationResult {
    /** A migrated *copy* — the input is never mutated. */
    data: SceneData;
    /** True if any legacy shape was upgraded (callers may prompt a re-save). */
    migrated: boolean;
    /** Retired engine components dropped, by name — an editor says which it
     *  upgraded away; a runtime load has no one to tell. */
    retired: string[];
    fromVersion: number;
    toVersion: number;
}

/**
 * The format version of a scene, however it was written. Everything from before
 * the integer scheme is format 1, so its leading digits are the whole answer.
 * Unreadable reads as 1, not 0: a scene with no version predates having one.
 */
export function parseSceneFormatVersion(v: unknown): number {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : 1;
    if (typeof v === 'string') {
        const leading = /^\s*(\d+)/.exec(v);
        if (leading) return Math.max(1, Number(leading[1]));
    }
    return 1;
}

/**
 * Component types retired by an engine upgrade. A scene authored before the
 * retirement still serializes them; {@link migrateSceneData} drops them so the
 * loader never warns "Unknown component type" on dead data, and the editor tells
 * them apart from genuinely-unknown project components (which it preserves). The
 * behaviour they encoded lives on in successor systems — the retired UI
 * StateMachine/StateVisuals pair is superseded by UIController($interaction) +
 * UIGear, which the widget prefabs now carry.
 */
export { RETIRED_COMPONENT_TYPES } from './legacyComponents';

/**
 * Components an engine upgrade renamed, old name to new. Exported because a
 * rename is not a loss, and anything comparing a released file against what
 * opening it yields has to be able to tell the two apart from one table rather
 * than a copy of it.
 */
export { RENAMED_COMPONENT_TYPES } from './legacyComponents';

/**
 * Upgrade a SceneData to the current format. Total + idempotent: already-current
 * data returns `migrated: false`; migrations are shape-driven so they no-op on
 * current scenes. Rejects data newer than this engine. Returns a deep copy, so
 * loading never mutates the caller's object (snapshots can be reloaded).
 */
export function migrateSceneData(raw: SceneData): SceneMigrationResult {
    const fromVersion = checkSceneFormat(raw);
    // Public inputs remain caller-owned. Internal builders can hand over their
    // fresh private records to the same normalization without copying them twice.
    return migrateOwnedSceneData(JSON.parse(JSON.stringify(raw)) as SceneData, fromVersion);
}

function checkSceneFormat(raw: SceneData): number {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entities)) {
        throw new Error('Scene data must have an "entities" array');
    }
    const fromVersion = parseSceneFormatVersion(raw.version);
    if (fromVersion > SCENE_FORMAT_VERSION) {
        throw new Error(
            `Scene format version ${fromVersion} is newer than this engine supports ` +
            `(${SCENE_FORMAT_VERSION}); upgrade the engine to load it.`,
        );
    }

    return fromVersion;
}

/**
 * Gives an entity numbered 0 the next id past the highest, and its parent and children the new id too, in place. Returns
 * whether it did.
 *
 * 0 is the "no entity" of every reference field (INVALID_ENTITY), so a field naming entity 0 named nothing: the loader
 * leaves 0 as 0, and the inspector writes 0 for both. A field that holds 0 is left as none, which is what it has always
 * loaded as; the entity can be named from now on. Only the hierarchy is renumbered, because nothing else could reach it.
 *
 * For an authoring tool opening a document, not for a loader: a caller that loads a scene keeps its own copy of the data
 * and looks entities up by the ids in it, so renumbering inside a load would lose entity 0 to every such lookup. The
 * editor renumbers what it opens; what it saves then holds no entity 0.
 *
 * @experimental
 */
export function renumberEntityZero(data: SceneData): boolean {
    const entries = data.entities as SceneEntry[];
    if (!entries.some((e) => e.id === 0)) return false;
    let highest = 0;
    for (const e of entries) if (e.id > highest) highest = e.id;
    const id = highest + 1;
    for (const e of entries) {
        if (e.id === 0) e.id = id;
        if (e.parent === 0) e.parent = id;
        const children = (e as SceneEntityData).children;
        if (Array.isArray(children)) for (let i = 0; i < children.length; i++) if (children[i] === 0) children[i] = id;
    }
    return true;
}

/** Normalize a document whose component records the loader owns. */
export function migrateOwnedSceneData(data: SceneData, fromVersion = checkSceneFormat(data)): SceneMigrationResult {
    let migrated = false;
    const retired = new Set<string>();
    for (const entity of data.entities) {
        // Prefab-instance entries carry no `components` to migrate; the async
        // loader expands them first, so any seen here belong to the sync path
        // and are left untouched (spawnAndLoadEntities warns + skips them).
        if (isPrefabEntry(entity)) continue;
        if (upgradeEntityComponents(entity, retired)) migrated = true;
    }

    data.version = SCENE_FORMAT_VERSION;
    return { data, migrated, retired: [...retired], fromVersion, toVersion: SCENE_FORMAT_VERSION };
}

// =============================================================================
// Scene Loader
// =============================================================================

/**
 * Findings that make a scene mean something other than what it says, where
 * loading is worse than refusing: a repeated id sends every reference to it to
 * whichever entity came last, and a parent cycle has no hierarchy to build.
 * Everything else still loads — a lost parent leaves an entity at the root.
 */
const UNLOADABLE_SCENE: ReadonlySet<string> = new Set(['duplicate-id', 'parent-cycle']);

/** Refuse a scene the loader cannot honour; report the rest and carry on. */
function checkLoadable(sceneData: SceneData): void {
    const diags = validateScene(sceneData);
    if (diags.length === 0) return;
    const fatal = diags.filter((d) => UNLOADABLE_SCENE.has(d.code));
    for (const d of diags) {
        if (!fatal.includes(d)) log.warn('scene', `${d.code}: ${d.message}`);
    }
    if (fatal.length > 0) {
        throw new Error(
            `Scene "${sceneData.name}" cannot be loaded as written:\n`
            + fatal.map((d) => `  ${d.code}: ${d.message}`).join('\n'),
        );
    }
}

/** What a staged spawn made: the entities by document id, and the roots it switched off until {@link revealStagedEntities}. */
export interface StagedSpawn {
    entities: Map<number, Entity>;
    /** Roots switched off while the rest arrived. An entity the author switched off is not among them, and stays off. */
    hidden: Entity[];
}

/**
 * {@link spawnAndLoadEntities} as a job: it yields how far along it is after every entity, so a caller with a per-frame
 * budget (a streamed cell) stops wherever the budget runs out and goes on the next frame.
 *
 * With `staged`, every root is switched off (`Disabled`) the moment it exists, so nothing sees a cell half arrived;
 * {@link revealStagedEntities} switches it on whole. A root the author switched off is left as written.
 */
export function* spawnAndLoadEntitiesJob(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    sink?: ScenePhaseSink, staged = false, spawn: StagedSpawn = { entities: new Map(), hidden: [] },
    assertCurrent?: () => void,
): Generator<number, StagedSpawn, void> {
    // One clock reading per component rather than two: the end of one write is
    // the start of the next, so attribution costs a call and not a pair. The
    // clock is reset after every pause, so a phase is charged its own work and
    // never the frames it waited through.
    const onPhase: ScenePhaseSink | undefined = sink && assertCurrent
        ? (phase, ms) => { sink(phase, ms); assertCurrent(); } : sink;
    let mark = onPhase ? performance.now() : 0;
    const since = (): number => {
        const now = performance.now();
        const elapsed = now - mark;
        mark = now;
        return elapsed;
    };
    const resume = (): void => {
        assertCurrent?.();
        if (onPhase) mark = performance.now();
    };
    assertCurrent?.();
    checkLoadable(sceneData);
    if (onPhase) onPhase('spawn.validate', since());
    const { entities: entityMap, hidden } = spawn;
    const rows = sceneData.entities.filter((entityData) => entityData.visible !== false && !isPrefabEntry(entityData));
    const total = Math.max(1, rows.length * 3);
    let done = 0;
    let completed = false;
    try {
        let skipped = 0;
        for (const entityData of sceneData.entities) {
            if (entityData.visible === false) continue;
            // A prefab-instance entry reaching here means the synchronous path was
            // used on an unexpanded prefab scene — it has no spawnable components.
            // Skip it (loadSceneWithAssets is the supported prefab-scene path).
            if (isPrefabEntry(entityData)) { skipped++; continue; }
            const entity = world.spawn();
            entityMap.set(entityData.id, entity);
            world.insert(entity, Name, { value: entityData.name });
            if (staged && entityData.parent === null && !entityData.components.some((c) => c.type === 'Disabled')) {
                world.insert(entity, Disabled, {});
                hidden.push(entity);
            }
            done++;
            yield done / total;
            resume();
        }
        if (skipped > 0) {
            log.warn('scene', 'Prefab-instance entry skipped in synchronous load; use loadSceneWithAssets to load prefab scenes');
        }
        if (staged) {
            // A child whose parent is not in this document (a cell parented to the persistent world) is a root here too.
            for (const entityData of rows) {
                if (entityData.parent === null || entityMap.has(entityData.parent)) continue;
                if (entityData.components.some((c) => c.type === 'Disabled')) continue;
                const entity = entityMap.get(entityData.id)!;
                world.insert(entity, Disabled, {});
                hidden.push(entity);
            }
        }
        if (onPhase) onPhase('spawn.entities', since());

        // By component TYPE, because "component writes" is a rename of the total
        // and not an answer: which writes reach a subsystem, and which are field
        // validation, is the difference between a mechanism and a number.
        const byType = onPhase ? new Map<string, number>() : null;
        for (const entityData of rows) {
            const entity = entityMap.get(entityData.id)!;
            for (const compData of entityData.components) {
                remapEntityFields(compData, entityMap, external);
                loadComponent(world, entity, compData, entityData.name);
                if (byType) byType.set(compData.type, (byType.get(compData.type) ?? 0) + since());
            }
            done++;
            yield done / total;
            resume();
        }
        if (onPhase && byType) {
            let total = 0;
            for (const [type, ms] of byType) {
                total += ms;
                onPhase(`spawn.components.${type}`, ms);
            }
            onPhase('spawn.components', total);
        }

        for (const entityData of sceneData.entities) {
            if (entityData.parent !== null) {
                const entity = entityMap.get(entityData.id);
                const parentEntity = entityMap.get(entityData.parent);
                if (entity !== undefined && parentEntity !== undefined) {
                    world.setParent(entity, parentEntity);
                    done++;
                    yield done / total;
                    resume();
                }
            }
        }
        if (onPhase) onPhase('spawn.hierarchy', since());
        completed = true;
        return spawn;
    } finally {
        if (!completed) discardSceneEntities(world, entityMap.values());
    }
}

/**
 * Switches on what a staged spawn switched off, whole, and tells every `Added` filter its components arrived now: the
 * arrival a system can see is the one when it is switched on. The other half of {@link spawnAndLoadEntitiesJob}.
 */
export function revealStagedEntities(world: World, spawn: StagedSpawn): void {
    for (const root of spawn.hidden) {
        if (world.valid(root) && world.has(root, Disabled)) world.remove(root, Disabled);
    }
    for (const entity of spawn.entities.values()) {
        if (world.valid(entity)) world.restampAdded(entity);
    }
}

/** Spawn private, migrated records. Binding entity references consumes those records. */
export function spawnAndLoadEntities(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    onPhase?: ScenePhaseSink, assertCurrent?: () => void,
): Map<number, Entity> {
    const job = spawnAndLoadEntitiesJob(world, sceneData, external, onPhase, false, undefined, assertCurrent);
    for (;;) {
        const next = job.next();
        if (next.done) return next.value.entities;
    }
}

export function loadSceneData(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    onPhase?: ScenePhaseSink,
): Map<number, Entity> {
    const began = onPhase ? performance.now() : 0;
    const { data } = migrateSceneData(sceneData);
    if (onPhase) onPhase('spawn.migrate', performance.now() - began);
    return spawnAndLoadEntities(world, data, external, onPhase);
}

/**
 * Reset the world to a previously-captured scene: despawn every current entity,
 * then reload `sceneData`. Used for editor play-state isolation (snapshot before
 * Play via {@link serializeScene}, restore on Stop), level restart, etc. Because
 * {@link loadSceneData} no longer mutates its input, the same snapshot can be
 * restored repeatedly. Entity ids change; the returned map is
 * snapshot-id → new entity for callers that need to remap references/selection.
 */
export function resetWorldTo(world: World, sceneData: SceneData): Map<number, Entity> {
    // getAllEntities returns a fresh array, so despawning as we go is safe; the
    // valid() guard tolerates despawn cascading to children.
    for (const entity of world.getAllEntities()) {
        if (world.valid(entity)) world.despawn(entity);
    }
    return loadSceneData(world, sceneData);
}

export async function loadSceneWithAssets(
    world: World,
    sceneData: SceneData,
    options?: SceneLoadOptions
): Promise<Map<number, Entity>> {
    const timed = scenePhaseRunner(options?.onPhase);
    // Expand prefab-instance entries first (via the same flattenPrefab core the
    // editor uses) so migration + asset resolution + spawn all operate on plain
    // entities — this is how a saved prefab scene achieves play == ship. The
    // prefab's own asset refs are resolved by the regular preload below.
    let scene = sceneData;
    if (options?.assets && sceneHasPrefabEntries(scene)) {
        const assets = options.assets;
        scene = await timed('prefab', () => expandScenePrefabAssets(scene, assets));
    }
    // Migrate up-front to a private copy; asset resolution + spawn all operate
    // on it, so the caller's SceneData is never mutated.
    const { data } = migrateSceneData(scene);
    return loadSceneAssetsAndSpawn(world, data, options, timed, scene.deferredInstances);
}

/**
 * Consume fresh private scene records from an internal builder. The builder must
 * have copied every mutable component and override value before handing them
 * over. Validation, migrations, asset resolution and spawning are shared with
 * the public scene loader; only its caller-protection copy is already paid.
 * @internal
 */
export async function loadOwnedSceneWithAssets(
    world: World, scene: SceneData, options?: SceneLoadOptions,
): Promise<Map<number, Entity>> {
    const timed = scenePhaseRunner(options?.onPhase);
    const { data } = migrateOwnedSceneData(scene);
    return loadSceneAssetsAndSpawn(world, data, options, timed);
}

async function loadSceneAssetsAndSpawn(
    world: World, data: SceneData, options: SceneLoadOptions | undefined,
    timed: ReturnType<typeof scenePhaseRunner>, deferred?: readonly DeferredRecord[],
): Promise<Map<number, Entity>> {
    return runSceneLoad(world, async attempt => {
        const assets = options?.assets, collector = options?.collectAssets;
        const assertCurrent = options?.assertCurrent;
        let ownership: PreparedSpawnOwnership | undefined;
        try {
            assertCurrent?.();
            if (assets) {
                const result = await timed('assets', async () => {
                    attempt.assets = await assets.preloadSceneAssets(data, options?.onProgress, { entityOwnership: !collector });
                    return attempt.assets;
                });
                assertCurrent?.();
                if (!collector && assets.entityScopes) {
                    ownership = prepareSpawnOwnership(data, result, assets.entityScopes, assets.resolveRef.bind(assets))?.();
                }
                options?.onMissingAssets?.(result.missing);
                if (options?.abortOnMissingAssets && result.missing.length > 0) {
                    throw new MissingAssetsError(result.missing);
                }
                assets.resolveSceneAssetPaths(data, result);
                applyTextureMetadata(data, result.textureHandles);
            }
            const entities = await timed('spawn', () => {
                attempt.entities = spawnAndLoadEntities(world, data, options?.externalEntities, options?.onPhase, assertCurrent);
                return attempt.entities;
            });
            assertCurrent?.();
            ownership?.attach(world, entities);
            assets?.trackSceneAssetReferences(data, entities, world);
            registerDeferredInstances(world, deferred, entities);
            const result = attempt.assets;
            if (result && collector) {
                for (const handle of result.materialHandles.values()) if (handle) collector.materialHandles.add(handle);
                collector.scope?.absorb(result.scope);
            } else if (assets?.entityScopes) {
                result?.scope.releaseAll();
            }
            return entities;
        } finally {
            ownership?.release();
        }
    });
}

function applyTextureMetadata(sceneData: SceneData, textureHandles: Map<string, number>): void {
    if (!sceneData.textureMetadata) return;
    const rm = requireResourceManager();
    for (const [path, metadata] of Object.entries(sceneData.textureMetadata)) {
        const handle = textureHandles.get(path);
        if (handle && metadata.sliceBorder) {
            const b = metadata.sliceBorder;
            rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
        }
    }
}

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void {
    // Legacy-format normalization happens once up-front in migrateSceneData;
    // by here compData is already current-shape.
    const comp = getComponent(compData.type);
    if (!comp) {
        const context = entityName ? ` on entity "${entityName}"` : '';
        log.warn('scene', `Unknown component type: ${compData.type}${context}`);
        return;
    }

    // Strip out-of-band fields (e.g. TilemapLayer's tile-chunk blob) before
    // validation/insert so the component insert doesn't choke on them; the
    // registered codec replays them once the component is in.
    const codec = sceneComponentCodec(world, compData.type);
    let outOfBand: Record<string, unknown> | undefined;
    if (codec?.outOfBandFields?.length) {
        for (const field of codec.outOfBandFields) {
            if (field in compData.data) {
                (outOfBand ??= {})[field] = compData.data[field];
                delete compData.data[field];
            }
        }
    }

    // Asset-ref fields validate leniently: their serialized string ref and runtime
    // numeric handle are both legal (a Tiled-imported Tilemap's `source: 0` == "none").
    const context = entityName ? ` (entity "${entityName}")` : '';
    const errors = validateComponentData(compData.type, comp._default as Record<string, unknown>, compData.data, comp.assetFields);
    if (errors.length > 0) {
        // Salvage, not sacrifice: deserialized data is the one input the strict
        // storage validators must not veto wholesale — drop the invalid fields so
        // their defaults apply and the REST of the component still loads. Without
        // this the insert below throws and one stale string in a saved scene
        // bricks the whole scene load.
        for (const err of errors) {
            const root = err.field in compData.data ? err.field : err.field.split('.')[0];
            delete compData.data[root];
        }
        // A converted Cocos script component carries what its scene serialized, including fields the class has since dropped; Cocos ignores
        // those without a word, and so does this.
        const stale = compData.type.startsWith('Cocos.') && errors.every((e) => e.actual === 'unknown field');
        const report = stale ? log.debug : log.warn;
        report.call(
            log,
            'scene',
            `${formatValidationErrors(compData.type + context, errors)}\n  → invalid fields dropped, their defaults apply (fix the scene file to silence this)`
        );
    }
    try {
        world.insert(entity, comp, compData.data);
    } catch (err) {
        // Defense in depth: a deeper boundary rejection costs THIS component, not
        // the scene.
        log.error(
            'scene',
            `component "${compData.type}"${context} failed to insert — skipped: ${err instanceof Error ? err.message : String(err)}`
        );
        return;
    }

    if (codec?.importData && outOfBand) {
        codec.importData(entity as unknown as number, outOfBand);
    }
}

// =============================================================================
// Scene Serializer
// =============================================================================

// Components that describe the scene graph structure itself — name, parent
// pointers, children lists, and derived world-transform caches. They are
// reconstructed on load from the SceneEntityData {name, parent, children}
// fields rather than from the components list, so we omit them here.
const STRUCTURAL_COMPONENTS = new Set(['Name', 'Parent', 'Children', 'WorldTransform']);

/**
 * One entity's serializable component payloads — the per-entity primitive
 * serializeScene is built from, also the spawn-replication payload (RC11):
 * skips structural + transient components, folds out-of-band codec state in.
 * Round-trips through {@link loadComponent}.
 */
export function serializeEntityComponents(world: World, entity: Entity): SceneComponentData[] {
    const entityNum = entity as unknown as number;
    const components: SceneComponentData[] = [];
    for (const typeName of world.getComponentTypes(entity)) {
        if (STRUCTURAL_COMPONENTS.has(typeName)) continue;
        const comp = getComponent(typeName);
        if (!comp) continue;
        // Runtime-only components (per-frame pointer/drag/hover state) never
        // persist — their systems rebuild them each frame. See ComponentMetadata.transient.
        if (comp.transient) continue;
        const data = world.tryGet(entity, comp);
        if (data === null) continue;
        // tryGet returns a fresh object for builtins (convertFromWasm) but the LIVE
        // stored object for script components — clone the latter so the snapshot
        // doesn't alias running-world state (and exportData below can't mutate it).
        const payload = (comp._builtin ? data : deepClone(data)) as Record<string, unknown>;
        // Components with out-of-band state (e.g. TilemapLayer chunks) fold
        // it into the record via their registered codec.
        sceneComponentCodec(world, typeName)?.exportData?.(entityNum, payload);
        for (const filter of worldExportFilters.get(world) ?? []) filter(entity, typeName, payload);
        components.push({
            type: typeName,
            data: payload,
        });
    }
    return components;
}

/**
 * Walks the live world and produces a SceneData that round-trips through
 * loadSceneData. Editors call this on save; external tools (prefab extract,
 * diff, CLI export) can reuse the same primitive.
 *
 * Parent/child links are collapsed into the entity record's parent+children
 * fields; the Parent and Children components themselves are omitted from
 * the components array so loadSceneData's setParent pass is the single
 * source of truth for hierarchy.
 */
export function serializeScene(world: World, sceneName = 'scene'): SceneData {
    const parentDef = getComponent('Parent');
    // RuntimeOnly entities are world-only projections their systems re-derive
    // (Tilemap source layers, tile colliders); excluding them up front also
    // keeps them out of every parent/children list below.
    const allEntities = world.getAllEntities().filter((e) => !world.has(e, RuntimeOnly));

    const parentOf = new Map<number, number>();
    if (parentDef) {
        for (const e of allEntities) {
            const parentComp = world.tryGet(e, parentDef) as { entity: number } | null;
            if (parentComp && parentComp.entity !== undefined) {
                parentOf.set(e as unknown as number, parentComp.entity);
            }
        }
    }

    // Derived from the parent map already built above: one pass, no second read per entity.
    const childrenOf = new Map<number, number[]>();
    for (const [child, parent] of parentOf) {
        let arr = childrenOf.get(parent);
        if (!arr) {
            arr = [];
            childrenOf.set(parent, arr);
        }
        arr.push(child);
    }

    const entities: SceneEntityData[] = [];
    for (const entity of allEntities) {
        const entityNum = entity as unknown as number;

        const nameComp = world.tryGet(entity, Name) as { value: string } | null;
        const name = nameComp?.value ?? `Entity_${entityNum}`;

        const components = serializeEntityComponents(world, entity);

        entities.push({
            id: entityNum,
            name,
            parent: parentOf.get(entityNum) ?? null,
            children: childrenOf.get(entityNum) ?? [],
            components,
        });
    }

    return {
        version: SCENE_FORMAT_VERSION,
        name: sceneName,
        generator: ESTELLA_SCENE_GENERATOR,
        entities,
    };
}

export function updateCameraAspectRatio(world: World, aspectRatio: number): void {
    const cameraEntities = world.getEntitiesWithComponents([Camera]);
    for (const entity of cameraEntities) {
        const camera = world.get(entity, Camera);
        if (camera) {
            camera.aspectRatio = aspectRatio;
            world.insert(entity, Camera, camera);
        }
    }
}

export function findEntityByName(world: World, name: string): Entity | null {
    return world.findEntityByName(name);
}

