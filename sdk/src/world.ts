/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent, getAllRegisteredComponents, getComponentRegistry, Name } from './component';
import type { CppRegistry, ESEngineModule } from './wasm';
import { handleWasmError } from './wasmError';
import { BuiltinBridge, convertFromWasm, convertForWasm, type BuiltinMethods } from './ecs/BuiltinBridge';
import { ScriptStorage } from './ecs/ScriptStorage';
import { NameIndex } from './ecs/NameIndex';
import { ChangeTracker } from './ecs/ChangeTracker';
import { QueryCache } from './ecs/QueryCache';

export { PTR_LAYOUTS } from './ptrLayouts.generated';
export { BuiltinBridge, convertFromWasm, convertForWasm } from './ecs/BuiltinBridge';
export type { BuiltinMethods } from './ecs/BuiltinBridge';

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
    return key;
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
    private iterationDepth_ = 0;
    private nextEntityId_ = 0;
    private nextGeneration_ = 0;
    private spawnCallbacks_: Array<(entity: Entity) => void> = [];
    private despawnCallbacks_: Array<(entity: Entity) => void> = [];

    get builtin(): BuiltinBridge {
        return this.builtin_;
    }

    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): void {
        this.builtin_.connect(cppRegistry, module);
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
            entity = (++this.nextEntityId_) as Entity;
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
        this.queries_.markStructuralChange();

        if (name !== undefined) {
            this.insert(entity, Name, { value: name });
        }

        for (const cb of this.spawnCallbacks_) {
            try { cb(entity); } catch (e) { console.warn('[World] Spawn callback error:', e); }
        }

        return entity;
    }

    despawn(entity: Entity): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot despawn entity during query iteration. ' +
                'Use Commands to defer entity destruction until after iteration completes.'
            );
        }

        for (const cb of this.despawnCallbacks_) {
            try { cb(entity); } catch (e) { console.warn('[World] Despawn callback error:', e); }
        }

        this.names_.remove(entity);

        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry) {
            try {
                cppRegistry.destroy(entity);
            } catch (e) {
                handleWasmError(e, `despawn(entity=${entity})`);
            }
        }
        this.entities_.delete(entity);
        this.queries_.markStructuralChange();

        this.builtin_.deleteFromEntitySets(entity);

        const removedIds = this.scripts_.removeEntity(entity);
        for (const id of removedIds) {
            this.changes_.recordRemovedById(id, entity);
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

    entityCount(): number {
        return this.entities_.size;
    }

    getWorldVersion(): number {
        return this.queries_.structuralVersion;
    }

    beginIteration(): void {
        this.iterationDepth_++;
    }

    endIteration(): void {
        this.iterationDepth_--;
        if (this.iterationDepth_ < 0) {
            console.warn('World.endIteration: mismatched begin/end calls');
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

    setParent(child: Entity, parent: Entity): void {
        const cppRegistry = this.builtin_.getCppRegistry();
        if (cppRegistry) {
            try {
                cppRegistry.setParent(child, parent);
            } catch (e) {
                handleWasmError(e, `setParent(child=${child}, parent=${parent})`);
            }
        }
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
            return;
        }
        this.scripts_.set(entity, component as ComponentDef<any>, data);
        this.changes_.recordChanged(component, entity);
        if ((component as ComponentDef<any>)._id === Name._id) {
            this.names_.update(entity, (data as { value: string }).value);
        }
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
        }
        this.changes_.recordChanged(component, entity);
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
        }
        this.changes_.recordChanged(component, entity);
        if (component._id === Name._id) {
            this.names_.update(entity, (value as { value: string }).value);
        }
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
            try { if (methods.has(entity)) types.add(name); } catch (e) { console.warn(`[World] Component check failed for ${name}:`, e); }
        }
        if (this.builtin_.hasCpp) {
            for (const [name, comp] of getAllRegisteredComponents()) {
                if (isBuiltinComponent(comp) && !types.has(name)) {
                    try {
                        const m = this.builtin_.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.add(name);
                    } catch (e) { console.warn(`[World] Builtin check failed for ${name}:`, e); }
                }
            }
        }
        const ids = this.scripts_.getEntityComponentIds(entity);
        if (ids) {
            const registry = getComponentRegistry();
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
        precomputedKey?: string
    ): Entity[] {
        if (components.length === 0 && withFilters.length === 0 && withoutFilters.length === 0) {
            return this.getAllEntities();
        }

        const cacheKey = precomputedKey ?? computeQueryCacheKey(components, withFilters, withoutFilters);
        const depIds = this.collectComponentIds_(components, withFilters, withoutFilters);

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
