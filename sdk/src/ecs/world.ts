// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { WasmModuleAborted } from '../wasm/moduleHealth';
import { type Entity, entityGeneration, entityIndex, makeEntity, INVALID_ENTITY } from '../types';
import { type AnyComponentDef, type ComponentDef, type ComponentData, type BuiltinComponentDef, isBuiltinComponent, builtinComponentRegistry, extraBuiltinComponentRegistry, getUserComponentNamesById, getComponent, Disabled, Name, Parent, Children, Transform, type ParentData, type ChildrenData } from './component';
import type { CppRegistry, ESEngineModule } from '../wasm';
import { handleWasmError } from '../wasm/wasmError';
import { BuiltinBridge, builtinFromWasm, numberListFieldsOf, type BridgeConnectOptions,
         type BuiltinMethods, type CompositionDelta } from './bridge/BuiltinBridge';
import { ScriptStorage } from './ScriptStorage';
import type { PoolMemory, ScriptPool } from './ScriptPool';
import { NameIndex } from './NameIndex';
import { ChangeTracker } from './ChangeTracker';
import { componentProjection, copyComponentData, readComponentProjection } from './componentProjection';
import { commitPropertyEdit } from './propertyPath';
import { QueryCache, type QueryCacheStats } from './QueryCache';
import { rankByOrder } from './entityOrder';
import { worldEngineApi } from './bridge/engineApi';
import { registerEngineStampFlush } from './engineStamps';
import { withMalloc, withScratch } from '../wasm/wasmScratch';
import { disposeAll } from '../util/disposeAll';
import { log } from '../util/logger';
import { PendingAssetFields, assetEditsOf, finishAssetDraft, rememberAssetDraft, trackAssetEdits, type AssetFieldResolver } from './pendingAssetFields';
import { getDefaultContext, type EditorBridge } from './context';

/** The slice of a core {@link World.applyEntityOrder} needs: the entry point plus
 *  the heap it marshals the entity list through (wasm memory on the web, the
 *  host's arena on a device — the writes are identical either way). */
interface EntityOrderCore {
    renderer_setEntityDrawOrder?(registry: CppRegistry, entitiesPtr: number, count: number): void;
    _malloc?(bytes: number): number;
    _free?(ptr: number): void;
    HEAPU32?: Uint32Array;
}

function editorBridge(): EditorBridge | null {
    return getDefaultContext().editorBridge;
}

/** Whether the caller can continue publishing into the world that delivered this notification. */
function notifyBridge<K extends keyof EditorBridge>(
    world: World,
    method: K,
    ...args: Parameters<NonNullable<EditorBridge[K]>>
): boolean {
    const bridge = editorBridge();
    if (!bridge) return true;
    const fn = bridge[method] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn !== 'function') return true;
    const lifetime = world.entityLifetime;
    try {
        fn.apply(bridge, args as unknown[]);
    } catch (e) {
        log.warn('world', `EditorBridge.${String(method)} threw`, e);
    }
    return world.entityLifetime === lifetime;
}

export { PTR_LAYOUTS } from '../wasm/ptrLayouts.generated';
export { BuiltinBridge } from './bridge/BuiltinBridge';
export type { BuiltinMethods } from './bridge/BuiltinBridge';

// =============================================================================
// Numeric Component IDs for Cache Keys
// =============================================================================

let nextCompNumId_ = 1;
const compNumIds_ = new WeakMap<object, number>();

function getCompNumId(comp: AnyComponentDef): number {
    let id = compNumIds_.get(comp);
    if (id === undefined) {
        id = nextCompNumId_++;
        compNumIds_.set(comp, id);
    }
    return id;
}

const _keyIds: number[] = [];

/** What an omitted `with` or `without` reads as: one shared list, where a default `[]` was a new array every call. */
const NO_COMPONENTS: AnyComponentDef[] = [];
/** Membership of the committed world, for queries a bare entity can satisfy. */
const ENTITY_POPULATION = Symbol('entity population');
const HIERARCHY_CONTENT = Symbol('hierarchy content');
const PARENT_QUERY_DEP = 1;
const CHILDREN_QUERY_DEP = 2;
const HIERARCHY_CONTENT_QUERY_DEP = 4;
type QueryDependencyIds = symbol[] & { hierarchyMask?: number };

function hierarchyQueryMask(ids: readonly symbol[]): number {
    return (ids.includes(Parent._id) ? PARENT_QUERY_DEP : 0)
        | (ids.includes(Children._id) ? CHILDREN_QUERY_DEP : 0)
        | (ids.includes(HIERARCHY_CONTENT) ? HIERARCHY_CONTENT_QUERY_DEP : 0);
}

/** The cache key and dependency ids of an unfiltered query with up to two components. */
interface PlainQueryPlan {
    readonly key: string;
    readonly depIds: symbol[];
}
const PAIR = 0x100000;
const plainQueryPlans_ = new Map<number, PlainQueryPlan>();

/**
 * Most direct world queries ask for the population, a component, or a pair on every frame.
 * Zero is free for the population because component IDs start at one.
 */
function plainQueryPlan(components: AnyComponentDef[]): PlainQueryPlan {
    let id = 0;
    if (components.length === 1) id = getCompNumId(components[0]);
    else if (components.length === 2) id = getCompNumId(components[0]) * PAIR + getCompNumId(components[1]);
    let plan = plainQueryPlans_.get(id);
    if (!plan) {
        plan = { key: computeQueryCacheKey(components), depIds: queryDepIds(components, NO_COMPONENTS, NO_COMPONENTS) };
        plainQueryPlans_.set(id, plan);
    }
    return plan;
}

export function computeQueryCacheKey(
    components: AnyComponentDef[],
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = [],
    filterKey?: string,
): string {
    _keyIds.length = 0;
    for (const c of components) _keyIds.push(getCompNumId(c));
    _keyIds.sort((a, b) => a - b);
    let key = _keyIds.join(',');
    if (withFilters.length > 0) {
        _keyIds.length = 0;
        for (const c of withFilters) _keyIds.push(getCompNumId(c));
        _keyIds.sort((a, b) => a - b);
        key += '|+' + _keyIds.join(',');
    }
    if (withoutFilters.length > 0) {
        _keyIds.length = 0;
        for (const c of withoutFilters) _keyIds.push(getCompNumId(c));
        _keyIds.sort((a, b) => a - b);
        key += '|-' + _keyIds.join(',');
    }
    if (filterKey) {
        key += '|F=' + filterKey;
    }
    return key;
}

/**
 * Predicate-based filter applied after the positive/negative component
 * checks. Callers (typically `QueryInstance`) compile an expression tree
 * into a `match` closure plus a list of components it reads. A custom
 * predicate can also read the values of hierarchy components.
 */
export interface QueryFilter {
    readonly match: (entity: Entity) => boolean;
    readonly deps: readonly AnyComponentDef[];
}

/** Position in an active subtree teardown, including the next listener to notify. */
class DespawnCursor {
    readonly visit: Entity[] = [];
    readonly order: Entity[] = [];
    readonly nativeOwned: Entity[] = [];
    index = -1;
    phase: 'begin' | 'notify' | 'forget' | 'done' = 'begin';
    observers?: readonly ((entity: Entity) => void)[];
    nextObserver = 0;
}

interface DestructionState {
    lifetime: symbol;
    registry: CppRegistry | null;
    entities: Set<Entity>;
    active: DespawnCursor[];
    spare?: DespawnCursor;
}

// =============================================================================
// World
// =============================================================================

let compositionInputs: ReadonlySet<string> | null = null;

export function feedsTransformComposition(component: AnyComponentDef): boolean {
    compositionInputs ??= new Set([Transform._name, Parent._name, Children._name]);
    return compositionInputs.has(component._name);
}


/**
 * Switching an entity off can change any query. A query with no required
 * component also depends on bare entities entering or leaving the world.
 * World, QueryInstance and compiled systems all use the same dependencies.
 */
export function queryDepIds(
    components: readonly AnyComponentDef[],
    withFilters: readonly AnyComponentDef[],
    withoutFilters: readonly AnyComponentDef[],
    filterDeps: readonly AnyComponentDef[] = [],
    filterSemantics: 'values' | 'membership' = 'values',
): symbol[] {
    const ids: QueryDependencyIds = [Disabled._id];
    if (!components.length && !withFilters.length) ids.push(ENTITY_POPULATION);
    for (const c of components) ids.push(c._id);
    for (const c of withFilters) ids.push(c._id);
    for (const c of withoutFilters) ids.push(c._id);
    for (const c of filterDeps) ids.push(c._id);
    if (filterSemantics === 'values' && filterDeps.some(c => c._id === Parent._id || c._id === Children._id)) {
        ids.push(HIERARCHY_CONTENT);
    }
    ids.hierarchyMask = hierarchyQueryMask(ids);
    return ids;
}


export type { AssetFieldResolver } from './pendingAssetFields';

/**
 * The entity store, as `GetWorld()` hands it to a system — the escape hatch for
 * work the declared parameters cannot express. Prefer `Query`/`Res`/`Commands`:
 * those declare their access, so the scheduler can see it and the cache can serve
 * them. The frozen surface here is what a game does with entities; what the frame
 * runner, the query cache and the editor's projection need is `@internal`.
 *
 * @public
 */
export class World {
    private readonly builtin_ = new BuiltinBridge(() => this.releaseCore_());
    private readonly scripts_ = new ScriptStorage();
    private readonly names_ = new NameIndex();
    /** @internal */
    readonly changes_ = new ChangeTracker();
    /** @internal */
    readonly queries_ = new QueryCache();
    /** @see inactiveEntities_ */
    private inactive_: { set: Set<Entity> } | null = null;
    private inactiveVersion_ = -1;
    private coreActivityEpoch_ = -1;
    private readonly hierarchyQueryStamps_ = new Map<symbol, { type: number; revision: number }>();
    private hierarchyContentStamp_ = -1;
    private readonly coreDisconnect_ = new Set<() => void>();
    private entityLifetime_ = Symbol();
    private lifetimeRegistry_: CppRegistry | null = null;
    private lifetimeReset_: number | undefined;
    private resetEpochWord_ = -1;
    private resetEpochHeap_?: Uint32Array;
    private resetEpochLow_ = 0;
    private resetEpochHigh_ = 0;
    /** Allocation order, updated on an explicit reorder. Generation is part of the entity handle. */
    private readonly entities_ = new Map<Entity, number>();
    private nextEntityRank_ = 0;
    private reservedSpawns_?: { lifetime: symbol; entities: Set<Entity> };
    /** Worlds that only query components keep their cached hits across bare spawns. */
    private tracksPopulation_ = false;
    private indexGeneration_ = new Map<number, number>();  // index -> current generation (for isStale detection)
    private iterationDepth_ = 0;
    private iterationLifetime_: symbol | undefined;
    private queryCostEnabled_ = false;
    private nextEntityIndex_ = 0;  // pure-JS fallback: monotonic index counter
    private spawnCallbacks_: Array<(entity: Entity) => void> = [];
    private despawnCallbacks_: Array<(entity: Entity) => void> = [];
    private componentRemovalObservers_?: Map<symbol, Array<(entity: Entity) => void>>;
    private assetFieldResolver_: AssetFieldResolver | null = null;
    private assetFieldObservers_?: Set<(entity: Entity, component: AnyComponentDef) => void>;
    private pendingAssetFields_?: PendingAssetFields;
    private despawning_: DestructionState | null = null;

    /** @internal */
    get builtin(): BuiltinBridge {
        return this.builtin_;
    }

    /**
     * Bind this world to an engine core. The embedding contract, not the game
     * one: a host instantiates the module and calls this, and everything below
     * reaches the same registry through {@link getCppRegistry}.
     *
     * @internal
     */
    connectCpp(
        cppRegistry: CppRegistry,
        module?: ESEngineModule,
        options?: BridgeConnectOptions,
    ): void {
        // A populated JS-only World can already have entity owners before a host attaches its first registry.
        if (!this.hasCpp && this.entities_.size
            && (this.coreDisconnect_.size || this.despawning_?.active.length || this.reservedSpawns_?.entities.size)) {
            this.builtin_.disconnect();
        }
        this.addressOf_.clear();
        this.hierarchyQueryStamps_.clear();
        this.hierarchyContentStamp_ = -1;
        this.builtin_.connect(cppRegistry, module, options);
        for (const e of this.scripts_.getStorageById(Disabled._id)?.keys() ?? []) cppRegistry.setEntityEnabled?.(e, false);
        this.coreActivityEpoch_ = cppRegistry.activityEpoch?.() ?? -1;
        this.queries_.markComponentDirty(Disabled._id);
    }

    /** @internal */
    disconnectCpp(): void {
        this.builtin_.disconnect();
    }

    /** @internal Whether an engine core is bound — false in a pure-JS world. */
    get hasCpp(): boolean {
        return this.builtin_.hasCpp;
    }

    /** @internal */
    getCppRegistry(): CppRegistry | null {
        return this.builtin_.getCppRegistry();
    }

    /** @internal Packed entity handles can be reused after a disconnect or a native registry clear. */
    get entityLifetime(): symbol {
        const heap = this.resetEpochHeap_;
        const word = this.resetEpochWord_;
        // Nonshared WASM growth detaches the old view, so its reads answer undefined.
        // A shared heap grows in place across its old prefix. Both keep this check allocation-free.
        if (heap && heap[word] === this.resetEpochLow_ && heap[word + 1] === this.resetEpochHigh_
            && this.lifetimeReset_ !== -1) return this.entityLifetime_;
        return this.refreshEntityLifetime_();
    }

    private refreshEntityLifetime_(): symbol {
        const registry = this.getCppRegistry();
        if (registry !== this.lifetimeRegistry_) {
            const address = registry && this.getWasmModule()?.registry_entityChangeResetEpochAddress?.(registry);
            this.resetEpochWord_ = address ? address >>> 2 : -1;
        }
        const word = this.resetEpochWord_;
        const heap = word >= 0 ? this.getWasmModule()?.HEAPU32 : undefined;
        this.resetEpochHeap_ = heap;
        let raw: number | undefined;
        if (heap) {
            this.resetEpochLow_ = heap[word];
            this.resetEpochHigh_ = heap[word + 1];
            raw = this.resetEpochLow_ + this.resetEpochHigh_ * 0x100000000;
        } else if (registry) raw = worldEngineApi(this)?.registry_entityChangeResetEpoch?.(registry);
        const reset = raw === Number.MAX_SAFE_INTEGER ? -1 : raw;
        if (this.lifetimeRegistry_ !== registry || this.lifetimeReset_ !== reset || reset === -1) {
            this.lifetimeRegistry_ = registry;
            this.lifetimeReset_ = reset;
            this.entityLifetime_ = Symbol();
            this.iterationDepth_ = 0;
            // A native clear already returned these slots. Only their SDK rows are still ours.
            if (this.reservedSpawns_) this.releaseReservedSpawns_();
        }
        return this.entityLifetime_;
    }

    /** @internal Release native leases before the owning core is disconnected. */
    onCoreDisconnect(dispose: () => void): () => void {
        this.coreDisconnect_.add(dispose);
        return () => { this.coreDisconnect_.delete(dispose); };
    }

    private releaseCore_(): void {
        this.pendingAssetFields_?.clear();
        try {
            disposeAll([
                () => this.flushEngineStamps(),
                () => {
                    const state = this.despawning_;
                    if (state?.active.length) {
                        // A nested despawn returns to the observer that started it.
                        disposeAll([...state.active], cursor => {
                            try {
                                if (state.lifetime === this.entityLifetime) this.drainDespawn_(state, cursor);
                            } finally { this.releaseDespawn_(state, cursor); }
                        }, true);
                    }
                },
                () => {
                    for (const dispose of [...this.coreDisconnect_]) {
                        try { dispose(); } catch (error) { log.warn('world', 'Core disconnect callback error', error); }
                    }
                },
                () => this.releaseReservedSpawns_(this.getCppRegistry()),
                // Disconnect listeners may have made a final engine write of their own.
                () => this.flushEngineStamps(),
                () => this.releaseStampBuffer_(),
            ], dispose => dispose());
        } finally {
            // Disconnect listeners can still return entities to their original registry.
            this.entityLifetime_ = Symbol();
            this.iterationDepth_ = 0;
            this.lifetimeRegistry_ = null;
            this.lifetimeReset_ = undefined;
            this.resetEpochWord_ = -1;
            this.resetEpochHeap_ = undefined;
            this.despawning_ = null;
            this.clearStampFlusher_?.();
            this.clearStampFlusher_ = undefined;
            this.engineTypeIdsFor_ = null;
            this.engineTypeIds_.clear();
            this.addressOf_.clear();
            this.coreActivityEpoch_ = -1;
            this.hierarchyQueryStamps_.clear();
            this.hierarchyContentStamp_ = -1;
            this.queries_.markComponentDirty(Disabled._id);
        }
    }

    /** @internal Refresh membership mirrors after an observed native mutation. */
    refreshBuiltinMembership(entity: Entity, component: AnyComponentDef): void {
        if (!isBuiltinComponent(component) || !this.valid(entity)) return;
        const set = this.builtin_.getEntitySet(component._cppName);
        const present = this.builtin_.getBuiltinMethods(component._cppName).has(entity);
        if (set && set.has(entity) !== present) {
            if (present) set.add(entity); else set.delete(entity);
            this.queries_.markStructuralChange();
        }
        this.queries_.markComponentDirty(component._id);
        this.notifyAssetFields_(entity, component);
    }

    /** @internal */
    getWasmModule(): ESEngineModule | null {
        return this.builtin_.getWasmModule();
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    /**
     * Create an entity with no components. Throws during query iteration —
     * mutating the set a query is walking is what `Commands` exists to defer.
     */
    spawn(name?: string): Entity {
        return this.spawnImmediate(name);
    }

    /** @internal Record ownership of an allocated handle before spawn listeners can disconnect its world. */
    spawnImmediate(name?: string, record?: (entity: Entity) => void): Entity {
        if (this.speculation_) {
            throw new Error(
                'Cannot spawn entity inside a speculation. ' +
                'Use its Commands, which allocate no identity until the step commits.'
            );
        }
        if (this.isIterating()) {
            throw new Error(
                'Cannot spawn entity during query iteration. ' +
                'Use Commands to defer entity creation until after iteration completes.'
            );
        }
        const entity = this.allocateEntity_();
        record?.(entity);
        this.commitSpawn_(entity, name);
        return entity;
    }

    /**
     * @internal An identity for a spawn {@link Commands} will apply later — what
     * `cmds.spawn(...).id()` answers while a query is running. Allowed mid-iteration
     * because it touches no component storage: a bare id is in no query. The spawn
     * itself (name, components, spawn callbacks) happens at
     * {@link commitReservedSpawn}, when the commands flush.
     */
    reserveEntity(): Entity {
        if (this.speculation_) {
            throw new Error('Cannot reserve an entity inside a speculation.');
        }
        if (this.builtin_.disconnecting) return INVALID_ENTITY;
        const lifetime = this.entityLifetime;
        if (this.lifetimeReset_ === -1) return INVALID_ENTITY;
        const entity = this.allocateEntity_();
        (this.reservedSpawns_ ??= { lifetime, entities: new Set() }).entities.add(entity);
        return entity;
    }

    /** @internal Finish a spawn begun by {@link reserveEntity}. */
    commitReservedSpawn(entity: Entity, name?: string): void {
        const reserved = this.reservedSpawns_;
        if (reserved && reserved.lifetime === this.entityLifetime && reserved.entities.delete(entity)) {
            this.commitSpawn_(entity, name);
        }
    }

    private releaseReservedSpawns_(registry?: CppRegistry | null): void {
        const reserved = this.reservedSpawns_;
        if (!reserved) return;
        const entities = [...reserved.entities];
        for (const entity of entities) this.discardEntityRow_(entity);
        this.reservedSpawns_ = undefined;
        // Native destroy callbacks can clear the same registry and immediately reuse every number.
        if (registry) disposeAll(entities, entity => {
            if (reserved.lifetime === this.entityLifetime) registry.destroy(entity);
        });
    }

    private allocateEntity_(): Entity {
        let entity: Entity;
        const cppRegistry = this.builtin_.getCppRegistry();

        if (cppRegistry) {
            try {
                entity = cppRegistry.create();
            } catch (e) {
                handleWasmError(e, 'spawn');
                throw e;
            }
        } else {
            // Use the same packed index and generation as the C++ entity handle.
            const idx = ++this.nextEntityIndex_;
            const gen = (this.indexGeneration_.get(idx) ?? 0);
            entity = makeEntity(idx, gen);
        }

        // A registry replacement or bulk clear can allocate an identical packed
        // handle. Its first SDK row starts at the new entity's insertion rank.
        if (this.entities_.has(entity)) this.discardEntityRow_(entity);
        this.entities_.set(entity, this.nextEntityRank_++);
        this.indexGeneration_.set(entityIndex(entity), entityGeneration(entity));
        return entity;
    }

    private commitSpawn_(entity: Entity, name?: string): void {
        const lifetime = this.spawnCallbacks_.length || editorBridge() ? this.entityLifetime : undefined;
        this.queries_.markStructuralChange();
        if (this.tracksPopulation_) this.queries_.markComponentDirty(ENTITY_POPULATION);

        if (name !== undefined) {
            this.insert(entity, Name, { value: name });
            if (lifetime !== undefined && this.entityLifetime !== lifetime) return;
        }

        for (const cb of this.spawnCallbacks_) {
            try { cb(entity); } catch (e) { log.warn('world', 'Spawn callback error', e); }
            if (this.entityLifetime !== lifetime) return;
        }

        notifyBridge(this, 'onEntitySpawned', entity, name);
    }

    /**
     * Destroy `entity` and its whole subtree — children before parents, so none
     * is left orphaned and still drawing. Already-gone entities are ignored, and
     * as with {@link spawn} this throws during query iteration.
     */
    despawn(entity: Entity): void {
        if (this.speculation_) {
            throw new Error(
                'Cannot despawn entity inside a speculation. ' +
                'Use its Commands, which apply only if the step commits.'
            );
        }
        if (this.isIterating()) {
            throw new Error(
                'Cannot despawn entity during query iteration. ' +
                'Use Commands to defer entity destruction until after iteration completes.'
            );
        }
        if (this.valid(entity)) this.despawnSubtree_(entity, this.builtin_.getCppRegistry());
    }

    /** Depth-first teardown of `entity` and its descendants (children before parent). */
    private despawnSubtree_(entity: Entity, cppRegistry: CppRegistry | null): void {
        const lifetime = this.entityLifetime;
        if (this.lifetimeReset_ === -1) return;
        if (this.despawning_?.lifetime !== lifetime) {
            this.despawning_ = { lifetime, registry: cppRegistry, entities: new Set(), active: [] };
        }
        const state = this.despawning_;
        const cursor = state.spare ?? new DespawnCursor();
        state.spare = undefined;
        const { visit, order, nativeOwned } = cursor;
        try {
            // Visiting siblings right to left gives child-first authored order when read backwards.
            // Reserve the complete tree before any destruction callback can change its hierarchy.
            let current: Entity | undefined = entity;
            while (current !== undefined) {
                if (this.valid(current) && !state.entities.has(current) && !cppRegistry?.destructionPending?.(current)) {
                    state.entities.add(current);
                    order.push(current);
                    if (cppRegistry?.hasChildren(current)) {
                        this.appendChildEntities_(cppRegistry, current, visit, true);
                        if (this.entityLifetime !== lifetime) return;
                    }
                }
                current = visit.pop();
            }
            if (order.length === 0) return;
            if (cppRegistry) {
                if (cppRegistry.hasParent(entity)) {
                    try { cppRegistry.setParent(entity, INVALID_ENTITY); }
                    catch (e) { handleWasmError(e, `despawn(detach ${entity})`); }
                    if (this.entityLifetime !== lifetime) return;
                }
                for (const owned of order) {
                    if (cppRegistry.reserveDestruction(owned)) nativeOwned.push(owned);
                }
            }
            cursor.index = order.length - 1;
            state.active.push(cursor);
            try { this.drainDespawn_(state, cursor); } finally { state.active.pop(); }
        } finally {
            this.releaseDespawn_(state, cursor);
            if (visit.length) visit.length = 0;
            cursor.observers = undefined;
            cursor.nextObserver = 0;
            cursor.phase = 'begin';
            state.spare = cursor;
        }
    }

    private releaseDespawn_(state: DestructionState, cursor: DespawnCursor): void {
        try {
            // A completed cursor checked its world after the last native destroy.
            if (state.registry && (cursor.phase === 'done' || state.lifetime === this.entityLifetime)) {
                while (cursor.nativeOwned.length) state.registry.releaseDestruction(cursor.nativeOwned.pop()!);
            }
        } finally {
            if (cursor.nativeOwned.length) cursor.nativeOwned.length = 0;
            while (cursor.order.length) state.entities.delete(cursor.order.pop()!);
        }
    }

    /** Advance before calling out. Disconnect can finish this same cursor in the original world. */
    private drainDespawn_(state: DestructionState, cursor: DespawnCursor): void {
        const { lifetime, registry } = state;
        while (cursor.index >= 0) {
            const entity = cursor.order[cursor.index]!;
            if (cursor.phase === 'begin') {
                if (!this.valid(entity)) { cursor.index--; continue; }
                this.pendingAssetFields_?.remove(entity);
                cursor.phase = 'notify';
                if (!notifyBridge(this, 'onEntityDespawned', entity)) return;
            }
            if (cursor.phase === 'notify') {
                const observers = cursor.observers ??= this.despawnCallbacks_;
                while (cursor.nextObserver < observers.length) {
                    this.notifyDespawn_(observers[cursor.nextObserver++]!, entity);
                    if (this.entityLifetime !== lifetime) return;
                }
                cursor.phase = 'forget';
                this.names_.remove(entity);
                if (registry) {
                    try { registry.destroy(entity); }
                    catch (e) { handleWasmError(e, `despawn(entity=${entity})`); }
                    if (this.entityLifetime !== lifetime) return;
                }
            }
            this.forgetEntity_(entity);
            cursor.index--;
            cursor.observers = undefined;
            cursor.nextObserver = 0;
            cursor.phase = 'begin';
        }
        cursor.phase = 'done';
    }

    private abortedReported_ = false;

    private notifyDespawn_(callback: (entity: Entity) => void, entity: Entity): void {
        try { callback(entity); } catch (e) {
            if (e instanceof WasmModuleAborted) {
                if (!this.abortedReported_) {
                    this.abortedReported_ = true;
                    log.warn('world', 'Despawn callbacks stopped: the engine module has aborted', e);
                }
            } else {
                log.warn('world', 'Despawn callback error', e);
            }
        }
    }

    private discardEntityRow_(entity: Entity): void {
        this.pendingAssetFields_?.remove(entity);
        this.names_.remove(entity);
        this.forgetEntity_(entity);
    }

    private forgetEntity_(entity: Entity): void {
        this.entities_.delete(entity);
        this.queries_.markStructuralChange();
        const wasReserved = this.reservedSpawns_?.entities.delete(entity);
        if (!wasReserved && this.tracksPopulation_) this.queries_.markComponentDirty(ENTITY_POPULATION);

        // Dirty exactly the component versions this entity carried so its
        // membership leaves the relevant cached queries — unrelated queries stay
        // valid (the query cache no longer honors the global structural version).
        for (const cppName of this.builtin_.deleteFromEntitySets(entity)) {
            const def = getComponent(cppName);
            if (def) {
                // Record the removal (no-op unless a Removed query tracks it) so
                // Removed(BuiltinComp) fires on despawn, not only on explicit
                // remove() — matching the script-component path below.
                this.changes_.recordRemoved(def, entity);
                this.queries_.markComponentDirty(def._id);
            }
        }
        this.queries_.markComponentDirty(Parent._id);
        this.queries_.markComponentDirty(Children._id);

        const removedIds = this.scripts_.removeEntity(entity);
        for (const id of removedIds) {
            this.changes_.recordRemovedById(id, entity);
            this.queries_.markComponentDirty(id);
        }
    }

    /**
     * Run `callback` whenever an entity is created; the returned function
     * unsubscribes. A throw is logged and swallowed, so one bad listener cannot
     * stop the others or the spawn itself.
     */
    onSpawn(callback: (entity: Entity) => void): () => void {
        this.spawnCallbacks_ = [...this.spawnCallbacks_, callback];
        return () => {
            const idx = this.spawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.spawnCallbacks_ = this.spawnCallbacks_.filter((_, i) => i !== idx);
        };
    }

    /**
     * Run `callback` whenever an entity is destroyed, once per entity in a
     * subtree teardown; the returned function unsubscribes. This is the hook a
     * per-entity side table is cleaned up from.
     */
    onDespawn(callback: (entity: Entity) => void): () => void {
        // Copy on subscription changes, so self-unsubscription during a
        // notification cannot skip the next observer. Dispatch allocates nothing.
        this.despawnCallbacks_ = [...this.despawnCallbacks_, callback];
        return () => {
            const idx = this.despawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.despawnCallbacks_ = this.despawnCallbacks_.filter((_, i) => i !== idx);
        };
    }

    /** @internal Release component-owned data on explicit removal through the World. */
    onComponentRemoval(component: AnyComponentDef, callback: (entity: Entity) => void): () => void {
        this.componentRemovalObservers_ ??= new Map();
        const observers = this.componentRemovalObservers_;
        const key = component._id;
        observers.set(key, [...(observers.get(key) ?? []), callback]);
        return () => {
            const current = observers.get(key);
            const next = current?.filter(observer => observer !== callback);
            if (next?.length) observers.set(key, next);
            else observers.delete(key);
        };
    }

    /** Whether `entity` currently exists. False for one never spawned and for a
     *  despawned one alike — {@link isStale} tells the two apart. */
    valid(entity: Entity): boolean {
        return this.entities_.has(entity);
    }

    /** @internal Cleanup during core disconnect can check just the subtree's destruction reservation. */
    isDestructionPending(entity: Entity, includeCoreDisconnect = true): boolean {
        return (includeCoreDisconnect && this.builtin_.disconnecting) || this.reservedForDestruction_(entity)
            || !!this.builtin_.getCppRegistry()?.destructionPending?.(entity);
    }

    private reservedForDestruction_(entity: Entity): boolean {
        const batch = this.despawning_;
        return !!batch && batch.entities.has(entity) && batch.lifetime === this.entityLifetime;
    }

    /** Effective activity, including ancestors; unlike valid(), an inactive
     * entity remains available for inspection, cleanup and serialization. */
    isEntityActive(entity: Entity): boolean {
        return this.valid(entity) && !this.inactiveEntities_()?.has(entity);
    }

    /**
     * True if `entity` refers to a slot that has been recycled — its index is
     * currently live, but held by a *different* generation. Useful for
     * diagnostic logs: `valid()` alone can't distinguish "never existed" from
     * "was despawned and its slot reassigned" since both return false.
     */
    isStale(entity: Entity): boolean {
        if (this.entities_.has(entity)) return false;
        const idx = entityIndex(entity);
        const currentGen = this.indexGeneration_.get(idx);
        return currentGen !== undefined && currentGen !== entityGeneration(entity);
    }

    /** How many entities exist. */
    entityCount(): number {
        return this.entities_.size;
    }

    /**
     * @internal Live sizes of every map the world keeps, for the resource census.
     *
     * `indexSlots` never shrinks by design — it is keyed by entity INDEX, which
     * the registry recycles, so it settles at the session's peak. One that keeps
     * climbing means indices are not being reused, which entityCount() cannot show.
     */
    getStorageSizes(): {
        entities: number;
        indexSlots: number;
        spawnCallbacks: number;
        despawnCallbacks: number;
        coreDisconnectCallbacks: number;
        names: ReturnType<NameIndex['sizes']>;
        scripts: ReturnType<ScriptStorage['sizes']>;
        changes: ReturnType<ChangeTracker['sizes']>;
        queryCacheEntries: number;
    } {
        return {
            entities: this.entities_.size,
            indexSlots: this.indexGeneration_.size,
            spawnCallbacks: this.spawnCallbacks_.length,
            despawnCallbacks: this.despawnCallbacks_.length,
            coreDisconnectCallbacks: this.coreDisconnect_.size,
            names: this.names_.sizes(),
            scripts: this.scripts_.sizes(),
            changes: this.changes_.sizes(),
            queryCacheEntries: this.queries_.getStats().size,
        };
    }

    /** @internal Structural version the query cache invalidates against. */
    getWorldVersion(): number {
        this.syncActivityEpoch_();
        return this.queries_.structuralVersion;
    }

    /** @internal Cumulative query-cache counters (hits, misses, invalidation causes). */
    getQueryCacheStats(): QueryCacheStats {
        return this.queries_.getStats();
    }

    /** @internal Reset the query-cache counters. Entries themselves are kept. */
    resetQueryCacheStats(): void {
        this.queries_.resetStats();
    }

    /**
     * @internal Whether queries count what they scan. Per-World rather than a
     * module flag: the editor realm and the play realm are separate Apps in one
     * process, and a shared switch would have each turn the other's accounting on.
     */
    setQueryCostEnabled(enabled: boolean): void {
        this.queryCostEnabled_ = enabled;
    }

    /** @internal */
    get queryCostEnabled(): boolean {
        return this.queryCostEnabled_;
    }

    /** @internal Iteration depth is what makes spawn/despawn refuse mid-query. */
    beginIteration(): void {
        this.iterationLifetime_ = this.entityLifetime;
        this.iterationDepth_++;
    }

    /** @internal */
    endIteration(): void {
        this.iterationDepth_--;
        if (this.iterationDepth_ < 0) {
            log.warn('world', 'World.endIteration: mismatched begin/end calls');
            this.iterationDepth_ = 0;
        }
    }

    /** @internal Release the walks owned by a finishing invocation, or all walks on a full reset. */
    resetIterationDepth(depth = this.iterationDepth_): void {
        this.iterationDepth_ = Math.max(0, this.iterationDepth_ - depth);
    }

    /**
     * @internal Set the guard aside for a system suspended at an `await`, and
     * give it back when that system resumes.
     *
     * The depth is the WORLD's, and a system parked mid-query would otherwise
     * lend its iteration to whoever runs next: their spawn is refused for an
     * iteration that is not theirs, and their reset frees a query still walking.
     */
    suspendIteration(): number {
        const depth = this.iterationDepth_;
        this.iterationDepth_ = 0;
        return depth;
    }

    /** @internal Pairs with {@link suspendIteration}. */
    resumeIteration(depth: number): void {
        if (depth) this.iterationLifetime_ = this.entityLifetime;
        this.iterationDepth_ = depth;
    }

    /** @internal */
    isIterating(): boolean {
        return this.iterationDepth_ > 0 && this.entityLifetime === this.iterationLifetime_;
    }

    /** Every entity, in storage order — which is the order queries walk and,
     *  within a sorting layer, the order the renderer draws. A fresh array. */
    getAllEntities(): Entity[] {
        return Array.from(this.entities_.keys());
    }

    /** @internal Return known handles once each, in storage order. */
    entitySubsetInStorageOrder(candidates: readonly Entity[]): Entity[] {
        if (candidates.length === 0) return [];
        const members = new Set(candidates);
        // A broad subset is cheaper to read in order than to sort.
        if (members.size * 4 >= this.entities_.size) {
            const ordered: Entity[] = [];
            for (const entity of this.entities_.keys()) if (members.has(entity)) ordered.push(entity);
            return ordered;
        }
        return [...members].filter(entity => this.entities_.has(entity))
            .sort((a, b) => this.entities_.get(a)! - this.entities_.get(b)!);
    }

    /**
     * Reorder the world's storage so every iteration follows `entities`.
     *
     * Within a sorting layer the renderer draws in the order it walks the ECS —
     * so an entity that iterates later lands on top. That order is storage order,
     * which a scene gets for free by spawning in its authored order and which this
     * re-establishes on a world that is already populated: the picture a reload
     * would give, without respawning anything (entity ids, component values and
     * every subsystem keyed on them survive untouched).
     *
     * Entities left out of `entities` keep their relative order after the listed
     * ones. Both halves of the world move together — the engine's component pools
     * and the JS-side storages the SDK's own queries walk — so an editor's outliner
     * drag and a game's "bring this card to the front" mean one thing.
     *
     * @param entities the desired iteration order (first iterates first, draws first)
     */
    /** @internal */
    applyEntityOrder(entities: readonly Entity[]): void {
        if (entities.length === 0) return;
        if (this.isIterating()) {
            log.warn('world', 'applyEntityOrder ignored during query iteration');
            return;
        }
        const rankOf = rankByOrder(entities);

        // The engine's pools first: it owns the draw path, and its call is the one
        // that can fail (no core, or a core built before this entry point existed).
        this.pushEntityOrderToCore_(entities);

        const ordered = this.getAllEntities().sort((a, b) => rankOf(a) - rankOf(b));
        this.entities_.clear();
        this.nextEntityRank_ = 0;
        for (const entity of ordered) this.entities_.set(entity, this.nextEntityRank_++);
        this.builtin_.reorderEntitySets(rankOf);
        this.scripts_.reorderStorages(rankOf);
        // Cached query results are entity ARRAYS — their order is now wrong, and no
        // component version moved, so drop them wholesale.
        this.queries_.invalidateAll();
    }

    /** Marshal the order to whichever core is connected (see applyEntityOrder). */
    private pushEntityOrderToCore_(entities: readonly Entity[]): void {
        const cppRegistry = this.builtin_.getCppRegistry();
        if (!cppRegistry) return;
        const core = worldEngineApi(this) as EntityOrderCore | null;
        const push = core?.renderer_setEntityDrawOrder;
        if (!core || !push || !core._malloc || !core._free || !core.HEAPU32) return;
        try {
            withScratch({ _malloc: core._malloc, _free: core._free }, (alloc) => {
                const ptr = alloc(entities.length * 4);
                // HEAPU32 is re-read here (not captured above): emscripten swaps the
                // views out when the heap grows, and _malloc can grow it.
                core.HEAPU32!.set(entities as ArrayLike<number>, ptr >> 2);
                push.call(core, cppRegistry, ptr, entities.length);
            });
            // The core can also reorder each parent's Children in place. Invalidate
            // readers of sibling order, including cached name paths, in this tick.
            this.changes_.recordWriteRevision(Children);
        } catch (e) {
            handleWasmError(e, `applyEntityOrder(count=${entities.length})`);
        }
    }

    /** Keep {@link Parent} and {@link Children} consistent when reparenting. */
    setParent(child: Entity, parent: Entity): void {
        this.trySetParent(child, parent);
    }

    /** Reject invalid relationships without changing hierarchy or notifications. */
    trySetParent(child: Entity, parent: Entity): boolean {
        return this.trySetParent_(child, parent);
    }

    /** @internal Move a child before a sibling without changing world iteration order. */
    trySetParentBefore(child: Entity, parent: Entity, before: Entity): boolean {
        return this.trySetParent_(child, parent, before);
    }

    private trySetParent_(child: Entity, parent: Entity, before?: Entity): boolean {
        if (parent === (0xFFFFFFFF as Entity)) parent = INVALID_ENTITY;
        if (this.reservedForDestruction_(child) || this.reservedForDestruction_(parent)) return false;
        if (!this.valid(child) || (parent !== INVALID_ENTITY && !this.valid(parent))) return false;
        const cppRegistry = this.builtin_.getCppRegistry();
        if (before !== undefined && (!cppRegistry?.setParentBefore || before === INVALID_ENTITY || !this.valid(before))) return false;
        if (cppRegistry) {
            try {
                const previous = cppRegistry.hasParent(child) ? cppRegistry.getParent(child).entity : INVALID_ENTITY;
                if (before === undefined && previous === parent) {
                    return !cppRegistry.destructionPending?.(child) && !cppRegistry.destructionPending?.(parent);
                }
                // New cores return acceptance. A legacy void host remains
                // compatible; only an explicit rejection prevents bookkeeping.
                const applied = before === undefined
                    ? cppRegistry.setParent(child, parent)
                    : cppRegistry.setParentBefore!(child, parent, before);
                if (applied === false) return false;
            } catch (e) {
                handleWasmError(e, `setParent(child=${child}, parent=${parent})`);
                return false;
            }
        }
        const linkedParent = parent === INVALID_ENTITY ? null : parent;
        this.trackHierarchyWrite_(child, linkedParent);
        notifyBridge(this, 'onParentChanged', child, linkedParent);
        return true;
    }

    /** Detach `entity` from its parent, leaving its own children attached to it. */
    removeParent(entity: Entity): void {
        if (this.reservedForDestruction_(entity)) return;
        if (!this.valid(entity)) return;
        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry?.destructionPending?.(entity)) return;
        if (cppRegistry) {
            try {
                cppRegistry.removeParent(entity);
            } catch (e) {
                handleWasmError(e, `removeParent(entity=${entity})`);
            }
        }
        this.trackHierarchyWrite_(entity, null);
        notifyBridge(this, 'onParentChanged', entity, null);
    }

    /** `entity`'s children, snapshotted out of the wasm vector that holds them. */
    private childEntitiesOf_(entity: Entity): Entity[] {
        const registry = this.builtin_.getCppRegistry();
        const children: Entity[] = [];
        if (registry?.hasChildren(entity)) this.appendChildEntities_(registry, entity, children);
        return children;
    }

    private appendChildEntities_(registry: CppRegistry, entity: Entity, children: Entity[], strict = false): void {
        try {
            // Snapshot then free the wasm VectorEntity (it leaks if left alive).
            const vec = registry.getChildren(entity).entities;
            try {
                const count = vec.size();
                for (let i = 0; i < count; i++) children.push(vec.get(i) as Entity);
            } finally { vec.delete(); }
        } catch (e) {
            handleWasmError(e, `getChildren(entity=${entity})`);
            // A partial snapshot is unsafe for deletion: it would remove the
            // parent while leaving unread children alive with dangling links.
            if (strict) throw e;
        }
    }

    // Parent/Children are one relationship with two halves, and setParent is the
    // only writer that keeps both. Writing either as a component lands here.
    private insertHierarchy_(entity: Entity, component: AnyComponentDef, data?: unknown): unknown {
        if (component._id === Parent._id) {
            const parent = (data as Partial<ParentData> | undefined)?.entity;
            if (parent === undefined || parent === INVALID_ENTITY) {
                this.removeParent(entity);
                return { entity: INVALID_ENTITY };
            }
            this.setParent(entity, parent);
            return this.has(entity, Parent) ? this.get(entity, Parent) : { entity: INVALID_ENTITY };
        }
        const listed = (data as Partial<ChildrenData> | undefined)?.entities ?? [];
        const lifetime = this.entityLifetime;
        for (const child of listed) {
            this.setParent(child as Entity, entity);
            if (this.entityLifetime !== lifetime) return { entities: [] };
        }
        return { entities: this.builtin_.hasCpp ? this.childEntitiesOf_(entity) : [...listed] };
    }

    private isHierarchyComponent_(component: AnyComponentDef): boolean {
        return component._id === Parent._id || component._id === Children._id;
    }

    // The C++ side owns both halves of the link. These mirrors track SDK
    // writes for change filters and despawn bookkeeping.
    private trackHierarchyWrite_(child: Entity, parent: Entity | null): void {
        const parents = this.builtin_.getOrCreateEntitySet(Parent._cppName);
        const children = this.builtin_.getOrCreateEntitySet(Children._cppName);
        // Re-parenting moves the switched-off closure, so every query's answer can
        // change — but ONLY in a world that has something switched off. Charged
        // against the tag rather than the hierarchy, which moves on every despawn.
        if (this.scripts_.getStorageById(Disabled._id)?.size) {
            this.queries_.markComponentDirty(Disabled._id);
        }

        if (parent === null) {
            if (parents.delete(child)) this.changes_.recordRemoved(Parent, child);
        } else {
            if (!parents.has(child)) {
                parents.add(child);
                this.changes_.recordAdded(Parent, child);
            }
            this.recordComponentWrite_(child, Parent);

            if (!children.has(parent)) {
                children.add(parent);
                this.changes_.recordAdded(Children, parent);
            }
            this.recordComponentWrite_(parent, Children);
        }

        this.queries_.markStructuralChange();
        this.queries_.markComponentDirty(Parent._id);
        this.queries_.markComponentDirty(Children._id);
    }

    // =========================================================================
    // Component Management
    // =========================================================================

    /**
     * Add `component` to `entity`, with `data` merged over the component's
     * defaults, and answer the stored value. Adding one that is already there
     * replaces it.
     */
    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): ComponentData<C> {
        this.speculation_?.record(this, entity, component);
        if (this.isHierarchyComponent_(component)) {
            return this.insertHierarchy_(entity, component, data) as ComponentData<C>;
        }
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin_(entity, component, data) as ComponentData<C>;
        }
        return this.insertScript_(entity, component as ComponentDef<any>, data) as ComponentData<C>;
    }

    /** @internal Insert prepared data and retain failed paths before component observers run. */
    insertWithUnresolvedAssets(entity: Entity, component: AnyComponentDef, data: Record<string, unknown>, paths: ReadonlyMap<string, string>): void {
        if (!isBuiltinComponent(component)) {
            this.insert(entity, component, data);
            return;
        }
        this.speculation_?.record(this, entity, component);
        this.insertBuiltin_(entity, component, data, undefined, paths);
    }

    /** @internal Commit a reflected field assignment with the same validation as insert.
     * Other asset fields in the readback can still be placeholders for loads in flight. */
    [commitPropertyEdit]<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>, field: string): void {
        if (isBuiltinComponent(component) && this.pendingAssetFields_?.has(entity, component)) {
            this.speculation_?.record(this, entity, component);
            this.insertBuiltin_(entity, component, data, new Set([field]));
        } else {
            this.insert(entity, component, data);
        }
    }

    /**
     * Store a whole component value and stamp the change tick a `Changed` filter
     * reads. Insert-or-replace: an entity that lacks the component gets it.
     * Replacing the value supersedes any asset paths still loading for this component.
     */
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void {
        this.storeComponent_(entity, component, data, 'replace');
    }

    /** @internal Commit the complete component values produced by the animation runtime. */
    [componentProjection]<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void {
        if (this.set !== worldSet || this.get !== worldGet) {
            this.set(entity, component, data);
            return;
        }
        this.storeComponent_(entity, component, data, 'projection');
    }

    private storeComponent_<C extends AnyComponentDef>(
        entity: Entity, component: C, data: ComponentData<C>, kind: 'replace' | 'edit' | 'projection',
        edited?: ReadonlySet<string>,
    ): void {
        this.speculation_?.record(this, entity, component);
        if (this.isHierarchyComponent_(component)) {
            this.insertHierarchy_(entity, component, data);
            return;
        }
        if (isBuiltinComponent(component)) {
            // `set` is insert-or-replace: adding a builtin the entity LACKS must run
            // the full structural bookkeeping (entity set + query dirty + recordAdded),
            // or the C++ side holds it while queries / has() (entity-set fast path)
            // never see it. Route the new case through insert.
            if (this.builtin_.hasCpp && !this.has(entity, component)) {
                this.insert(entity, component, data as Partial<ComponentData<C>>);
                return;
            }
            const raw = data as Record<string, unknown>;
            const refs = this.takeAssetRefs_(component, raw);
            if (this.builtin_.hasCpp) {
                try {
                    this.builtin_.set(entity, component, refs?.clean ?? raw, kind === 'projection');
                } catch (e) {
                    handleWasmError(e, `set(${component._name}, entity=${entity})`);
                }
            }
            if (!this.recordComponentWrite_(entity, component)) return;
            const start = this.assetFieldsWritten_(entity, component, raw, refs?.authored, kind !== 'replace', edited);
            if (notifyBridge(this, 'onComponentChanged', entity, component._name)) start?.();
            return;
        }
        // Insert-or-replace means the ADD case owes the same bookkeeping insert
        // does, or a warmed query never learns the entity matched. The builtin
        // branch above says so; this one did not.
        const { isNew } = this.scripts_.set(entity, component as ComponentDef<any>, data);
        this.finishComponentWrite_(entity, component, data, isNew);
    }

    /**
     * @internal What turns an asset path written into an engine-backed
     * component's handle field (`Sprite.texture = 'assets/hero.png'`,
     * `MeshRenderer.mesh = 'builtin:cube'`) into the handle. Installed by the
     * asset layer on every core; see bindAssetReferenceTracking.
     */
    setAssetFieldResolver(resolver: AssetFieldResolver | null): void {
        if (resolver !== this.assetFieldResolver_) this.pendingAssetFields_?.clear();
        this.assetFieldResolver_ = resolver;
    }

    /** @internal Whether authored asset fields already have a resolver on this world. */
    get hasAssetFieldResolver(): boolean { return this.assetFieldResolver_ !== null; }

    /** @internal Include unresolved authored paths in a detached component record. */
    restorePendingAssetPaths(
        entity: Entity, component: AnyComponentDef, data: Record<string, unknown>,
        mapPath?: (path: string) => string | null,
    ): void {
        this.pendingAssetFields_?.restorePaths(entity, component, data, mapPath);
    }

    /** @internal Observe stored asset fields after a component write or removal. */
    onAssetFieldsChanged(observer: (entity: Entity, component: AnyComponentDef) => void): () => void {
        (this.assetFieldObservers_ ??= new Set()).add(observer);
        return () => {
            this.assetFieldObservers_?.delete(observer);
            if (!this.assetFieldObservers_?.size) this.assetFieldObservers_ = undefined;
        };
    }

    private notifyAssetFields_(entity: Entity, component: AnyComponentDef): boolean {
        if (this.assetFieldObservers_ && component.assetFields?.length) {
            const lifetime = this.entityLifetime;
            for (const observer of this.assetFieldObservers_) {
                try { observer(entity, component); }
                catch (error) { log.warn('world', `Asset field observer failed for ${component._name}`, error); }
                if (this.entityLifetime !== lifetime) return false;
            }
        }
        return true;
    }

    /**
     * An engine-backed component's asset fields hold handles, and the engine
     * cannot store a string there: written straight through, `texture` read
     * back as the path while the engine held 0, and nothing drew. A string in
     * one is a path to load — the same ref a scene file carries — so it leaves
     * the data here (the field takes its default until the load lands) and goes
     * to the resolver. An empty string is no path: it names nothing, so it is the
     * default and nobody is asked to load it (`authored` is null when that is all
     * there was). Sent to the resolver it came back unresolved, was written again
     * as a string, and asked for itself for good.
     */
    private takeAssetRefs_(
        component: AnyComponentDef, data: Record<string, unknown> | undefined,
    ): { clean: Record<string, unknown>; authored: Record<string, unknown> | null } | null {
        const fields = (component as { assetFields?: readonly { field: string }[] }).assetFields;
        if (!data || !fields || fields.length === 0) return null;
        let clean: Record<string, unknown> | null = null;
        let paths = false;
        for (const { field } of fields) {
            const value = data[field];
            if (typeof value !== 'string') continue;
            clean ??= { ...data };
            clean[field] = (component._default as Record<string, unknown>)[field] ?? 0;
            if (value !== '') paths = true;
        }
        if (!clean) return null;
        if (!paths) return { clean, authored: null };
        // The resolver is handed the paths only: an empty one beside a real one is already the default above.
        const authored: Record<string, unknown> = { ...data };
        for (const { field } of fields) if (authored[field] === '') authored[field] = clean[field];
        return { clean, authored };
    }

    private assetFieldsWritten_(
        entity: Entity, component: AnyComponentDef, raw: Record<string, unknown> | undefined,
        authored: Record<string, unknown> | null | undefined, keepPlaceholders: boolean, edited?: ReadonlySet<string>,
    ): (() => void) | undefined {
        this.pendingAssetFields_?.supersede(entity, component, raw, keepPlaceholders, edited);
        if (!authored) return;
        if (this.assetFieldResolver_) {
            this.pendingAssetFields_ ??= new PendingAssetFields();
            return this.pendingAssetFields_.reserve(entity, component, authored, this.assetFieldResolver_);
        }
        log.warn('world', `${component._name} on entity ${entity} was given an asset path, but this world has no asset layer `
            + 'to load it: the field holds no handle. Load it first (await assets.loadTexture(path)) and write the handle.');
        return undefined;
    }

    /**
     * Edit a borrowed component and report the write even if the callback throws. A script draft is the stored object.
     * A pending asset path reads as its default handle. Assigning that field, including zero, supersedes the path.
     * Edits to other fields preserve it.
     *
     * @throws if `entity` does not carry `component`.
     */
    update<C extends AnyComponentDef>(
        entity: Entity,
        component: C,
        edit: (draft: ComponentData<C>) => void,
    ): void {
        if (!this.has(entity, component)) {
            throw new Error(
                `update(${component._name}, entity=${entity}): the entity does not carry it. `
                + 'Use insert() or set() to add a component.'
            );
        }
        if (isBuiltinComponent(component)) {
            // A projection, so the write-back is what stores it; `set` owns that
            // for every builtin shape, hierarchy included, and records the change.
            const draft = this.builtin_.get(entity, component) as ComponentData<C>;
            if (this.pendingAssetFields_?.has(entity, component)) trackAssetEdits(draft, component);
            try {
                edit(draft);
            } finally {
                if (this.pendingAssetFields_ && this.set === worldSet) {
                    this.storeComponent_(entity, component, draft, 'edit', assetEditsOf(draft, component));
                } else this.set(entity, component, draft);
            }
            return;
        }
        const draft = this.scripts_.get(entity, component as ComponentDef<any>) as ComponentData<C>;
        try {
            edit(draft);
        } finally {
            // A throwing `edit` has already written to the live object, so the
            // change is reported before the error escapes.
            this.recordComponentWrite_(entity, component);
            if ((component as ComponentDef<any>)._id === Name._id) {
                this.names_.update(entity, (draft as { value: string }).value);
            }
            notifyBridge(this, 'onComponentChanged', entity, component._name);
        }
    }

    /**
     * The component's value, to READ. Writing to the result is deprecated: it
     * stores nothing for an engine-backed component and changes a script one
     * with nothing observing it — use {@link update}, {@link set} or `Mut()`.
     * Asking for a component the entity lacks throws; {@link tryGet} allows it.
     */
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> {
        this.speculation_?.record(this, entity, component);
        if (isBuiltinComponent(component)) {
            return this.builtin_.get(entity, component) as ComponentData<C>;
        }
        return this.scripts_.get(entity, component as ComponentDef<any>) as ComponentData<C>;
    }

    /** @internal Read a snapshot into the caller's existing pose records. */
    [readComponentProjection](entity: Entity, component: AnyComponentDef, into: Record<string, unknown>): void {
        if (this.get !== worldGet || this.speculation_ || !isBuiltinComponent(component)) {
            copyComponentData(into, this.get(entity, component));
        } else {
            this.builtin_.readProjection(entity, component, into);
        }
    }

    /** Whether `entity` carries `component`. */
    has(entity: Entity, component: AnyComponentDef): boolean {
        if (component._builtin) {
            if (!this.builtin_.hasCpp) return false;
            const cppName = (component as BuiltinComponentDef<any>)._cppName;
            // Native systems can change either end of a relationship directly.
            const bset = this.isHierarchyComponent_(component) ? undefined : this.builtin_.getEntitySet(cppName);
            if (bset) return bset.has(entity);
            return this.builtin_.getBuiltinMethods(cppName).has(entity);
        }
        return this.scripts_.has(entity, component as ComponentDef<any>);
    }

    /** {@link get}, answering null instead of throwing when the component is
     *  absent. Reading only, on the same terms — writing to the result is
     *  deprecated; {@link update} is the edit. */
    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null {
        this.speculation_?.record(this, entity, component);
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;
            const bset = this.isHierarchyComponent_(component) ? undefined : this.builtin_.getEntitySet(component._cppName);
            if (bset && !bset.has(entity)) return null;
            try {
                const fromHeap = this.builtin_.readHeap(entity, component._cppName);
                if (fromHeap !== null) return fromHeap as ComponentData<C>;
                const methods = this.builtin_.getBuiltinMethods(component._cppName);
                if (!bset && !methods.has(entity)) return null;
                return builtinFromWasm(methods.get(entity), component) as ComponentData<C>;
            } catch (e) {
                handleWasmError(e, `tryGet(${component._name}, entity=${entity})`);
                return null;
            }
        }
        const storage = this.scripts_.getStorageById(component._id as symbol);
        if (!storage) return null;
        const val = storage.get(entity);
        return val !== undefined ? val as ComponentData<C> : null;
    }

    /** Take `component` off `entity`. Throws during query iteration, as
     *  {@link spawn} does. */
    remove(entity: Entity, component: AnyComponentDef): void {
        this.speculation_?.record(this, entity, component);
        if (this.isIterating()) {
            throw new Error(
                'Cannot remove component during query iteration. ' +
                'Use Commands to defer component removal until after iteration completes.'
            );
        }

        if (component._id === Parent._id) {
            this.removeParent(entity);
            return;
        }
        if (component._id === Children._id) {
            const lifetime = this.entityLifetime;
            for (const child of this.childEntitiesOf_(entity)) {
                this.removeParent(child);
                if (this.entityLifetime !== lifetime) break;
            }
            return;
        }

        if (isBuiltinComponent(component)) {
            this.builtin_.remove(entity, component);
            this.pendingAssetFields_?.supersede(entity, component);
            this.finishComponentRemoval_(entity, component);
        } else {
            this.removeScript_(entity, component as ComponentDef<any>);
        }
    }

    // =========================================================================
    // Component storage and write notifications
    // =========================================================================

    private insertBuiltin_<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>, edited?: ReadonlySet<string>,
        unresolved?: ReadonlyMap<string, string>): T {
        const raw = data as Record<string, unknown> | undefined;
        const refs = this.takeAssetRefs_(component, raw);
        const { merged, isNew } = this.builtin_.insert(entity, component, (refs?.clean ?? data) as Partial<T>);
        const start = this.assetFieldsWritten_(entity, component, raw, refs?.authored, edited !== undefined, edited);
        if (unresolved?.size) (this.pendingAssetFields_ ??= new PendingAssetFields()).remember(entity, component, new Map(unresolved));
        this.finishComponentWrite_(entity, component, merged, isNew, start);
        return merged;
    }

    private insertScript_<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): T {
        const { value, isNew } = this.scripts_.insert(entity, component, data);
        this.finishComponentWrite_(entity, component, value, isNew);
        return value;
    }

    private finishComponentWrite_(
        entity: Entity, component: AnyComponentDef, value: unknown, isNew: boolean, start?: () => void,
    ): void {
        if (isNew) {
            this.queries_.markComponentDirty(component._id);
            this.queries_.markStructuralChange();
            this.changes_.recordAdded(component, entity);
            if (!notifyBridge(this, 'onComponentAdded', entity, component._name)) return;
        }
        if (!this.recordComponentWrite_(entity, component)) return;
        if (component._id === Name._id) {
            this.names_.update(entity, (value as { value: string }).value);
        }
        if (notifyBridge(this, 'onComponentChanged', entity, component._name)) start?.();
    }

    private removeScript_<T>(entity: Entity, component: ComponentDef<T>): void {
        if (component._id === Name._id) {
            this.names_.remove(entity);
        }
        this.scripts_.remove(entity, component);
        if (component._id === Disabled._id) this.builtin_.getCppRegistry()?.setEntityEnabled?.(entity, true);
        this.finishComponentRemoval_(entity, component);
    }

    private finishComponentRemoval_(entity: Entity, component: AnyComponentDef): void {
        this.changes_.recordRemoved(component, entity);
        this.queries_.markComponentDirty(component._id);
        this.queries_.markStructuralChange();
        const observers = this.componentRemovalObservers_?.get(component._id);
        if (observers) {
            const lifetime = this.entityLifetime;
            for (const observer of observers) {
                try { observer(entity); }
                catch (error) { log.warn('world', `Component removal observer failed for ${component._name}`, error); }
                if (this.entityLifetime !== lifetime) return;
            }
        }
        if (this.notifyAssetFields_(entity, component)) notifyBridge(this, 'onComponentRemoved', entity, component._name);
    }

    // =========================================================================
    // Name Index
    // =========================================================================

    /** The entity with this {@link Name}, or null. Names are not identities —
     *  with two matches, which one comes back is not defined. */
    findEntityByName(name: string): Entity | null {
        return this.names_.findByName(name);
    }

    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef, mode: 'borrowed' | 'retained' = 'borrowed', mutable = false):
    ((entity: Entity) => unknown) | null {
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;

            const read = this.resolveBuiltinGetter_(component, mode);
            if (!mutable || !component.assetFields?.length) return read;
            return entity => {
                let draft = read(entity) as Record<string, unknown>;
                if (this.pendingAssetFields_?.has(entity, component)) {
                    // The pointer getter reuses a borrowed object on the next entity.
                    if (mode === 'borrowed') draft = { ...draft };
                    trackAssetEdits(draft, component);
                } else if (mode === 'retained' && this.assetFieldResolver_) rememberAssetDraft(draft);
                return draft;
            };
        }
        const storage = this.scripts_.getStorageById(component._id);
        if (!storage) return null;
        return (e) => storage.get(e);
    }

    private resolveBuiltinGetter_(component: BuiltinComponentDef<any>, mode: 'borrowed' | 'retained'): (entity: Entity) => unknown {
        if (this.builtin_.getWasmModule()) {
            const ptrGetter = this.builtin_.resolvePtrGetter(component._cppName, mode);
            if (ptrGetter) return ptrGetter;
        }
        const methods = this.builtin_.getBuiltinMethods(component._cppName);
        const plain = component.colorKeys.length === 0 && component.entityFields.length === 0
            && numberListFieldsOf(component._cppName).length === 0;
        if (plain) return e => methods.get(e);
        return e => builtinFromWasm(methods.get(e), component);
    }

    /** @internal Pre-resolve a component to a direct has-check for fast query matching. */
    resolveHas(component: AnyComponentDef): ((entity: Entity) => boolean) | null {
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;
            const methods = this.builtin_.getBuiltinMethods(component._cppName);
            return (e) => methods.has(e);
        }
        const storage = this.scripts_.getStorageById(component._id);
        if (!storage) return null;
        return (e) => storage.has(e);
    }

    /** @internal Pre-resolve a component to a direct setter for fast Mut write-back. */
    resolveSetter(component: AnyComponentDef): ((entity: Entity, data: unknown) => void) | null {
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;
            const write = this.resolveBuiltinSetter_(component);
            if (!component.assetFields?.length) return write;
            return (entity, data) => {
                const raw = data as Record<string, unknown>;
                const edited = assetEditsOf(raw, component);
                if (edited && this.has(entity, component)) {
                    // A retained row can outlive publication. Keep the current handles wherever the row has no edit.
                    const live = this.builtin_.get(entity, component);
                    for (const { field } of component.assetFields) if (!edited.has(field) && raw[field] !== live[field]) {
                        raw[field] = live[field];
                        edited.delete(field);
                    }
                }
                const refs = this.takeAssetRefs_(component, raw);
                write(entity, refs?.clean ?? raw);
                const start = this.assetFieldsWritten_(entity, component, raw, refs?.authored, true, edited);
                finishAssetDraft(raw, component, refs?.clean);
                if (this.notifyAssetFields_(entity, component)) start?.();
            };
        }
        // Through ScriptStorage, not into the map: a pooled component's stored
        // value is a live view onto its row, and replacing it with a plain
        // object would leave the row behind.
        const storage = this.scripts_.getStorageById(component._id);
        if (!storage) return null;
        return (e, d) => {
            this.scripts_.set(e, component as ComponentDef<any>, d);
            this.notifyAssetFields_(e, component);
        };
    }

    private resolveBuiltinSetter_(component: BuiltinComponentDef<any>): (entity: Entity, data: unknown) => void {
        if (this.builtin_.getWasmModule()) {
            const ptrSetter = this.builtin_.resolvePtrSetter(component._cppName);
            // Pointer writes bypass the engine's own change stamp, including the one transform composition reads.
            if (ptrSetter) {
                if (!feedsTransformComposition(component)) return (e, d) => { ptrSetter(e, d); this.stampEngineWrite(e, component); };
                return (e, d) => { ptrSetter(e, d); this.stampEngineWrite(e, component); this.builtin_.invalidateTransformComposition(); };
            }
        }
        const name = component._cppName;
        if (component.colorKeys.length === 0 && component.entityFields.length === 0 && numberListFieldsOf(name).length === 0) {
            const methods = this.builtin_.getBuiltinMethods(name);
            return (e, d) => methods.add(e, d);
        }
        // Lists and other marshalled fields use the same conversion as world.set and insert.
        return (e, d) => this.builtin_.replace(e, component, d as Record<string, unknown>);
    }

    // =========================================================================
    // Query Support
    // =========================================================================

    /** @internal Per-frame reuse of the query instance pool. */
    resetQueryPool(): void {
        // No-op: query pool removed, results stored directly in cache
    }

    /** The names of every component on `entity` — for inspectors and diagnostics;
     *  a system asks {@link has} about the definitions it knows. */
    getComponentTypes(entity: Entity): string[] {
        return this.componentTypes_(entity);
    }

    /** @internal Stored script definitions still describe their rows after the app catalogue reloads. */
    getStoredScriptComponents(entity?: Entity): Iterable<ComponentDef<any>> {
        return this.scripts_.componentsOf(entity);
    }

    /**
     * @internal Says to every `Added` filter that `entity`'s components arrived now: for content written while switched
     * off and switched on whole (a streamed cell, see `ChangeTracker.restampAdded`). Free when nothing filters on `Added`.
     */
    restampAdded(entity: Entity): void {
        // Over what is tracked (nearly always nothing), not over the entity's components: a cell of thousands of entities
        // asks a few dozen types each, and that was milliseconds spent in the frame the cell appears.
        for (const def of this.changes_.trackedDefinitions()) {
            if (this.has(entity, def)) this.changes_.restampAdded(def, entity);
        }
    }

    /** @internal Inspect a group with one script catalogue index, preserving input order. */
    getComponentTypesBatch(entities: readonly Entity[]): string[][] {
        if (entities.length === 0) return [];
        const scriptNames = getUserComponentNamesById();
        return entities.map(entity => this.componentTypes_(entity, scriptNames));
    }

    private componentTypes_(entity: Entity, scriptNames?: ReadonlyMap<symbol, string>): string[] {
        const names = this.builtin_.componentNames(entity);
        const types = new Set<string>(names ?? []);
        const methods = this.builtin_.getMethodCache();
        for (const [name, binding] of names === null ? methods : this.builtin_.getExtraMethodCache()) {
            try { if (binding.has(entity)) types.add(name); } catch (e) { log.warn('world', `Component check failed for ${name}`, e); }
        }
        if (this.builtin_.hasCpp) {
            for (const [name, comp] of names === null ? builtinComponentRegistry() : extraBuiltinComponentRegistry()) {
                if (isBuiltinComponent(comp) && !methods.has(name)) {
                    try {
                        const m = this.builtin_.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.add(name);
                    } catch (e) { log.warn('world', `Builtin check failed for ${name}`, e); }
                }
            }
        }
        const ids = this.scripts_.getEntityComponentIds(entity);
        if (ids) {
            const names = scriptNames ?? getUserComponentNamesById();
            for (const id of ids) {
                const name = names.get(id);
                if (name !== undefined) types.add(name);
            }
        }
        return Array.from(types);
    }


    /**
     * Every entity switched off, ITSELF or by an ancestor.
     *
     * Derived, not tagged down the tree: a scene that wrote the tag on each
     * descendant would lose which of them the author switched off. Recomputed
     * when the tag or the hierarchy moves; free when nothing is switched off.
     */
    private inactiveEntities_(): { has(entity: Entity): boolean } | null {
        const core = this.builtin_.getCppRegistry();
        if (core?.isEntityActive && core.hasInactiveEntities) {
            return core.hasInactiveEntities() ? { has: e => !core.isEntityActive!(e) } : null;
        }
        const storage = this.scripts_.getStorageById(Disabled._id);
        if (!storage || storage.size === 0) return null;
        // One version covers both halves: a re-parent in a world that has anything
        // switched off bumps the tag's version too (see trackHierarchyWrite_).
        const version = this.queries_.componentVersion(Disabled._id);
        if (this.inactive_ && this.inactiveVersion_ === version) return this.inactive_.set;

        const set = new Set<Entity>();
        const walk = (entity: Entity): void => {
            if (set.has(entity)) return;
            set.add(entity);
            if (!this.has(entity, Children)) return;
            for (const child of (this.get(entity, Children) as ChildrenData).entities) {
                walk(child as Entity);
            }
        };
        for (const entity of storage.keys()) walk(entity as Entity);
        this.inactive_ = { set };
        this.inactiveVersion_ = version;
        return set;
    }

    private resolveStorages_(
        comps: AnyComponentDef[],
        scriptOut: Map<Entity, unknown>[],
        builtinOut: BuiltinMethods[],
        required = true,
    ): boolean {
        for (const comp of comps) {
            if (isBuiltinComponent(comp)) {
                if (this.builtin_.hasCpp) builtinOut.push(this.builtin_.getBuiltinMethods(comp._cppName));
                else if (required) return false;
            } else {
                const storage = this.scripts_.getStorageById(comp._id);
                if (storage) scriptOut.push(storage);
                else if (required) return false;
            }
        }
        return true;
    }

    /** Scanning and sorting a rare tag can be cheaper than testing every entity in world order. */
    private sparseWorldFilter_(filters: Map<Entity, unknown>[]): Map<Entity, unknown> | null {
        let smallest = filters[0];
        for (const storage of filters) {
            if (storage.size < smallest.size) smallest = storage;
        }
        return smallest.size * Math.log2(smallest.size + 1) < this.entities_.size ? smallest : null;
    }

    /**
     * Entities carrying every component in `components`, narrowed by `with` and
     * `without`. Answered from the query cache, so calling it every frame is the
     * intended use; the array is the cache's own and must not be mutated.
     *
     * @public
     */
    getEntitiesWithComponents(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[] = NO_COMPONENTS,
        withoutFilters: AnyComponentDef[] = NO_COMPONENTS,
    ): readonly Entity[] {
        return this.queryEntities(components, withFilters, withoutFilters);
    }

    /** @internal All rows of one component, including entities inactive through an ancestor. */
    getStoredComponentEntities(component: AnyComponentDef): Iterable<Entity> {
        if (!isBuiltinComponent(component)) return this.scripts_.entitiesOf(component);
        return this.collectQueryEntities_([component], NO_COMPONENTS, NO_COMPONENTS, true);
    }

    /**
     * @internal The same walk, with the cache key, dependency ids and predicate
     * filter supplied by the caller. `QueryInstance` computes those once per
     * query so a cache hit allocates nothing — which is why they are not
     * parameters of the frozen door above: they are the cache's shape, and
     * freezing them would freeze it.
     */
    queryEntities(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[] = NO_COMPONENTS,
        withoutFilters: AnyComponentDef[] = NO_COMPONENTS,
        precomputedKey?: string,
        filter?: QueryFilter,
        precomputedDepIds?: symbol[],
    ): readonly Entity[] {
        return this.collectQueryEntities_(components, withFilters, withoutFilters, false, precomputedKey, filter, precomputedDepIds);
    }

    private collectQueryEntities_(
        components: AnyComponentDef[], withFilters: AnyComponentDef[], withoutFilters: AnyComponentDef[],
        includeInactive: boolean, precomputedKey?: string, filter?: QueryFilter, precomputedDepIds?: symbol[],
    ): readonly Entity[] {
        this.syncActivityEpoch_();
        // The dep-id set is static per query; QueryInstance precomputes it (incl.
        // filter deps) so cache-hit iteration allocates nothing here.
        let cacheKey = precomputedKey;
        let depIds = precomputedDepIds;
        if (cacheKey === undefined && depIds === undefined && !filter
            && withFilters.length === 0 && withoutFilters.length === 0
            && components.length <= 2) {
            const plan = plainQueryPlan(components);
            cacheKey = plan.key;
            depIds = plan.depIds;
        }
        cacheKey ??= computeQueryCacheKey(components, withFilters, withoutFilters);
        if (includeInactive) cacheKey = 'stored|' + cacheKey;
        depIds ??= queryDepIds(components, withFilters, withoutFilters, filter?.deps);
        const hierarchyMask = (depIds as QueryDependencyIds).hierarchyMask ?? hierarchyQueryMask(depIds);
        if (hierarchyMask & PARENT_QUERY_DEP) this.syncHierarchyQueryStamp_(Parent);
        if (hierarchyMask & CHILDREN_QUERY_DEP) this.syncHierarchyQueryStamp_(Children);
        if (hierarchyMask & HIERARCHY_CONTENT_QUERY_DEP) this.syncHierarchyContentStamp_();
        const standing = this.queries_.lookup(cacheKey, depIds);
        if (standing) return standing;

        // `Disabled`'s whole contract is that the systems skip it, answered once
        // here rather than remembered at 78 call sites. A query that NAMES the
        // tag is the exception: managing the switch means seeing it.
        const namesDisabled = components.includes(Disabled)
            || withFilters.includes(Disabled) || withoutFilters.includes(Disabled);

        return this.queries_.getOrCompute(cacheKey, depIds, () => {
            const population = !components.length && !withFilters.length;
            if (population) this.tracksPopulation_ = true;
            const off = includeInactive || namesDisabled ? null : this.inactiveEntities_();

            const reqScript: Map<Entity, unknown>[] = [];
            const reqBuiltin: BuiltinMethods[] = [];
            if (!this.resolveStorages_(components, reqScript, reqBuiltin)) {
                return [];
            }
            if (!off && !filter && !withFilters.length && !withoutFilters.length && !reqBuiltin.length) {
                if (population && !this.reservedSpawns_?.entities.size) return this.getAllEntities();
                if (reqScript.length === 1) return Array.from(reqScript[0].keys());
            }

            // The requested components determine iteration order independently of the filters.
            let smallestSet: { keys(): IterableIterator<Entity>; size: number } | null = null;
            let smallestSize = Infinity;
            for (let i = 0; i < reqScript.length; i++) {
                const size = reqScript[i].size;
                if (size < smallestSize) {
                    smallestSize = size;
                    smallestSet = reqScript[i];
                }
            }
            for (const comp of components) {
                // The SDK's relationship sets cannot enumerate entities linked by the core.
                if (isBuiltinComponent(comp) && !this.isHierarchyComponent_(comp)) {
                    const bset = this.builtin_.getEntitySet(comp._cppName);
                    if (bset && bset.size < smallestSize) {
                        smallestSize = bset.size;
                        smallestSet = bset;
                    }
                }
            }

            if (withFilters.length && !this.resolveStorages_(withFilters, reqScript, reqBuiltin)) return [];
            let woScript: Map<Entity, unknown>[] | null = null;
            let woBuiltin: BuiltinMethods[] | null = null;
            if (withoutFilters.length) {
                woScript = [];
                woBuiltin = [];
                this.resolveStorages_(withoutFilters, woScript, woBuiltin, false);
            }
            const sparse = !components.length && reqScript.length && !filter ? this.sparseWorldFilter_(reqScript) : null;
            const hierarchy = hierarchyMask && !smallestSet && !sparse
                ? (components.length ? components : withFilters).find(comp => this.isHierarchyComponent_(comp))
                : undefined;
            const candidates = (hierarchy && this.readHierarchyQueryCandidates_(hierarchy._id === Children._id))
                || (smallestSet ?? sparse ?? this.entities_).keys();

            const entities: Entity[] = [];
            candidate: for (const entity of candidates) {
                if (population && this.reservedSpawns_?.entities.has(entity)) continue;
                if (sparse && !this.entities_.has(entity)) continue;
                // Test script membership before crossing into the core for activity or builtin membership.
                for (let i = 0; i < reqScript.length; i++) {
                    if (!reqScript[i].has(entity)) continue candidate;
                }
                if (woScript) {
                    for (let i = 0; i < woScript.length; i++) {
                        if (woScript[i].has(entity)) continue candidate;
                    }
                }
                if (off?.has(entity)) continue;
                for (let i = 0; i < reqBuiltin.length; i++) {
                    if (!reqBuiltin[i].has(entity)) continue candidate;
                }
                if (woBuiltin) {
                    for (let i = 0; i < woBuiltin.length; i++) {
                        if (woBuiltin[i].has(entity)) continue candidate;
                    }
                }
                if (!filter || filter.match(entity)) entities.push(entity);
            }

            // Filter-only queries observe world order, even when tags were attached in another order.
            if (sparse) entities.sort((a, b) => this.entities_.get(a)! - this.entities_.get(b)!);
            return entities;
        });
    }

    // =========================================================================
    // Change Detection (delegates to ChangeTracker)
    // =========================================================================

    /** @internal The frame runner's clock for change detection. */
    advanceTick(): void {
        this.changes_.advanceTick();
        this.flushEngineStamps();
        // Once a frame, while the audit is on: the engine compares its components with the copy it kept and counts each one
        // whose bytes changed without a change stamp (Registry::auditChanges).
        if (this.changeAudit_) this.builtin_.getCppRegistry()?.auditChanges?.();
    }

    private changeAudit_ = false;
    /** Engine type id by component, -1 where the engine has none; dropped when the engine's registry is replaced. */
    private readonly engineTypeIds_ = new Map<AnyComponentDef, number>();
    private engineTypeIdsFor_: unknown = null;
    private clearStampFlusher_?: () => void;

    /** The engine-heap block stamps are handed over in, its room in pairs, and whose heap it is in. */
    private stampBuffer_ = 0;
    private stampBufferPairs_ = 0;
    private stampBufferApi_: ReturnType<typeof worldEngineApi> = null;

    private releaseStampBuffer_(): void {
        const ptr = this.stampBuffer_, api = this.stampBufferApi_;
        this.stampBuffer_ = 0;
        this.stampBufferPairs_ = 0;
        this.stampBufferApi_ = null;
        if (ptr !== 0) api?._free?.(ptr);
    }

    /** (engine type id, entity) pairs waiting to be stamped in the engine; see flushEngineStamps. */
    private stampPairs_ = new Uint32Array(2 * 256);
    private stampCount_ = 0;
    private static readonly STAMP_BATCH = 8192;

    /**
     * @internal Stamps an engine component as written, in the engine, without telling this world's Changed() queries: what a
     * write path deliberately outside them (physics moving bodies) still owes the engine's own readers of changes. Every write
     * through set/insert/update/markChanged comes here too. Batched, and handed over by flushEngineStamps.
     */
    stampEngineWrite(entity: Entity, component: AnyComponentDef): void {
        if (!isBuiltinComponent(component)) return;
        const registry = this.builtin_.getCppRegistry();
        if (!registry?.componentTypeId) return;
        if (this.engineTypeIdsFor_ !== registry) {
            this.flushEngineStamps();
            this.engineTypeIds_.clear();
            this.engineTypeIdsFor_ = registry;
            this.clearStampFlusher_ = registerEngineStampFlush(registry, () => this.flushEngineStamps());
        }
        let id = this.engineTypeIds_.get(component);
        if (id === undefined) {
            id = registry.componentTypeId(component._cppName);
            this.engineTypeIds_.set(component, id);
        }
        if (id < 0) return;
        if (this.stampCount_ * 2 >= this.stampPairs_.length) {
            const grown = new Uint32Array(this.stampPairs_.length * 2);
            grown.set(this.stampPairs_);
            this.stampPairs_ = grown;
        }
        this.stampPairs_[this.stampCount_ * 2] = id;
        this.stampPairs_[this.stampCount_ * 2 + 1] = entity as number;
        if (++this.stampCount_ >= World.STAMP_BATCH) this.flushEngineStamps();
    }

    /**
     * @internal Hands the batched stamps to the engine: one call where it takes a list (registry_markComponentsChanged), one each
     * where it does not. The render pipeline calls it before the frame's transforms are composed, and the frame's tick before the
     * audit; anything else in the engine that reads changes has to come after one of the two.
     */
    flushEngineStamps(): void {
        const count = this.stampCount_;
        if (count === 0) return;
        this.stampCount_ = 0;
        const registry = this.builtin_.getCppRegistry();
        if (!registry || registry !== this.engineTypeIdsFor_) return;
        const api = worldEngineApi(this);
        if (api?.registry_markComponentsChanged && api._malloc && api._free && api.HEAPU32) {
            // One block in the engine's heap, kept and grown: a hand-over a frame allocates nothing.
            if (this.stampBuffer_ === 0 || this.stampBufferPairs_ < count || this.stampBufferApi_ !== api) {
                this.releaseStampBuffer_();
                this.stampBufferPairs_ = Math.max(count, 1024);
                this.stampBuffer_ = api._malloc(this.stampBufferPairs_ * 8);
                this.stampBufferApi_ = api;
            }
            if (this.stampBuffer_ !== 0) {
                // The view is asked for after the allocation: a heap that grew detached the one from before.
                api.HEAPU32.set(this.stampPairs_.subarray(0, count * 2), this.stampBuffer_ >>> 2);
                api.registry_markComponentsChanged(registry, this.stampBuffer_, count);
                return;
            }
        }
        if (!registry.markComponentChanged) return;
        for (let i = 0; i < count; i++) registry.markComponentChanged(this.stampPairs_[i * 2]!, this.stampPairs_[i * 2 + 1]!);
    }

    /**
     * @internal Turns on the engine's change audit, for tests and gates: every frame from here on, a component written without
     * a change stamp is counted, and its type named in the log the first time. It copies every component once a frame.
     */
    setChangeAudit(enabled: boolean): void {
        const registry = this.builtin_.getCppRegistry();
        registry?.setChangeAudit?.(enabled);
        this.changeAudit_ = enabled && typeof registry?.auditChanges === 'function';
    }

    /** @internal Component writes the audit has found without a change stamp since it was turned on. */
    changeAuditTotal(): number {
        return this.builtin_.getCppRegistry()?.changeAuditTotal?.() ?? 0;
    }

    /** @internal */
    getWorldTick(): number {
        return this.changes_.getWorldTick();
    }

    /** @internal Opted into by a query that declares an Added/Changed filter;
     *  tracking every component would cost every write. */
    enableChangeTracking(component: AnyComponentDef): void {
        this.changes_.enableChangeTracking(component);
    }

    /** @internal Opt a system query into precise change boundaries, separately from tick sampling. */
    enableChangeSequenceTracking(component: AnyComponentDef, added: boolean): void {
        this.changes_.enableChangeSequenceTracking(component, added);
    }

    /** @internal Latest opted-in component mutation sequence. */
    getChangeSequence(): number { return this.changes_.getChangeSequence(); }

    /** @internal Bind a live sequence index once for a system query's entity loop. */
    resolveChangeSequenceMatcher(component: AnyComponentDef, added: boolean): (entity: Entity, after: number) => boolean {
        return this.changes_.resolveChangeSequenceMatcher(component, added);
    }

    /** @internal Live additions after a completed system boundary. */
    isAddedAfterSequence(entity: Entity, component: AnyComponentDef, after: number): boolean {
        return this.changes_.isAddedAfterSequence(entity, component, after);
    }

    /** @internal Live changes after a completed system boundary. */
    isChangedAfterSequence(entity: Entity, component: AnyComponentDef, after: number): boolean {
        return this.changes_.isChangedAfterSequence(entity, component, after);
    }

    /** @internal O(1) empty-window checks before enumerating system query candidates. */
    anyAddedAfterSequence(component: AnyComponentDef, after: number): boolean {
        return this.changes_.anyAddedAfterSequence(component, after);
    }

    /** @internal O(1) empty-window checks before enumerating system query candidates. */
    anyChangedAfterSequence(component: AnyComponentDef, after: number): boolean {
        return this.changes_.anyChangedAfterSequence(component, after);
    }

    /** @internal Opt in to live component identities, independent of frame ticks. */
    enableIncarnationTracking(component: AnyComponentDef): void {
        this.changes_.enableIncarnationTracking(component);
    }

    /** @internal Changes on remove/reinsert, including multiple edits in one tick.
     * Components present before tracking was enabled share the initial identity 0. */
    getComponentIncarnation(entity: Entity, component: AnyComponentDef): number {
        return this.changes_.getComponentIncarnation(entity, component);
    }

    /** @internal What `Added`/`Changed` filters are implemented in terms of. */
    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.isAddedSince(entity, component, sinceTick);
    }

    /** @internal */
    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.isChangedSince(entity, component, sinceTick);
    }

    /** @internal True if ANY entity changed `component` after `sinceTick` (O(1) gate). */
    anyChangedSince(component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.anyChangedSince(component, sinceTick);
    }

    /** @internal What a `Removed` query reads. */
    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.changes_.getRemovedEntitiesSince(component, sinceTick);
    }

    /** @internal A tick-based removal lease for samples after the current tick. */
    registerRemovedReader(component: AnyComponentDef): number {
        return this.changes_.registerRemovedReader(component);
    }

    /** @internal A removal lease starting at the current event sequence. */
    registerRemovedCursorReader(component: AnyComponentDef): number {
        return this.changes_.registerRemovedCursorReader(component);
    }

    /** @internal Latest removal sequence, independent of frame ticks. */
    getRemovalSequence(): number { return this.changes_.getRemovalSequence(); }

    /** @internal Unacknowledged removals belonging to this cursor reader. */
    getRemovedEntitiesForReader(component: AnyComponentDef, readerId: number, since?: number): Entity[] {
        return this.changes_.getRemovedEntitiesForReader(component, readerId, since);
    }

    /** @internal Release only events this run observed, preserving later removals. */
    advanceRemovedCursorReader(component: AnyComponentDef, readerId: number, through: number): void {
        this.changes_.advanceRemovedCursorReader(component, readerId, through);
    }

    /** @internal A claim from an explicit tick, for a reader that reads with an
     *  overlap rather than "since I last ran". */
    registerRemovedReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        return this.changes_.registerRemovedReaderFrom(component, retainFromTick);
    }

    /** @internal That reader is done with everything up to `lastRunTick`. */
    advanceRemovedReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.changes_.advanceRemovedReader(component, readerId, lastRunTick);
    }

    /** @internal The reader is gone; its share of the watermark goes with it. */
    disposeRemovedReader(component: AnyComponentDef, readerId: number): void {
        this.changes_.disposeRemovedReader(component, readerId);
    }

    /** @internal How many readers hold `component`'s removal history. */
    removedReaderCount(component: AnyComponentDef): number {
        return this.changes_.removedReaderCount(component);
    }

    /** @internal A claim on `component`'s MEMBERSHIP journal — who gained or
     *  lost it — independent of ordinary change tracking. */
    registerTopologyReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        return this.changes_.registerTopologyReaderFrom(component, retainFromTick);
    }

    /** @internal A mutation cursor distinguishes writes within one world tick. */
    registerMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology'): number {
        return this.changes_.registerMutationCursor(component, kind);
    }

    /** @internal Current boundary to acknowledge after a successful read. */
    mutationSequence(kind: 'write' | 'topology'): number { return this.changes_.mutationSequence(kind); }

    /** @internal Allows readers of several component revisions to skip polling them while none changed. */
    get observedMutationRevision(): number { return this.changes_.observedMutationRevision; }

    /** @internal Component stamps survive released mutation-history readers. */
    mutationRevision(component: AnyComponentDef, kind: 'write' | 'topology'): number {
        return this.changes_.mutationRevision(component, kind);
    }

    /** @internal Unacknowledged component mutations for this reader. */
    mutationsForCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number): Entity[] {
        return this.changes_.mutationsForCursor(component, kind, reader);
    }

    /** @internal Preserve mutations that arrived after the read's boundary. */
    advanceMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number, through: number): void {
        this.changes_.advanceMutationCursor(component, kind, reader, through);
    }

    /** @internal Release this reader's history claim. */
    disposeMutationCursor(component: AnyComponentDef, kind: 'write' | 'topology', reader: number): void {
        this.changes_.disposeMutationCursor(component, kind, reader);
    }

    /** @internal Entities worth re-reading because their membership moved. */
    getTopologyChangedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.changes_.getTopologyChangedEntitiesSince(component, sinceTick);
    }

    /** @internal That reader is done with everything up to `lastRunTick`. */
    advanceTopologyReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.changes_.advanceTopologyReader(component, readerId, lastRunTick);
    }

    /** @internal The reader is gone; its share of the watermark goes with it. */
    disposeTopologyReader(component: AnyComponentDef, readerId: number): void {
        this.changes_.disposeTopologyReader(component, readerId);
    }

    /** @internal How many readers hold `component`'s membership journal. */
    topologyReaderCount(component: AnyComponentDef): number {
        return this.changes_.topologyReaderCount(component);
    }

    /** @internal A claim on `component`'s WRITE journal — which entities had it
     *  written, enumerable sparsely, unlike the per-entity changed map. */
    registerWriteReaderFrom(component: AnyComponentDef, retainFromTick: number): number {
        return this.changes_.registerWriteReaderFrom(component, retainFromTick);
    }

    /** @internal Entities whose `component` was written after `sinceTick`. */
    getWrittenEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.changes_.getWrittenEntitiesSince(component, sinceTick);
    }

    /** @internal An O(1) upper bound on what `getWrittenEntitiesSince` returns,
     *  for a caller choosing between reading the journal and a scan. */
    bufferedWriteRows(component: AnyComponentDef): number {
        return this.changes_.bufferedWriteRows(component);
    }

    /** @internal That reader is done with everything up to `lastRunTick`. */
    advanceWriteReader(component: AnyComponentDef, readerId: number, lastRunTick: number): void {
        this.changes_.advanceWriteReader(component, readerId, lastRunTick);
    }

    /** @internal The reader is gone; its share of the watermark goes with it. */
    disposeWriteReader(component: AnyComponentDef, readerId: number): void {
        this.changes_.disposeWriteReader(component, readerId);
    }

    /** @internal How many readers hold `component`'s write journal. */
    writeReaderCount(component: AnyComponentDef): number {
        return this.changes_.writeReaderCount(component);
    }

    /**
     * @internal One place for "this component was written".
     *
     * The composition epoch hangs off the LOGICAL mutation contract, not off the
     * storage path: `set`, `insert`, `update` and a `Mut` write-back all arrive
     * here whether or not the fast pointer setter moved the bytes.
     */
    private recordComponentWrite_(entity: Entity, component: AnyComponentDef): boolean {
        if (component._id === Disabled._id) this.builtin_.getCppRegistry()?.setEntityEnabled?.(entity, false);
        // An engine component's write is stamped where the engine keeps it, beside the component: the engine's own readers
        // (the renderer) ask there what changed, whoever wrote it.
        if (isBuiltinComponent(component)) this.stampEngineWrite(entity, component);
        if (feedsTransformComposition(component)) {
            this.builtin_.invalidateTransformComposition();
        }
        this.changes_.recordChanged(component, entity);
        return this.notifyAssetFields_(entity, component);
    }

    private syncActivityEpoch_(): void {
        const epoch = this.builtin_.getCppRegistry()?.activityEpoch?.();
        if (epoch === undefined || epoch === this.coreActivityEpoch_) return;
        if (this.coreActivityEpoch_ === -1) { this.coreActivityEpoch_ = epoch; return; }
        this.coreActivityEpoch_ = epoch;
        this.queries_.markComponentDirty(Disabled._id);
        this.queries_.markStructuralChange();
    }

    private syncHierarchyQueryStamp_(component: BuiltinComponentDef<any>): void {
        const registry = this.builtin_.getCppRegistry();
        if (!registry) return;
        let stamp = this.hierarchyQueryStamps_.get(component._id);
        if (!stamp) {
            stamp = { type: registry.componentTypeId?.(component._cppName) ?? -1, revision: -1 };
            this.hierarchyQueryStamps_.set(component._id, stamp);
        }
        // A core without a revision cannot certify that a cached answer still holds.
        const revision = stamp.type < 0 ? -1
            : worldEngineApi(this)?.registry_componentMutationRevision?.(registry, stamp.type, true) ?? -1;
        if (revision >= 0 && revision === stamp.revision) return;
        stamp.revision = revision;
        this.queries_.markComponentDirty(component._id);
    }

    private syncHierarchyContentStamp_(): void {
        const registry = this.builtin_.getCppRegistry();
        if (!registry) return;
        const revision = worldEngineApi(this)?.registry_hierarchyRevision?.(registry) ?? -1;
        if (revision >= 0 && revision === this.hierarchyContentStamp_) return;
        this.hierarchyContentStamp_ = revision;
        this.queries_.markComponentDirty(HIERARCHY_CONTENT);
    }

    private readHierarchyQueryCandidates_(children: boolean): Entity[] | null {
        const registry = this.builtin_.getCppRegistry(), core = worldEngineApi(this);
        if (!registry || !core?.registry_readHierarchyMembers || !core._malloc || !core._free || !core.HEAPU32) return null;
        const count = core.registry_readHierarchyMembers(registry, children, 0, 0);
        // A dense result is cheaper to walk in world order than to copy and sort.
        if (!Number.isInteger(count) || count < 0 || count * 8 > this.entities_.size) return null;
        if (count === 0) return [];
        const allocator = { _malloc: core._malloc.bind(core), _free: core._free.bind(core) };
        return withMalloc(allocator, count * Uint32Array.BYTES_PER_ELEMENT, ptr => {
            if (!ptr || core.registry_readHierarchyMembers!(registry, children, ptr, count) !== count) return null;
            const members = core.HEAPU32!.subarray(ptr >>> 2, (ptr >>> 2) + count);
            const candidates: Entity[] = [];
            for (const raw of members) {
                const entity = raw as Entity;
                if (this.entities_.has(entity)) candidates.push(entity);
            }
            candidates.sort((a, b) => this.entities_.get(a)! - this.entities_.get(b)!);
            return candidates;
        });
    }

    /** @internal Say composed world transforms are stale, for a producer that wrote the bytes without going through the
     *  mutation seam: with no stamp to say which, the next composition composes everything. */
    invalidateTransformComposition(): void {
        this.builtin_.invalidateUnstampedTransforms();
    }

    /** @internal Say composed world transforms are stale, for a producer that stamped every Transform it wrote
     *  (stampEngineWrite): the next composition recomposes those and what is under them. */
    invalidateStampedTransforms(): void {
        this.builtin_.invalidateTransformComposition();
    }

    /** @internal Compose world transforms if a producer invalidated them. */
    ensureTransformsComposed(): void {
        this.builtin_.ensureTransformsComposed();
    }

    /** @internal What the composition staleness counter reads. */
    transformEpoch(): number {
        return this.builtin_.transformEpoch();
    }

    /** @internal Ask composition to record which entities' output changed.
     *  Answers whether this core can report it at all. */
    setTransformChangeTracking(on: boolean): boolean {
        return this.builtin_.setTransformChangeTracking(on);
    }

    /** @internal What every composition since the last acknowledgement changed;
     *  null from a core that cannot say. The ids view engine memory, so a
     *  consumer reads, applies and acknowledges within one turn. */
    compositionChanges(): CompositionDelta | null {
        return this.builtin_.compositionChanges();
    }

    /** @internal Acknowledge that set: it starts again. */
    takeCompositionChanges(): void {
        this.builtin_.takeCompositionChanges();
    }

    /** @internal Mark component as changed without writing data (for in-place Mut query) */
    markChanged(entity: Entity, component: AnyComponentDef): void {
        this.recordComponentWrite_(entity, component);
    }

    /**
     * @internal The open speculation's undo log, or null.
     *
     * The pre-image is taken where the HANDLE leaves, not where the write
     * arrives: script storage hands out the stored object itself, so by `set`
     * the old value is gone (docs/MUTATION_CONTRACT.md). Hence `get`/`tryGet`
     * ask here too, and only a component's first touch is kept.
     */
    private speculation_: { record(world: World, entity: Entity, component: AnyComponentDef): void } | null = null;

    /** @internal */
    openSpeculation(log: { record(world: World, entity: Entity, component: AnyComponentDef): void }): void {
        if (this.speculation_) throw new Error('A speculation is already open on this World — nesting is not supported.');
        this.speculation_ = log;
    }

    /** @internal */
    closeSpeculation(): void {
        this.speculation_ = null;
    }

    /** @internal Whether a step that can be taken back is running. */
    get speculating(): boolean {
        return this.speculation_ !== null;
    }

    /** @internal Whether any query is asking about `component`'s changes. */
    isChangeTracked(component: AnyComponentDef): boolean {
        return this.changes_.isTracked(component);
    }

    /**
     * @internal Where script-component rows are allocated from. A wasm runtime
     * installs linear memory here BEFORE any component is added, because
     * compiled code cannot reach a JS-heap array.
     */
    useScriptPoolMemory(memory: PoolMemory, validateOnly = false): void {
        this.scripts_.usePoolMemory(memory, validateOnly);
    }

    /**
     * @internal `component`'s bytes for `entity`, in the memory compiled code
     * reads: an engine component through the bridge, a script one through its
     * pool. Undefined where there are no flat bytes. The resolver is cached per
     * component — finding it walks a generated table, and this is asked once per
     * entity per frame.
     */
    addressOfComponent(component: AnyComponentDef, entity: Entity): number | undefined {
        return this.addressResolver(component)(entity);
    }

    /**
     * @internal One number for "could any component have moved since you last
     * asked": the engine's pools (`Registry::layoutEpoch`) plus this SDK's own (a
     * claimed, released or grown script row). Null where the engine cannot be
     * asked, which means re-resolve. It says nothing about which entities MATCH;
     * that is the query cache's answer, and a caller needing both asks both.
     */
    layoutEpoch(): number | null {
        const engine = this.builtin_.layoutEpoch();
        if (engine === null && this.builtin_.hasCpp) return null;
        return (engine ?? 0) + this.scripts_.layoutEpoch;
    }

    /**
     * @internal The script pools' half of {@link layoutEpoch}, on its own.
     *
     * A host that reads the engine's half itself needs only this one, and must
     * have it: a row added to or deleted from a script pool moves nothing the
     * registry's version numbers can see.
     */
    scriptLayoutEpoch(): number {
        return this.scripts_.layoutEpoch;
    }

    /**
     * @internal Where a SCRIPT component's whole column is, for a host that
     * walks it in its own address space. Undefined for an engine component,
     * whose column belongs to the registry and is reached by its own door.
     */
    scriptSpanOf(component: AnyComponentDef): {
        rows: number; stride: number; sparse: number; sparseCount: number;
        owners: number; ownerCount: number;
    } | undefined {
        if (isBuiltinComponent(component)) return undefined;
        return this.scripts_.poolFor(component._id as symbol)?.span();
    }

    /** @internal Whether script rows still carry a portable asset reference. */
    hasPortableScriptAssetRefs(component: AnyComponentDef): boolean {
        return this.scripts_.hasPortableAssetRefs(component._id as symbol);
    }

    /** @internal Release script memory after its application stops using it. */
    releaseScriptPools(): void {
        this.addressOf_.clear();
        this.scripts_.releasePools();
    }

    /**
     * @internal The same answer as a function, for a caller with a whole column
     * to walk: the lookup above is per entity, and a loop that pays it per row is
     * paying to be told the same thing every time.
     */
    addressResolver(component: AnyComponentDef): (entity: Entity) => number | undefined {
        let at = this.addressOf_.get(component._id as symbol);
        if (at === undefined) {
            at = isBuiltinComponent(component)
                ? (this.builtin_.resolveComponentAddress(component._cppName) ?? NO_ADDRESS)
                : scriptAddress(this.scripts_, component._id as symbol);
            this.addressOf_.set(component._id as symbol, at);
        }
        return at;
    }

    /** Cleared with the bridge, because a reconnect may serve other memory. */
    private readonly addressOf_ = new Map<symbol, (entity: Entity) => number | undefined>();
}

/** Apply a partial record, preserving other fields and their pending asset loads. */
export function patchComponentFields(world: World, entity: Entity, def: AnyComponentDef, fields: Record<string, unknown>): void {
    if (world.has(entity, def)) world.update(entity, def, draft => Object.assign(draft, fields));
    else world.insert(entity, def, fields);
}

// A world adapter can intercept reads and writes on either the instance or the prototype.
const worldSet = World.prototype.set;
const worldGet = World.prototype.get;

/** A component whose backend serves no flat memory: never has an address. */
const NO_ADDRESS = (): undefined => undefined;

/**
 * A script component's address, with the pool looked up once rather than per
 * entity. Sound because a pool is never dropped once made, and because the pool
 * re-views itself after a growth — the block moving is its business, not this
 * closure's.
 */
function scriptAddress(scripts: ScriptStorage, id: symbol): (entity: Entity) => number | undefined {
    let pool: ScriptPool | undefined;
    return (entity: Entity) => {
        if (pool?.disposed) pool = undefined;
        pool ??= scripts.poolFor(id);
        return pool?.address(entity);
    };
}
