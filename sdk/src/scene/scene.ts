// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    scene.ts
 * @brief   Scene loading utilities
 */

import { World } from '../ecs/world';
import { Entity, INVALID_ENTITY } from '../types';
import { isPrefabEntry, type SceneEntry } from './sceneEntry';
import { validateScene } from './validateScene';
import { getComponent, Name, Camera, RuntimeOnly } from '../ecs/component';
import { deepClone } from '../util/deepClone';
import { discoverSceneAssets } from '../asset/discoverAssets';
import { requireResourceManager } from '../wasm/resourceManager';
import { validateComponentData, formatValidationErrors, assetFieldNames } from '../util/validation';
import { log } from '../util/logger';
import { ESTELLA_SCENE_GENERATOR } from '../util/provenance';
import {
    expandEntry,
    preloadNestedPrefabs,
    migratePrefabData,
    type PrefabData,
    type PrefabInstanceEntry,
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
}

export interface LoadedSceneAssets {
    texturePaths: Set<string>;
    materialHandles: Set<number>;
    fontPaths: Set<string>;
    spineKeys: Set<string>;
}

/** Progress during a scene load, in assets: how many are done of how many.
 *  @beta */
export type SceneLoadProgressCallback = (loaded: number, total: number) => void;

export type MissingAssetCallback = (missing: import('../asset/Assets').MissingAsset[]) => void;

export interface SceneLoadOptions {
    assets?: import('../asset/Assets').Assets;
    assetBaseUrl?: string;
    collectAssets?: LoadedSceneAssets;
    onProgress?: SceneLoadProgressCallback;
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
}

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
export type AssetFieldType = 'texture' | 'material' | 'font' | 'anim-clip' | 'audio' | 'video' | 'tilemap' | 'tileset' | 'timeline' | 'statemachine' | 'behaviortree' | 'animatorcontroller' | 'mesh';

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

export function remapEntityFields(compData: SceneComponentData, entityMap: Map<number, Entity>): void {
    const comp = getComponent(compData.type);
    if (!comp || comp.entityFields.length === 0) return;
    const data = compData.data as Record<string, unknown>;
    const remap = (editorId: unknown): unknown => {
        if (typeof editorId !== 'number' || editorId === INVALID_ENTITY) return editorId;
        const runtimeId = entityMap.get(editorId);
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

/** Register a custom (de)serializer for a component type. Idempotent. */
export function registerSceneComponentCodec(type: string, codec: SceneComponentCodec): void {
    sceneComponentCodecs.set(type, codec);
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
): Promise<SceneData> {
    const entries = scene.entities as SceneEntry[];
    // Allocate fresh ids for expanded internals above every id already in the
    // file, so they never collide with non-prefab entities or instance roots
    // (which keep their stable scene id across save/load).
    let nextId = 0;
    for (const e of entries) nextId = Math.max(nextId, e.id);
    const allocateId = () => ++nextId;

    const out: SceneEntityData[] = [];
    for (const entry of entries) {
        if (!isPrefabEntry(entry)) {
            out.push(entry);
            continue;
        }
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
        const { entities } = expandEntry(prefab, entry, allocateId, (ref) => cache.get(ref) ?? null);
        for (const pe of entities) out.push(toSceneEntityData(pe));
    }
    return { ...scene, entities: out };
}

// =============================================================================
// Scene Migration — versioned, idempotent, non-mutating (mirrors prefab/migrate)
// =============================================================================

/**
 * Current scene format version — bump by one per migration step below.
 *
 * An integer, not semver: this number only has to answer "older, current, or
 * newer", and dotted ones cannot. `parseFloat` sorts "1.10" below "1.2".
 */
export const SCENE_FORMAT_VERSION = 1;

export interface SceneMigrationResult {
    /** A migrated *copy* — the input is never mutated. */
    data: SceneData;
    /** True if any legacy shape was upgraded (callers may prompt a re-save). */
    migrated: boolean;
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
export const RETIRED_COMPONENT_TYPES: ReadonlySet<string> = new Set(['StateMachine', 'StateVisuals']);

/**
 * Upgrade a SceneData to the current format. Total + idempotent: already-current
 * data returns `migrated: false`; migrations are shape-driven so they no-op on
 * current scenes. Rejects data newer than this engine. Returns a deep copy, so
 * loading never mutates the caller's object (snapshots can be reloaded).
 */
export function migrateSceneData(raw: SceneData): SceneMigrationResult {
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

    // Scene data is plain JSON — JSON clone is safe on every platform and frees
    // the migrations/loader below to mutate without touching the caller's input.
    const data: SceneData = JSON.parse(JSON.stringify(raw)) as SceneData;

    let migrated = false;
    for (const entity of data.entities) {
        // Prefab-instance entries carry no `components` to migrate; the async
        // loader expands them first, so any seen here belong to the sync path
        // and are left untouched (spawnAndLoadEntities warns + skips them).
        if (isPrefabEntry(entity)) continue;
        // Drop components retired by an engine upgrade before per-component
        // normalization — keeping them would only make loadComponent warn + skip.
        const live = entity.components.filter((c) => !RETIRED_COMPONENT_TYPES.has(c.type));
        if (live.length !== entity.components.length) { entity.components = live; migrated = true; }
        for (const comp of entity.components) {
            if (normalizeLegacyComponent(comp)) migrated = true;
        }
    }

    data.version = SCENE_FORMAT_VERSION;
    return { data, migrated, fromVersion, toVersion: SCENE_FORMAT_VERSION };
}

/** Normalize legacy component spellings in place. Returns true if changed. */
function normalizeLegacyComponent(compData: SceneComponentData): boolean {
    let changed = false;
    if (compData.type === 'LocalTransform' || compData.type === 'WorldTransform') {
        compData.type = 'Transform';
        changed = true;
    }
    if (compData.type === 'UIMask') {
        const maskData = compData.data as Record<string, unknown>;
        if (maskData.mode === 'scissor') { maskData.mode = 0; changed = true; }
        else if (maskData.mode === 'stencil') { maskData.mode = 1; changed = true; }
    }
    return changed;
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

function spawnAndLoadEntities(world: World, sceneData: SceneData): Map<number, Entity> {
    checkLoadable(sceneData);
    const entityMap = new Map<number, Entity>();

    for (const entityData of sceneData.entities) {
        if (entityData.visible === false) continue;
        // A prefab-instance entry reaching here means the synchronous path was
        // used on an unexpanded prefab scene — it has no spawnable components.
        // Skip it (loadSceneWithAssets is the supported prefab-scene path).
        if (isPrefabEntry(entityData)) {
            log.warn('scene', 'Prefab-instance entry skipped in synchronous load; use loadSceneWithAssets to load prefab scenes');
            continue;
        }
        const entity = world.spawn();
        entityMap.set(entityData.id, entity);
        world.insert(entity, Name, { value: entityData.name });
    }

    try {
        for (const entityData of sceneData.entities) {
            if (entityData.visible === false) continue;
            if (isPrefabEntry(entityData)) continue;
            const entity = entityMap.get(entityData.id)!;
            for (const compData of entityData.components) {
                remapEntityFields(compData, entityMap);
                loadComponent(world, entity, compData, entityData.name);
            }
        }

        for (const entityData of sceneData.entities) {
            if (entityData.parent !== null) {
                const entity = entityMap.get(entityData.id);
                const parentEntity = entityMap.get(entityData.parent);
                if (entity !== undefined && parentEntity !== undefined) {
                    world.setParent(entity, parentEntity);
                }
            }
        }
    } catch (e) {
        for (const entity of entityMap.values()) {
            try { world.despawn(entity); } catch { /* ignore cleanup errors */ }
        }
        throw e;
    }

    return entityMap;
}

export function loadSceneData(world: World, sceneData: SceneData): Map<number, Entity> {
    const { data } = migrateSceneData(sceneData);
    return spawnAndLoadEntities(world, data);
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
    // Expand prefab-instance entries first (via the same flattenPrefab core the
    // editor uses) so migration + asset resolution + spawn all operate on plain
    // entities — this is how a saved prefab scene achieves play == ship. The
    // prefab's own asset refs are resolved by the regular preload below.
    let scene = sceneData;
    if (options?.assets && sceneHasPrefabEntries(scene)) {
        const assets = options.assets;
        scene = await expandScenePrefabs(scene, async (ref) => {
            try {
                const r = await assets.loadPrefab(ref);
                return (r?.data as PrefabData) ?? null;
            } catch (e) {
                log.warn('scene', `Failed to load prefab "${ref}": ${e}`);
                return null;
            }
        });
    }
    // Migrate up-front to a private copy; asset resolution + spawn all operate
    // on it, so the caller's SceneData is never mutated.
    const { data } = migrateSceneData(scene);
    if (options?.assets) {
        const assets = options.assets;
        const result = await assets.preloadSceneAssets(data, options.onProgress);
        if (options.onMissingAssets) {
            options.onMissingAssets(result.missing);
        }
        if (options.abortOnMissingAssets && result.missing.length > 0) {
            throw new MissingAssetsError(result.missing);
        }
        assets.resolveSceneAssetPaths(data, result);
        applyTextureMetadata(data, result.textureHandles);
        if (options.collectAssets) {
            for (const handle of result.materialHandles.values()) {
                if (handle) options.collectAssets.materialHandles.add(handle);
            }
        }
    }
    return spawnAndLoadEntities(world, data);
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
    const codec = sceneComponentCodecs.get(compData.type);
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
    const errors = validateComponentData(compData.type, comp._default as Record<string, unknown>, compData.data, assetFieldNames(comp));
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
        log.warn(
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
        sceneComponentCodecs.get(typeName)?.exportData?.(entityNum, payload);
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

    // Derive children from the parent map so we don't have to decode the
    // Children component (whose `entities` field is a wasm VectorEntity on
    // the CPP backend and would leak if iterated without cleanup).
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

