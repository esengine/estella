// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { patchComponentFields, World } from '../ecs/world';
import { liveEntities } from '../ecs/liveEntityHandles';
import { initializeSceneComponents, installWorldHook, shouldExportComponent, type WorldHooks } from './worldHooks';
import { type Entity, INVALID_ENTITY } from '../types';
import { upgradeEntityComponents } from './legacyComponents';
import { isPrefabEntry, visitSceneEntryEntityReferences, type SceneEntry } from './sceneEntry';
import { requireSupportedSceneDocument, requireUnambiguousSceneHierarchy, sceneLoadError, SCENE_FORMAT_VERSION } from './sceneFormat';
import { canDefer, cutToRoot, deferredBindings, isDeferredInstance, rootOnly, rootOverrides, type DeferredRecord, VARIANT_KEY } from '../prefab/deferred';
import { expandVirtualRequested, registerDeferredInstances } from './deferredInstances';
import { validateScene } from './validateScene';
import { runSceneLoad, SceneLoadAttempt, scenePhaseRunner } from './sceneLoadAttempt';
import { getComponent, Name, Camera, RuntimeOnly, Disabled, type AnyComponentDef, type AssetFieldMeta } from '../ecs/component';
import { mapEntityRefField } from '../ecs/entityRefField';
import { deepClone } from '../util/deepClone';
import { AssetScope, type AssetLease } from '../asset/AssetLease';
import type { PrefabResult } from '../asset/AssetLoader';
import type { SceneAssetResult } from '../asset/Assets';
import { requireResourceManager } from '../wasm/resourceManager';
import { validateComponentData, formatValidationErrors } from '../util/validation';
import { log } from '../util/logger';
import { prepareSpawnOwnership, prepareSceneAuxiliaryAssets, type PreparedSpawnOwnership } from '../prefab/preparedAssetOwnership';
import { ESTELLA_SCENE_GENERATOR } from '../util/provenance';
import {
    expandEntry,
    createPrefabSourceLoader,
    type PrefabSource,
    type PrefabData,
    type ProcessedEntity,
} from '../prefab/index';

export { parseSceneFormatVersion, SCENE_FORMAT_VERSION } from './sceneFormat';

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
    /** Texture importer fallbacks embedded in a loose or cooked scene. Project asset metadata takes precedence. */
    textureImporterSettings?: import('../asset/sceneTextureImports').SceneTextureImporterSettings;
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
    /** @internal Borrowed from the scene scope until an entity leaves its scene. */
    auxiliary?: Map<Entity, readonly AssetLease[]>;
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
    /** @internal Release acquired content when the owning scene cancels an in-flight load. */
    signal?: AbortSignal;
    /** @internal Complete the exclusive handoff after content is ready and before spawning entities. */
    beforeSpawn?: () => Promise<void>;
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

/** @internal A managed load hands shared-resource writes to the scene that owns it. */
export interface ManagedSceneLoadOptions extends SceneLoadOptions {
    publishWhenReady?: (publish: () => void) => void;
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
export type AssetFieldType = 'json' | 'terrain-tiles' | 'terrain-layer' | 'terrain-layer-info' | 'physical-material' | 'image' | 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'sound-event' | 'video' | 'tilemap' | 'tileset' | 'timeline' | 'statemachine' | 'behaviortree' | 'scriptgraph' | 'animatorcontroller' | 'avatar' | 'mesh' | 'environment' | 'probeVolume' | 'prefab' | 'groom';

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
): readonly AssetFieldMeta[] {
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
        data[field] = mapEntityRefField(value, remap);
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
const worldComponentCodecs: WorldHooks<string, SceneComponentCodec> = new WeakMap();

/** @internal A world's component codecs take precedence over host defaults. */
export function registerWorldSceneComponentCodec(world: World, type: string, codec: SceneComponentCodec): () => void {
    return installWorldHook(worldComponentCodecs, world, type, codec);
}

export { registerWorldSceneExportFilter, type SceneExportFilter } from './worldHooks';

function sceneComponentCodec(world: World, type: string): SceneComponentCodec | undefined {
    return worldComponentCodecs.get(world)?.get(type)?.value ?? sceneComponentCodecs.get(type);
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
    return Array.isArray(scene?.entities) && (scene.entities as SceneEntry[]).some(isPrefabEntry);
}

/** Resolves a prefab asset ref to its PrefabData, or null when unresolvable. */
export type PrefabAssetResolver = (ref: string) => Promise<PrefabData | null>;

/** Expansion copies the prefab documents. Their asset receipts end when the copy is complete. */
export async function expandScenePrefabAssets(
    scene: SceneData, assets: Pick<import('../asset/Assets').Assets, 'acquireTyped'>,
): Promise<SceneData> {
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
export function expandScenePrefabs(
    scene: SceneData,
    loadPrefab: PrefabAssetResolver,
    options?: { expandVirtual?: boolean },
): Promise<SceneData> {
    return expandScenePrefabSources(scene, createPrefabSourceLoader(loadPrefab), options);
}

/** Allocate scene IDs for prefab members without taking IDs already named by the document. @experimental */
export function createScenePrefabIdAllocator(
    scene: SceneData,
    entityFieldsOf: (type: string) => readonly string[] = type => getComponent(type)?.entityFields ?? [],
): () => number {
    let nextId = 0;
    for (const entry of scene.entities) nextId = Math.max(nextId, entry.id);

    // An absent ID can name a persistent row or a missing target.
    const reserved = new Set<number>();
    const reserve = (id: unknown) => {
        if (typeof id === 'number' && id > nextId && Number.isSafeInteger(id)) reserved.add(id);
    };
    for (const entry of scene.entities) {
        reserve(entry.parent);
        visitSceneEntryEntityReferences(entry, entityFieldsOf, (_type, _field, ref) => reserve(ref));
    }
    return () => {
        do { nextId++; } while (reserved.has(nextId));
        return nextId;
    };
}

/** Expand using the same asset versions a caller has already checked for this scene. */
export async function expandScenePrefabSources(
    scene: SceneData,
    readSource: (ref: string) => Promise<PrefabSource>,
    options?: { expandVirtual?: boolean },
): Promise<SceneData> {
    requireSupportedSceneDocument(scene);
    requireUnambiguousSceneHierarchy(scene);
    const expandVirtual = options?.expandVirtual ?? expandVirtualRequested();
    const entries = scene.entities as SceneEntry[];
    if (!entries.some(isPrefabEntry)) return { ...scene, entities: scene.entities.slice() };
    const allocateId = createScenePrefabIdAllocator(scene);

    const out: SceneEntityData[] = [];
    const deferred: DeferredRecord[] = [];
    for (const entry of entries) {
        if (!isPrefabEntry(entry)) {
            out.push(entry);
            continue;
        }
        if (expandVirtual && entry.overrides.some((o) => o.type === 'metadata_set' && o.metadataKey === VARIANT_KEY)) continue;
        let source: PrefabSource;
        try {
            source = await readSource(entry.prefab);
        } catch (e) {
            log.warn('scene', `Prefab instance "${entry.prefab}" could not be resolved; instance skipped (${e})`);
            continue;
        }
        const { prefab, dependencies } = source;
        // A virtual instance is made as its root alone (see prefab/deferred.ts); instances inside it are left to whoever opens it.
        const virtual = !expandVirtual && isDeferredInstance(prefab, entry.overrides) && canDefer(entry.overrides, prefab)
            && entry.added.length === 0 && entry.removed.length === 0;
        const stub = virtual ? rootOnly(prefab) : null;
        const { entities: expanded, unresolved: unresolvedAll } = expandEntry(
            stub ?? prefab, stub ? { ...entry, overrides: rootOverrides(prefab, entry.overrides) } : entry, allocateId,
            (ref) => dependencies.get(ref) ?? null, expandVirtual || virtual ? undefined : deferred);
        const entities = virtual && !stub ? cutToRoot(expanded, entry.id) : expanded;
        const unresolved = virtual ? [] : unresolvedAll;
        if (virtual) deferred.push({ id: entry.id, prefab: entry.prefab, ...deferredBindings(entry.overrides) });
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
    const fromVersion = requireSupportedSceneDocument(raw);
    // Public inputs remain caller-owned. Internal builders can hand over their
    // fresh private records to the same normalization without copying them twice.
    const data = JSON.parse(JSON.stringify(raw)) as SceneData;
    const unresolved = unresolvedSceneAssets.get(raw);
    if (unresolved) {
        const copies = new Map<SceneComponentData, Map<string, string>>();
        for (const [index, row] of raw.entities.entries()) {
            if (!Array.isArray(row.components)) continue;
            row.components.forEach((component, fieldIndex) => {
                const paths = unresolved.get(component);
                if (paths) copies.set(data.entities[index]!.components[fieldIndex]!, paths);
            });
        }
        unresolvedSceneAssets.set(data, copies);
    }
    return migrateOwnedSceneData(data, fromVersion);
}

const unresolvedSceneAssets = new WeakMap<SceneData, Map<SceneComponentData, Map<string, string>>>();

/** @internal Retain the authored path beside prepared component data containing the fallback handle. */
export function recordUnresolvedSceneAsset(scene: SceneData, component: SceneComponentData, field: string, path: string): void {
    let unresolved = unresolvedSceneAssets.get(scene);
    if (!unresolved) unresolvedSceneAssets.set(scene, unresolved = new Map());
    let paths = unresolved.get(component);
    if (!paths) unresolved.set(component, paths = new Map());
    paths.set(field, path);
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
export function migrateOwnedSceneData(data: SceneData, fromVersion = requireSupportedSceneDocument(data)): SceneMigrationResult {
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
const UNLOADABLE_SCENE: ReadonlySet<string> = new Set([
    'duplicate-id', 'parent-cycle', 'malformed', 'malformed-entity', 'malformed-component',
]);

/** Refuse a scene the loader cannot honour; report the rest and carry on. */
function checkLoadable(sceneData: SceneData): void {
    const diags = validateScene(sceneData);
    if (diags.length === 0) return;
    const fatal = diags.filter((d) => UNLOADABLE_SCENE.has(d.code));
    for (const d of diags) {
        if (!fatal.includes(d)) log.warn('scene', `${d.code}: ${d.message}`);
    }
    if (fatal.length > 0) throw sceneLoadError(sceneData.name, fatal);
}

/** What a staged spawn made: the entities by document id, and the roots it switched off until {@link revealStagedEntities}. */
export interface StagedSpawn {
    entities: Map<number, Entity>;
    /** Entity namespace in which these roots were hidden. */
    lifetime?: symbol;
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
export function spawnAndLoadEntitiesJob(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    sink?: ScenePhaseSink, staged = false, spawn: StagedSpawn | undefined = undefined,
    assertScene?: () => void, attempt = new SceneLoadAttempt(world, sceneData.name),
): Generator<number, StagedSpawn, void> {
    return spawnSceneJob(world, sceneData, external, sink, staged, spawn, assertScene, attempt);
}

function* spawnSceneJob(
    world: World, sceneData: SceneData, external: ReadonlyMap<number, Entity> | undefined,
    sink: ScenePhaseSink | undefined, staged: boolean, spawn: StagedSpawn = { entities: new Map(), hidden: [] },
    assertScene: (() => void) | undefined, attempt: SceneLoadAttempt, replaceWorld = false,
): Generator<number, StagedSpawn, void> {
    const assertCurrent = () => { assertScene?.(); attempt.assertCurrent(); };
    // Settle work before yielding and restart the clock after resumption. A phase's observer may itself take time.
    let mark = sink ? performance.now() : 0;
    const onPhase: ScenePhaseSink | undefined = sink ? (phase, ms) => {
        sink(phase, ms);
        assertCurrent();
        mark = performance.now();
    } : undefined;
    const since = (): number => {
        const now = performance.now();
        const elapsed = now - mark;
        mark = now;
        return elapsed;
    };
    const resume = (): void => {
        assertCurrent();
        if (onPhase) mark = performance.now();
    };
    assertCurrent();
    checkLoadable(sceneData);
    if (onPhase) onPhase('spawn.validate', since());
    if (replaceWorld) {
        for (const entity of world.getAllEntities()) {
            if (world.valid(entity)) world.despawn(entity);
            assertCurrent();
        }
    }
    const { entities: entityMap, hidden } = spawn;
    const rows: SceneEntityData[] = [];
    let skipped = 0;
    for (const row of sceneData.entities) {
        if (row.visible === false) continue;
        if (isPrefabEntry(row)) skipped++;
        else rows.push(row);
    }
    const total = Math.max(1, rows.length * 3);
    let done = 0;
    let completed = false;
    spawn.lifetime = attempt.lifetime;
    attempt.entities = entityMap;
    const release = attempt.watch();
    try {
        let entityMs = 0;
        for (const entityData of rows) {
            const entity = world.spawnImmediate(undefined, created => entityMap.set(entityData.id, created));
            assertCurrent();
            world.insert(entity, Name, { value: entityData.name });
            if (staged && entityData.parent === null && !entityData.components.some((c) => c.type === 'Disabled')) {
                assertCurrent();
                world.insert(entity, Disabled, {});
                hidden.push(entity);
            }
            done++;
            if (onPhase) entityMs += since();
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
                assertCurrent();
                const entity = entityMap.get(entityData.id)!;
                world.insert(entity, Disabled, {});
                hidden.push(entity);
            }
        }
        if (onPhase) onPhase('spawn.entities', entityMs + since());

        // By component TYPE, because "component writes" is a rename of the total
        // and not an answer: which writes reach a subsystem, and which are field
        // validation, is the difference between a mechanism and a number.
        const byType = onPhase ? new Map<string, number>() : null;
        const unresolved = unresolvedSceneAssets.get(sceneData);
        for (const entityData of rows) {
            const entity = entityMap.get(entityData.id)!;
            for (const compData of entityData.components) {
                remapEntityFields(compData, entityMap, external);
                importComponentData(world, entity, compData, 'replace', entityData.name, unresolved?.get(compData));
                assertCurrent();
                if (byType) byType.set(compData.type, (byType.get(compData.type) ?? 0) + since());
            }
            initializeSceneComponents(world, entity);
            assertCurrent();
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

        let hierarchyMs = 0;
        for (const entityData of rows) {
            if (entityData.parent !== null) {
                const entity = entityMap.get(entityData.id);
                const parentEntity = entityMap.get(entityData.parent);
                if (entity !== undefined && parentEntity !== undefined) {
                    if (!world.trySetParent(entity, parentEntity)) {
                        const parentName = rows.find(row => row.id === entityData.parent)?.name;
                        throw new Error(`Scene "${sceneData.name}" could not attach "${entityData.name}" to "${parentName ?? entityData.parent}"`);
                    }
                    done++;
                    if (onPhase) hierarchyMs += since();
                    yield done / total;
                    resume();
                }
            }
        }
        if (onPhase) onPhase('spawn.hierarchy', hierarchyMs + since());
        for (const [id, entity] of entityMap) {
            if (!world.valid(entity)) throw new Error(`Entity ${id} was removed during scene load for "${sceneData.name}"`);
        }
        completed = true;
        return spawn;
    } finally {
        try { if (!completed) attempt.discardEntities(); }
        finally { release(); }
    }
}

/**
 * Switches on what a staged spawn switched off, whole, and tells every `Added` filter its components arrived now: the
 * arrival a system can see is the one when it is switched on. The other half of {@link spawnAndLoadEntitiesJob}.
 */
export function revealStagedEntities(world: World, spawn: StagedSpawn): void {
    for (const root of spawn.hidden) {
        if (spawn.lifetime !== undefined && spawn.lifetime !== world.entityLifetime) return;
        if (world.valid(root) && world.has(root, Disabled)) world.remove(root, Disabled);
    }
    for (const entity of spawn.entities.values()) {
        if (spawn.lifetime !== undefined && spawn.lifetime !== world.entityLifetime) return;
        if (world.valid(entity)) world.restampAdded(entity);
    }
}

/** Spawn private, migrated records. Binding entity references consumes those records. */
export function spawnAndLoadEntities(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    onPhase?: ScenePhaseSink, assertCurrent?: () => void, attempt?: SceneLoadAttempt,
): Map<number, Entity> {
    return finishSceneJob(spawnAndLoadEntitiesJob(world, sceneData, external, onPhase, false, undefined, assertCurrent, attempt));
}

function finishSceneJob(job: Generator<number, StagedSpawn, void>): Map<number, Entity> {
    for (;;) {
        const next = job.next();
        if (next.done) return next.value.entities;
    }
}

export function loadSceneData(
    world: World, sceneData: SceneData, external?: ReadonlyMap<number, Entity>,
    onPhase?: ScenePhaseSink,
): Map<number, Entity> {
    const attempt = new SceneLoadAttempt(world, sceneData.name);
    const began = onPhase ? performance.now() : 0;
    const { data } = migrateSceneData(sceneData);
    if (onPhase) onPhase('spawn.migrate', performance.now() - began);
    return spawnAndLoadEntities(world, data, external, onPhase, undefined, attempt);
}

/**
 * Validate a snapshot, then replace the world's entities. Validation failure leaves the world intact.
 * The snapshot remains reusable and the returned map binds snapshot IDs to new entities.
 */
export function resetWorldTo(world: World, sceneData: SceneData): Map<number, Entity> {
    const attempt = new SceneLoadAttempt(world, sceneData.name);
    const { data } = migrateSceneData(sceneData);
    return finishSceneJob(spawnSceneJob(world, data, undefined, undefined, false, undefined, undefined, attempt, true));
}

export async function loadSceneWithAssets(
    world: World,
    sceneData: SceneData,
    options?: SceneLoadOptions
): Promise<Map<number, Entity>> {
    const attempt = new SceneLoadAttempt(world, sceneData.name, { signal: options?.signal });
    return loadSceneDocument(world, sceneData, options, attempt, 'borrowed');
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
    attempt = new SceneLoadAttempt(world, scene.name, { signal: options?.signal }),
): Promise<Map<number, Entity>> {
    return loadSceneDocument(world, scene, options, attempt, 'owned');
}

async function loadSceneDocument(
    world: World, scene: SceneData, options: ManagedSceneLoadOptions | undefined, attempt: SceneLoadAttempt,
    ownership: 'borrowed' | 'owned',
): Promise<Map<number, Entity>> {
    if (options?.assets && sceneHasPrefabEntries(scene)) {
        const assets = options.assets;
        const timed = scenePhaseRunner(attempt.observe(options.onPhase));
        scene = await timed('prefab', () => expandScenePrefabAssets(scene, assets));
        attempt.assertCurrent();
    }
    const { data } = ownership === 'owned' ? migrateOwnedSceneData(scene) : migrateSceneData(scene);
    return loadSceneAssetsAndSpawn(world, data, options, attempt);
}

async function loadSceneAssetsAndSpawn(
    world: World, data: SceneData, options: ManagedSceneLoadOptions | undefined,
    attempt: SceneLoadAttempt,
): Promise<Map<number, Entity>> {
    return runSceneLoad(attempt, async () => {
        const onPhase = attempt.observe(options?.onPhase);
        const timed = scenePhaseRunner(onPhase);
        const assets = options?.assets, collector = options?.collectAssets;
        const assertCurrent = () => { options?.assertCurrent?.(); attempt.assertCurrent(); };
        let ownership: PreparedSpawnOwnership | undefined;
        let auxiliary: ReturnType<typeof prepareSceneAuxiliaryAssets> | undefined;
        try {
            assertCurrent();
            if (assets) {
                const result = await timed('assets', async () => {
                    attempt.assets = await assets.preloadSceneAssets(data, options?.onProgress, { entityOwnership: collector?.auxiliary ? 'auxiliary' : !collector });
                    return attempt.assets;
                });
                assertCurrent();
                if (collector?.auxiliary) {
                    auxiliary = prepareSceneAuxiliaryAssets(data, result, ref => assets.resolveRef(ref));
                } else if (!collector && assets.entityScopes) {
                    ownership = prepareSpawnOwnership(data, result, assets.entityScopes, assets.resolveRef.bind(assets))?.();
                }
                options?.onMissingAssets?.(result.missing);
                assertCurrent();
                if (options?.abortOnMissingAssets && result.missing.length > 0) {
                    throw new MissingAssetsError(result.missing);
                }
                assets.resolveSceneAssetPaths(data, result);
            }
            if (options?.beforeSpawn) {
                await options.beforeSpawn();
                assertCurrent();
            }
            const entities = await timed('spawn', () =>
                spawnAndLoadEntities(world, data, options?.externalEntities, onPhase, options?.assertCurrent, attempt));
            assertCurrent();
            ownership?.attach(world, entities);
            assets?.trackSceneAssetReferences(data, entities, world);
            registerDeferredInstances(world, data.deferredInstances, entities, options?.externalEntities);
            const result = attempt.assets;
            if (result && collector) {
                for (const handle of result.materialHandles.values()) if (handle) collector.materialHandles.add(handle);
                collector.scope?.absorb(result.scope);
                if (collector.scope) assets?.entityScopes?.inheritSceneInputs(result.scope, collector.scope);
                if (collector.auxiliary) auxiliary?.(world, entities, collector.auxiliary, collector.scope);
            } else if (assets?.entityScopes) {
                result?.scope.releaseAll();
            }
            assertCurrent();
            result?.publishTextureImports?.();
            return entities;
        } finally {
            ownership?.release();
        }
    }, undefined, () => {
        if (attempt.assets) publishSceneTextureMetadata(data, attempt.assets, options?.publishWhenReady);
    });
}

/** @internal Apply authored borders through the handle map that bound the committed scene. */
export function publishSceneTextureMetadata(
    sceneData: SceneData, result: Pick<SceneAssetResult, 'textureHandles' | 'resolveRef'>,
    publishWhenReady?: (publish: () => void) => void,
): void {
    const metadata = sceneData.textureMetadata;
    if (!metadata) return;
    const { textureHandles, resolveRef } = result;
    const publish = () => {
        const rm = requireResourceManager();
        for (const [path, entry] of Object.entries(metadata)) {
            const handle = textureHandles.get(resolveRef?.(path) ?? path);
            if (handle && entry?.sliceBorder) {
                const b = entry.sliceBorder;
                rm.setTextureMetadata(handle, b.left, b.right, b.top, b.bottom);
            }
        }
    };
    if (publishWhenReady) publishWhenReady(publish);
    else publish();
}

export function loadComponent(world: World, entity: Entity, compData: SceneComponentData, entityName?: string): void {
    importComponentData(world, entity, compData, 'replace', entityName);
}

function stripTransientComponentFields(fields: readonly string[] | undefined, data: Record<string, unknown>): void {
    if (fields) for (const field of fields) delete data[field];
}

/** @internal Capture a component's authored fields from a world read. */
export function captureAuthoredComponentData(
    world: World, entity: Entity, component: AnyComponentDef, data: Record<string, unknown>,
    assetPath?: (path: string) => string | null,
): Record<string, unknown> {
    // Builtin reads return records. Script reads hold the stored row or object.
    const captured = component._builtin ? data : deepClone(data, new WeakMap());
    world.restorePendingAssetPaths(entity, component, captured, assetPath);
    stripTransientComponentFields(component.transientFields, captured);
    return captured;
}

/** Authored scenes contain whole components. Replication baselines supply partial
 *  records to the same validation and codec pipeline. */
export function importComponentData(
    world: World, entity: Entity, compData: SceneComponentData,
    mode: 'replace' | 'patch', entityName?: string, unresolved?: ReadonlyMap<string, string>,
): boolean {
    // Legacy-format normalization happens once up-front in migrateSceneData;
    // by here compData is already current-shape.
    const comp = getComponent(compData.type);
    if (!comp) {
        const context = entityName ? ` on entity "${entityName}"` : '';
        log.warn('scene', `Unknown component type: ${compData.type}${context}`);
        return false;
    }

    if (mode === 'replace' && comp.transientFields?.some(field => field in compData.data)) {
        const data = { ...compData.data };
        stripTransientComponentFields(comp.transientFields, data);
        compData = { ...compData, data };
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
        const recovery = mode === 'patch' ? 'invalid replication fields skipped'
            : 'invalid fields dropped, their defaults apply (fix the scene file to silence this)';
        report.call(
            log,
            'scene',
            `${formatValidationErrors(compData.type + context, errors)}\n  → ${recovery}`
        );
    }
    try {
        if (mode === 'patch') patchComponentFields(world, entity, comp, compData.data);
        else if (unresolved) world.insertWithUnresolvedAssets(entity, comp, compData.data, unresolved);
        else world.insert(entity, comp, compData.data);
    } catch (err) {
        // Defense in depth: a deeper boundary rejection costs THIS component, not
        // the scene.
        log.error(
            'scene',
            `component "${compData.type}"${context} failed to ${mode === 'patch' ? 'patch' : 'insert'} — skipped: ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
    }

    if (codec?.importData && outOfBand) {
        codec.importData(entity as unknown as number, outOfBand);
    }
    return true;
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
export function serializeEntityComponents(world: World, entity: Entity, registeredTypes?: readonly string[]): SceneComponentData[] {
    const components: SceneComponentData[] = [];
    visitSerializedComponents(world, entity, record => components.push(record), registeredTypes);
    return components;
}

/** Capture a detached record with the declaration that supplied its data. Registered aliases retain their wire names. */
export function visitSerializedComponents(
    world: World, entity: Entity, visit: (record: SceneComponentData, definition: AnyComponentDef) => void,
    registeredTypes: readonly string[] = world.getComponentTypes(entity),
    include?: (typeName: string, definition: AnyComponentDef) => boolean,
): void {
    const entityNum = entity as unknown as number;
    const capture = (typeName: string, comp: AnyComponentDef): void => {
        if (comp.transient || STRUCTURAL_COMPONENTS.has(typeName) || STRUCTURAL_COMPONENTS.has(comp._name)) return;
        if (include && !include(typeName, comp)) return;
        const data = world.tryGet(entity, comp);
        if (data === null) return;
        const payload = captureAuthoredComponentData(world, entity, comp, data as Record<string, unknown>);
        // Components with out-of-band state (e.g. TilemapLayer chunks) fold
        // it into the record via their registered codec.
        sceneComponentCodec(world, typeName)?.exportData?.(entityNum, payload);
        if (shouldExportComponent(world, entity, typeName, payload)) visit({ type: typeName, data: payload }, comp);
    };
    let scriptNames: Map<symbol, string> | undefined;
    for (const name of registeredTypes) {
        const registered = getComponent(name);
        if (registered?._builtin) capture(name, registered);
        else if (registered) (scriptNames ??= new Map()).set(registered._id, name);
    }
    for (const stored of world.getStoredScriptComponents(entity)) capture(scriptNames?.get(stored._id) ?? stored._name, stored);
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
    const allEntities = liveEntities(world).filter(entity => !world.has(entity, RuntimeOnly));

    const registeredTypes = world.getComponentTypesBatch(allEntities);
    const parents: (Entity | null)[] = new Array(allEntities.length).fill(null);
    const children = new Map<Entity, Entity[]>();
    if (parentDef) {
        let included: Set<Entity> | undefined;
        const readParent = world.resolveGetter(parentDef);
        for (const [i, entity] of allEntities.entries()) {
            if (!registeredTypes[i]!.includes(parentDef._name)) continue;
            const relation = (readParent ? readParent(entity) : world.get(entity, parentDef)) as { entity: Entity } | null;
            const parent = relation?.entity;
            // A child whose parent is absent from the snapshot becomes a root.
            if (parent === undefined || !(included ??= new Set(allEntities)).has(parent)) continue;
            parents[i] = parent;
            const siblings = children.get(parent);
            if (siblings) siblings.push(entity);
            else children.set(parent, [entity]);
        }
    }

    const entities: SceneEntityData[] = allEntities.map((entity, i) => {
        const types = registeredTypes[i]!;
        const name = types.includes(Name._name) ? world.tryGet(entity, Name)?.value : undefined;
        return {
            id: entity,
            name: name ?? `Entity_${entity}`,
            parent: parents[i]!,
            children: children.get(entity) ?? [],
            components: serializeEntityComponents(world, entity, types),
        };
    });

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

