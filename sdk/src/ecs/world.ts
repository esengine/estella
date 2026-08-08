// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity, entityGeneration, entityIndex, makeEntity, INVALID_ENTITY } from '../types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent, getComponentRegistry, getUserComponents, getComponent, Name, Parent, Children } from './component';
import type { CppRegistry, ESEngineModule } from '../wasm';
import { handleWasmError } from '../wasm/wasmError';
import { BuiltinBridge, convertFromWasm, convertForWasm, type BridgeConnectOptions, type BuiltinMethods } from './bridge/BuiltinBridge';
import { ScriptStorage } from './ScriptStorage';
import { NameIndex } from './NameIndex';
import { ChangeTracker } from './ChangeTracker';
import { QueryCache, type QueryCacheStats } from './QueryCache';
import { rankByOrder, reorderMapByRank } from './entityOrder';
import { nativeEngineApi } from './bridge/engineApi';
import { withScratch } from '../wasm/wasmScratch';
import { log } from '../util/logger';
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

function notifyBridge<K extends keyof EditorBridge>(
    method: K,
    ...args: Parameters<NonNullable<EditorBridge[K]>>
): void {
    const bridge = editorBridge();
    if (!bridge) return;
    const fn = bridge[method] as ((...a: unknown[]) => void) | undefined;
    if (typeof fn !== 'function') return;
    try {
        fn.apply(bridge, args as unknown[]);
    } catch (e) {
        log.warn('world', `EditorBridge.${String(method)} threw`, e);
    }
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
 * into a `match` closure plus a list of components the tree reads so the
 * query cache can invalidate on structural changes to any of them.
 */
export interface QueryFilter {
    readonly match: (entity: Entity) => boolean;
    readonly deps: readonly AnyComponentDef[];
}

// =============================================================================
// World
// =============================================================================

export class World {
    private readonly builtin_ = new BuiltinBridge();
    private readonly scripts_ = new ScriptStorage();
    private readonly names_ = new NameIndex();
    readonly changes_ = new ChangeTracker();
    readonly queries_ = new QueryCache();
    private entities_ = new Map<Entity, number>();
    private indexGeneration_ = new Map<number, number>();  // index -> current generation (for isStale detection)
    private iterationDepth_ = 0;
    private nextEntityIndex_ = 0;  // pure-JS fallback: monotonic index counter
    private nextGeneration_ = 0;
    private spawnCallbacks_: Array<(entity: Entity) => void> = [];
    private despawnCallbacks_: Array<(entity: Entity) => void> = [];

    get builtin(): BuiltinBridge {
        return this.builtin_;
    }

    connectCpp(
        cppRegistry: CppRegistry,
        module?: ESEngineModule,
        options?: BridgeConnectOptions,
    ): void {
        this.builtin_.connect(cppRegistry, module, options);
    }

    disconnectCpp(): void {
        this.builtin_.disconnect();
    }

    get hasCpp(): boolean {
        return this.builtin_.hasCpp;
    }

    getCppRegistry(): CppRegistry | null {
        return this.builtin_.getCppRegistry();
    }

    /** @internal */
    getWasmModule(): ESEngineModule | null {
        return this.builtin_.getWasmModule();
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    spawn(name?: string): Entity {
        if (this.isIterating()) {
            throw new Error(
                'Cannot spawn entity during query iteration. ' +
                'Use Commands to defer entity creation until after iteration completes.'
            );
        }

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
            // Pure-JS fallback: pack into the same {generation(12) | index(20)}
            // layout as C++ so Entity helpers (entityIndex/entityGeneration)
            // give consistent results whether or not WASM is connected.
            const idx = ++this.nextEntityIndex_;
            const gen = (this.indexGeneration_.get(idx) ?? 0);
            entity = makeEntity(idx, gen);
        }

        let generation = 0;
        const module = this.builtin_.getWasmModule();
        if (module && cppRegistry) {
            try {
                generation = module.registry_getGeneration(cppRegistry, entity);
            } catch { /* fallback to 0 */ }
        } else {
            generation = ++this.nextGeneration_;
        }
        this.entities_.set(entity, generation);
        this.indexGeneration_.set(entityIndex(entity), entityGeneration(entity));
        this.queries_.markStructuralChange();

        if (name !== undefined) {
            this.insert(entity, Name, { value: name });
        }

        for (const cb of this.spawnCallbacks_) {
            try { cb(entity); } catch (e) { log.warn('world', 'Spawn callback error', e); }
        }

        notifyBridge('onEntitySpawned', entity, name);

        return entity;
    }

    despawn(entity: Entity): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot despawn entity during query iteration. ' +
                'Use Commands to defer entity destruction until after iteration completes.'
            );
        }
        if (!this.valid(entity)) return; // already gone (e.g. despawned as part of a subtree)

        // Unlink from the parent (setParent-to-INVALID clears both sides), then
        // tear down the whole subtree so no children are left orphaned + rendering.
        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry && cppRegistry.hasParent(entity)) {
            try { cppRegistry.setParent(entity, INVALID_ENTITY); }
            catch (e) { handleWasmError(e, `despawn(detach ${entity})`); }
        }
        this.despawnSubtree_(entity, cppRegistry);
    }

    /** Depth-first teardown of `entity` and its descendants (children before parent). */
    private despawnSubtree_(entity: Entity, cppRegistry: CppRegistry | null): void {
        if (cppRegistry && cppRegistry.hasChildren(entity)) {
            const children: Entity[] = [];
            try {
                // Snapshot then free the wasm VectorEntity (it leaks if left alive).
                const vec = cppRegistry.getChildren(entity).entities;
                for (let i = 0; i < vec.size(); i++) children.push(vec.get(i) as Entity);
                vec.delete();
            } catch (e) { handleWasmError(e, `despawn(children of ${entity})`); }
            for (const child of children) {
                if (this.valid(child)) this.despawnSubtree_(child, cppRegistry);
            }
        }

        notifyBridge('onEntityDespawned', entity);

        for (const cb of this.despawnCallbacks_) {
            try { cb(entity); } catch (e) { log.warn('world', 'Despawn callback error', e); }
        }

        this.names_.remove(entity);

        if (cppRegistry) {
            try {
                cppRegistry.destroy(entity);
            } catch (e) {
                handleWasmError(e, `despawn(entity=${entity})`);
            }
        }
        this.entities_.delete(entity);
        this.queries_.markStructuralChange();

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

    onSpawn(callback: (entity: Entity) => void): () => void {
        this.spawnCallbacks_.push(callback);
        return () => {
            const idx = this.spawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.spawnCallbacks_.splice(idx, 1);
        };
    }

    onDespawn(callback: (entity: Entity) => void): () => void {
        this.despawnCallbacks_.push(callback);
        return () => {
            const idx = this.despawnCallbacks_.indexOf(callback);
            if (idx !== -1) this.despawnCallbacks_.splice(idx, 1);
        };
    }

    valid(entity: Entity): boolean {
        return this.entities_.has(entity);
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
            names: this.names_.sizes(),
            scripts: this.scripts_.sizes(),
            changes: this.changes_.sizes(),
            queryCacheEntries: this.queries_.getStats().size,
        };
    }

    getWorldVersion(): number {
        return this.queries_.structuralVersion;
    }

    /** Cumulative query-cache counters (hits, misses, invalidation causes). */
    getQueryCacheStats(): QueryCacheStats {
        return this.queries_.getStats();
    }

    /** Reset the query-cache counters. Entries themselves are kept. */
    resetQueryCacheStats(): void {
        this.queries_.resetStats();
    }

    beginIteration(): void {
        this.iterationDepth_++;
    }

    endIteration(): void {
        this.iterationDepth_--;
        if (this.iterationDepth_ < 0) {
            log.warn('world', 'World.endIteration: mismatched begin/end calls');
            this.iterationDepth_ = 0;
        }
    }

    resetIterationDepth(): void {
        this.iterationDepth_ = 0;
    }

    isIterating(): boolean {
        return this.iterationDepth_ > 0;
    }

    getAllEntities(): Entity[] {
        return Array.from(this.entities_.keys());
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

        reorderMapByRank(this.entities_, rankOf);
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
        const core = (this.builtin_.getWasmModule() ?? nativeEngineApi()) as EntityOrderCore | null;
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
        } catch (e) {
            handleWasmError(e, `applyEntityOrder(count=${entities.length})`);
        }
    }

    setParent(child: Entity, parent: Entity): void {
        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry) {
            try {
                cppRegistry.setParent(child, parent);
            } catch (e) {
                handleWasmError(e, `setParent(child=${child}, parent=${parent})`);
            }
        }
        this.queries_.markStructuralChange();
        this.queries_.markComponentDirty(Parent._id);
        this.queries_.markComponentDirty(Children._id);
        notifyBridge('onParentChanged', child, parent);
    }

    removeParent(entity: Entity): void {
        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry) {
            try {
                cppRegistry.removeParent(entity);
            } catch (e) {
                handleWasmError(e, `removeParent(entity=${entity})`);
            }
        }
        this.queries_.markStructuralChange();
        this.queries_.markComponentDirty(Parent._id);
        this.queries_.markComponentDirty(Children._id);
        notifyBridge('onParentChanged', entity, null);
    }

    // =========================================================================
    // Component Management
    // =========================================================================

    insert<C extends AnyComponentDef>(entity: Entity, component: C, data?: Partial<ComponentData<C>>): ComponentData<C> {
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin_(entity, component, data) as ComponentData<C>;
        }
        return this.insertScript_(entity, component as ComponentDef<any>, data) as ComponentData<C>;
    }

    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void {
        if (isBuiltinComponent(component)) {
            // `set` is insert-or-replace: adding a builtin the entity LACKS must run
            // the full structural bookkeeping (entity set + query dirty + recordAdded),
            // or the C++ side holds it while queries / has() (entity-set fast path)
            // never see it. Route the new case through insert.
            if (this.builtin_.hasCpp && !this.has(entity, component)) {
                this.insert(entity, component, data as Partial<ComponentData<C>>);
                return;
            }
            if (this.builtin_.hasCpp) {
                try {
                    const defaults = component._default as Record<string, unknown>;
                    const raw = data as Record<string, unknown>;
                    let wasmData = raw;
                    for (const k of Object.keys(raw)) {
                        if (!(k in defaults)) {
                            if (wasmData === raw) wasmData = { ...raw };
                            delete wasmData[k];
                        }
                    }
                    this.builtin_.getBuiltinMethods(component._cppName).add(
                        entity,
                        convertForWasm(wasmData, component.colorKeys)
                    );
                } catch (e) {
                    handleWasmError(e, `set(${component._name}, entity=${entity})`);
                }
            }
            this.changes_.recordChanged(component, entity);
            notifyBridge('onComponentChanged', entity, component._name);
            return;
        }
        this.scripts_.set(entity, component as ComponentDef<any>, data);
        this.changes_.recordChanged(component, entity);
        if ((component as ComponentDef<any>)._id === Name._id) {
            this.names_.update(entity, (data as { value: string }).value);
        }
        notifyBridge('onComponentChanged', entity, component._name);
    }

    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> {
        if (isBuiltinComponent(component)) {
            return this.builtin_.get(entity, component) as ComponentData<C>;
        }
        return this.scripts_.get(entity, component as ComponentDef<any>) as ComponentData<C>;
    }

    has(entity: Entity, component: AnyComponentDef): boolean {
        if (component._builtin) {
            if (!this.builtin_.hasCpp) return false;
            const cppName = (component as BuiltinComponentDef<any>)._cppName;
            const bset = this.builtin_.getEntitySet(cppName);
            if (bset) return bset.has(entity);
            return this.builtin_.getBuiltinMethods(cppName).has(entity);
        }
        return this.scripts_.has(entity, component as ComponentDef<any>);
    }

    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null {
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;
            const bset = this.builtin_.getEntitySet(component._cppName);
            if (bset && !bset.has(entity)) return null;
            try {
                const methods = this.builtin_.getBuiltinMethods(component._cppName);
                if (!bset && !methods.has(entity)) return null;
                return convertFromWasm(
                    methods.get(entity) as Record<string, unknown>,
                    component.colorKeys,
                ) as ComponentData<C>;
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

    remove(entity: Entity, component: AnyComponentDef): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot remove component during query iteration. ' +
                'Use Commands to defer component removal until after iteration completes.'
            );
        }

        if (isBuiltinComponent(component)) {
            this.builtin_.remove(entity, component);
            this.changes_.recordRemoved(component, entity);
            this.queries_.markComponentDirty(component._id);
            this.queries_.markStructuralChange();
            notifyBridge('onComponentRemoved', entity, component._name);
        } else {
            this.removeScript_(entity, component as ComponentDef<any>);
        }
    }

    // =========================================================================
    // Builtin Component Insert (delegates to BuiltinBridge)
    // =========================================================================

    private insertBuiltin_<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): T {
        const { merged, isNew } = this.builtin_.insert(entity, component, data);
        if (isNew) {
            this.queries_.markComponentDirty(component._id);
            this.queries_.markStructuralChange();
            this.changes_.recordAdded(component, entity);
            notifyBridge('onComponentAdded', entity, component._name);
        }
        this.changes_.recordChanged(component, entity);
        notifyBridge('onComponentChanged', entity, component._name);
        return merged;
    }

    // =========================================================================
    // Script Component Operations (delegates to ScriptStorage)
    // =========================================================================

    private insertScript_<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): T {
        const { value, isNew } = this.scripts_.insert(entity, component, data);
        if (isNew) {
            this.queries_.markComponentDirty(component._id);
            this.queries_.markStructuralChange();
            this.changes_.recordAdded(component, entity);
            notifyBridge('onComponentAdded', entity, component._name);
        }
        this.changes_.recordChanged(component, entity);
        if (component._id === Name._id) {
            this.names_.update(entity, (value as { value: string }).value);
        }
        notifyBridge('onComponentChanged', entity, component._name);
        return value;
    }

    private removeScript_<T>(entity: Entity, component: ComponentDef<T>): void {
        if (component._id === Name._id) {
            this.names_.remove(entity);
        }
        this.scripts_.remove(entity, component);
        this.changes_.recordRemoved(component, entity);
        this.queries_.markComponentDirty(component._id);
        this.queries_.markStructuralChange();
        notifyBridge('onComponentRemoved', entity, component._name);
    }

    // =========================================================================
    // Name Index
    // =========================================================================

    findEntityByName(name: string): Entity | null {
        return this.names_.findByName(name);
    }

    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef): ((entity: Entity) => unknown) | null {
        if (isBuiltinComponent(component)) {
            if (!this.builtin_.hasCpp) return null;

            if (this.builtin_.getWasmModule()) {
                const ptrGetter = this.builtin_.resolvePtrGetter(component._cppName);
                if (ptrGetter) return ptrGetter;
            }

            const methods = this.builtin_.getBuiltinMethods(component._cppName);
            const colorKeys = component.colorKeys;
            if (colorKeys.length === 0) {
                return (e) => methods.get(e);
            }
            return (e) => convertFromWasm(methods.get(e) as Record<string, unknown>, colorKeys);
        }
        const storage = this.scripts_.getStorageById(component._id);
        if (!storage) return null;
        return (e) => storage.get(e);
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

            if (this.builtin_.getWasmModule()) {
                const ptrSetter = this.builtin_.resolvePtrSetter(component._cppName);
                if (ptrSetter) return ptrSetter;
            }

            const methods = this.builtin_.getBuiltinMethods(component._cppName);
            const colorKeys = component.colorKeys;
            if (colorKeys.length === 0) {
                return (e, d) => methods.add(e, d);
            }
            return (e, d) => methods.add(e, convertForWasm(d as Record<string, unknown>, colorKeys));
        }
        const storage = this.scripts_.getStorageById(component._id);
        if (!storage) return null;
        return (e, d) => storage.set(e, d);
    }

    // =========================================================================
    // Query Support
    // =========================================================================

    resetQueryPool(): void {
        // No-op: query pool removed, results stored directly in cache
    }

    getComponentTypes(entity: Entity): string[] {
        const types = new Set<string>();
        for (const [name, methods] of this.builtin_.getMethodCache()) {
            try { if (methods.has(entity)) types.add(name); } catch (e) { log.warn('world', `Component check failed for ${name}`, e); }
        }
        if (this.builtin_.hasCpp) {
            for (const [name, comp] of getComponentRegistry()) {
                if (isBuiltinComponent(comp) && !types.has(name)) {
                    try {
                        const m = this.builtin_.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.add(name);
                    } catch (e) { log.warn('world', `Builtin check failed for ${name}`, e); }
                }
            }
        }
        const ids = this.scripts_.getEntityComponentIds(entity);
        if (ids) {
            const registry = getUserComponents();
            for (const id of ids) {
                for (const [name, def] of registry) {
                    if (def._id === id) {
                        types.add(name);
                        break;
                    }
                }
            }
        }
        return Array.from(types);
    }

    private resolveStorages_(
        comps: AnyComponentDef[],
        scriptOut: Map<Entity, unknown>[],
        builtinOut: BuiltinMethods[],
    ): boolean {
        for (const comp of comps) {
            if (isBuiltinComponent(comp)) {
                if (!this.builtin_.hasCpp) return false;
                builtinOut.push(this.builtin_.getBuiltinMethods(comp._cppName));
            } else {
                const storage = this.scripts_.getStorageById(comp._id);
                if (!storage) return false;
                scriptOut.push(storage);
            }
        }
        return true;
    }

    private collectComponentIds_(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[],
        withoutFilters: AnyComponentDef[],
    ): symbol[] {
        const ids: symbol[] = [];
        for (const c of components) ids.push(c._id);
        for (const c of withFilters) ids.push(c._id);
        for (const c of withoutFilters) ids.push(c._id);
        return ids;
    }

    getEntitiesWithComponents(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[] = [],
        withoutFilters: AnyComponentDef[] = [],
        precomputedKey?: string,
        filter?: QueryFilter,
        precomputedDepIds?: symbol[],
    ): readonly Entity[] {
        if (
            components.length === 0 && withFilters.length === 0 &&
            withoutFilters.length === 0 && !filter
        ) {
            return this.getAllEntities();
        }

        const cacheKey = precomputedKey ?? computeQueryCacheKey(components, withFilters, withoutFilters);
        // The dep-id set is static per query; QueryInstance precomputes it (incl.
        // filter deps) so cache-hit iteration allocates nothing here.
        let depIds: symbol[];
        if (precomputedDepIds) {
            depIds = precomputedDepIds;
        } else {
            depIds = this.collectComponentIds_(components, withFilters, withoutFilters);
            if (filter) {
                for (const c of filter.deps) depIds.push(c._id);
            }
        }

        return this.queries_.getOrCompute(cacheKey, depIds, () => {
            const entities: Entity[] = [];

            const reqScript: Map<Entity, unknown>[] = [];
            const reqBuiltin: BuiltinMethods[] = [];
            if (!this.resolveStorages_(components, reqScript, reqBuiltin)) {
                return [];
            }

            let withScript: Map<Entity, unknown>[] | null = null;
            let withBuiltin: BuiltinMethods[] | null = null;
            if (withFilters.length > 0) {
                withScript = [];
                withBuiltin = [];
                if (!this.resolveStorages_(withFilters, withScript, withBuiltin)) {
                    return [];
                }
            }

            let woScript: Map<Entity, unknown>[] | null = null;
            let woBuiltin: BuiltinMethods[] | null = null;
            if (withoutFilters.length > 0) {
                woScript = [];
                woBuiltin = [];
                this.resolveStorages_(withoutFilters, woScript, woBuiltin);
            }

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
                if (isBuiltinComponent(comp)) {
                    const bset = this.builtin_.getEntitySet(comp._cppName);
                    if (bset && bset.size < smallestSize) {
                        smallestSize = bset.size;
                        smallestSet = bset;
                    }
                }
            }

            const candidates = smallestSet ? smallestSet.keys() : this.entities_.keys();
            const rsLen = reqScript.length;
            const rbLen = reqBuiltin.length;

            for (const entity of candidates) {
                let match = true;
                for (let i = 0; i < rsLen; i++) {
                    if (!reqScript[i].has(entity)) { match = false; break; }
                }
                if (match) {
                    for (let i = 0; i < rbLen; i++) {
                        if (!reqBuiltin[i].has(entity)) { match = false; break; }
                    }
                }
                if (match && withScript) {
                    for (let i = 0; i < withScript.length; i++) {
                        if (!withScript[i].has(entity)) { match = false; break; }
                    }
                    if (match) {
                        for (let i = 0; i < withBuiltin!.length; i++) {
                            if (!withBuiltin![i].has(entity)) { match = false; break; }
                        }
                    }
                }
                if (match && woScript) {
                    for (let i = 0; i < woScript.length; i++) {
                        if (woScript[i].has(entity)) { match = false; break; }
                    }
                    if (match) {
                        for (let i = 0; i < woBuiltin!.length; i++) {
                            if (woBuiltin![i].has(entity)) { match = false; break; }
                        }
                    }
                }
                if (match && filter && !filter.match(entity)) {
                    match = false;
                }
                if (match) {
                    entities.push(entity);
                }
            }

            return entities;
        });
    }

    // =========================================================================
    // Change Detection (delegates to ChangeTracker)
    // =========================================================================

    advanceTick(): void {
        this.changes_.advanceTick();
    }

    getWorldTick(): number {
        return this.changes_.getWorldTick();
    }

    enableChangeTracking(component: AnyComponentDef): void {
        this.changes_.enableChangeTracking(component);
    }

    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.isAddedSince(entity, component, sinceTick);
    }

    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.isChangedSince(entity, component, sinceTick);
    }

    /** True if ANY entity changed `component` after `sinceTick` (O(1) gate). */
    anyChangedSince(component: AnyComponentDef, sinceTick: number): boolean {
        return this.changes_.anyChangedSince(component, sinceTick);
    }

    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        return this.changes_.getRemovedEntitiesSince(component, sinceTick);
    }

    cleanRemovedBuffer(beforeTick: number): void {
        this.changes_.cleanRemovedBuffer(beforeTick);
    }

    /** @internal Mark component as changed without writing data (for in-place Mut query) */
    markChanged(entity: Entity, component: AnyComponentDef): void {
        this.changes_.recordChanged(component, entity);
    }
}
