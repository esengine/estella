/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent, getAllRegisteredComponents, getComponentRegistry } from './component';
import type { CppRegistry, ESEngineModule } from './wasm';
import { validateComponentData, formatValidationErrors } from './validation';
import { handleWasmError } from './wasmError';

function convertFromWasm(
    obj: Record<string, unknown>,
    colorKeys: readonly string[],
): Record<string, unknown> {
    if (colorKeys.length === 0) return obj;
    const result: Record<string, unknown> = { ...obj };
    for (const key of colorKeys) {
        const val = result[key] as Record<string, unknown> | null | undefined;
        if (val && typeof val === 'object') {
            result[key] = { r: val.x, g: val.y, b: val.z, a: val.w };
        }
    }
    return result;
}

function convertForWasm(
    obj: Record<string, unknown>,
    colorKeys: readonly string[],
): Record<string, unknown> {
    if (colorKeys.length === 0) return obj;
    const result: Record<string, unknown> = { ...obj };
    for (const key of colorKeys) {
        const val = result[key] as Record<string, unknown> | null | undefined;
        if (val && typeof val === 'object') {
            result[key] = { x: val.r, y: val.g, z: val.b, w: val.a };
        }
    }
    return result;
}

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

interface BuiltinMethods {
    add: (e: Entity, d: unknown) => void;
    get: (e: Entity) => unknown;
    has: (e: Entity) => boolean;
    remove: (e: Entity) => void;
}

export class World {
    private cppRegistry_: CppRegistry | null = null;
    private module_: ESEngineModule | null = null;
    private entities_ = new Map<Entity, number>();
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();
    private entityComponents_ = new Map<Entity, symbol[]>();
    private queryPool_: Entity[][] = [];
    private queryPoolIdx_ = 0;
    private worldVersion_ = 0;
    private queryCache_ = new Map<string, { version: number; result: Entity[] }>();
    private builtinMethodCache_ = new Map<string, BuiltinMethods>();
    private iterationDepth_ = 0;
    private nextEntityId_ = 0;
    private nextGeneration_ = 0;
    private spawnCallbacks_: Array<(entity: Entity) => void> = [];
    private despawnCallbacks_: Array<(entity: Entity) => void> = [];

    private worldTick_ = 0;
    private componentAddedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentChangedTicks_ = new Map<symbol, Map<Entity, number>>();
    private componentRemovedBuffer_ = new Map<symbol, Array<{ entity: Entity; tick: number }>>();
    private trackedComponents_ = new Set<symbol>();

    connectCpp(cppRegistry: CppRegistry, module?: ESEngineModule): void {
        this.cppRegistry_ = cppRegistry;
        this.module_ = module ?? null;
        this.builtinMethodCache_.clear();
    }

    disconnectCpp(): void {
        this.cppRegistry_ = null;
        this.module_ = null;
        this.builtinMethodCache_.clear();
    }

    get hasCpp(): boolean {
        return this.cppRegistry_ !== null;
    }

    getCppRegistry(): CppRegistry | null {
        return this.cppRegistry_;
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    spawn(): Entity {
        if (this.isIterating()) {
            throw new Error(
                'Cannot spawn entity during query iteration. ' +
                'Use Commands to defer entity creation until after iteration completes.'
            );
        }

        let entity: Entity;

        if (this.cppRegistry_) {
            try {
                entity = this.cppRegistry_.create();
            } catch (e) {
                handleWasmError(e, 'spawn');
                throw e;
            }
        } else {
            entity = (++this.nextEntityId_) as Entity;
        }

        let generation = 0;
        if (this.module_ && this.cppRegistry_) {
            try {
                generation = this.module_.registry_getGeneration(this.cppRegistry_, entity);
            } catch { /* fallback to 0 */ }
        } else {
            generation = ++this.nextGeneration_;
        }
        this.entities_.set(entity, generation);
        this.worldVersion_++;

        for (const cb of this.spawnCallbacks_) {
            try { cb(entity); } catch {}
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
            try { cb(entity); } catch {}
        }

        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.destroy(entity);
            } catch (e) {
                handleWasmError(e, `despawn(entity=${entity})`);
            }
        }
        this.entities_.delete(entity);
        this.worldVersion_++;

        const ids = this.entityComponents_.get(entity);
        if (ids) {
            for (const id of ids) {
                this.tsStorage_.get(id)?.delete(entity);
                this.componentAddedTicks_.get(id)?.delete(entity);
                this.componentChangedTicks_.get(id)?.delete(entity);
                let buffer = this.componentRemovedBuffer_.get(id);
                if (!buffer) {
                    buffer = [];
                    this.componentRemovedBuffer_.set(id, buffer);
                }
                buffer.push({ entity, tick: this.worldTick_ });
            }
            this.entityComponents_.delete(entity);
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
        if (this.cppRegistry_) {
            return this.cppRegistry_.valid(entity);
        }
        return this.entities_.has(entity);
    }

    entityCount(): number {
        return this.entities_.size;
    }

    getWorldVersion(): number {
        return this.worldVersion_;
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
        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.setParent(child, parent);
            } catch (e) {
                handleWasmError(e, `setParent(child=${child}, parent=${parent})`);
            }
        }
    }

    removeParent(entity: Entity): void {
        if (this.cppRegistry_) {
            try {
                this.cppRegistry_.removeParent(entity);
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
            return this.insertBuiltin(entity, component, data) as ComponentData<C>;
        }
        return this.insertScript(entity, component as ComponentDef<any>, data) as ComponentData<C>;
    }

    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void {
        if (isBuiltinComponent(component)) {
            if (this.cppRegistry_) {
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
                    this.getBuiltinMethods(component._cppName).add(
                        entity,
                        convertForWasm(wasmData, component._colorKeys)
                    );
                } catch (e) {
                    handleWasmError(e, `set(${component._name}, entity=${entity})`);
                }
            }
            this.recordChangedTick_(component, entity);
            return;
        }
        this.getStorage(component as ComponentDef<any>).set(entity, data);
        this.recordChangedTick_(component, entity);
    }

    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> {
        if (isBuiltinComponent(component)) {
            return this.getBuiltin(entity, component) as ComponentData<C>;
        }
        return this.getScript(entity, component as ComponentDef<any>) as ComponentData<C>;
    }

    has(entity: Entity, component: AnyComponentDef): boolean {
        if (isBuiltinComponent(component)) {
            return this.hasBuiltin(entity, component);
        }
        return this.hasScript(entity, component as ComponentDef<any>);
    }

    tryGet<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C> | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;
            try {
                const methods = this.getBuiltinMethods(component._cppName);
                if (!methods.has(entity)) return null;
                return convertFromWasm(
                    methods.get(entity) as Record<string, unknown>,
                    component._colorKeys,
                ) as ComponentData<C>;
            } catch (e) {
                handleWasmError(e, `tryGet(${component._name}, entity=${entity})`);
                return null;
            }
        }
        const storage = this.tsStorage_.get(component._id as symbol);
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
            this.removeBuiltin(entity, component);
        } else {
            this.removeScript(entity, component as ComponentDef<any>);
        }
    }

    // =========================================================================
    // Builtin Component Operations (C++ Registry)
    // =========================================================================

    private getBuiltinMethods(cppName: string): BuiltinMethods {
        let methods = this.builtinMethodCache_.get(cppName);
        if (methods) return methods;

        const reg = this.cppRegistry_!;
        const addFn = reg[`add${cppName}`];
        const getFn = reg[`get${cppName}`];
        const hasFn = reg[`has${cppName}`];
        const removeFn = reg[`remove${cppName}`];

        if (typeof addFn !== 'function' || typeof getFn !== 'function' ||
            typeof hasFn !== 'function' || typeof removeFn !== 'function') {
            throw new Error(
                `C++ Registry missing methods for component "${cppName}". ` +
                `Expected: add${cppName}, get${cppName}, has${cppName}, remove${cppName}`
            );
        }

        methods = {
            add: addFn.bind(reg),
            get: getFn.bind(reg),
            has: hasFn.bind(reg),
            remove: removeFn.bind(reg),
        };
        this.builtinMethodCache_.set(cppName, methods);
        return methods;
    }

    private insertBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): T {
        const defaults = component._default as Record<string, unknown>;
        const filtered: Record<string, unknown> = {};
        if (data !== null && data !== undefined && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v === undefined) continue;
                if (!(k in defaults)) continue;
                filtered[k] = v;
            }

            const errors = validateComponentData(
                component._name,
                defaults,
                filtered
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
        }
        const merged = { ...component._default, ...filtered } as T;

        let isNew = true;
        if (this.cppRegistry_) {
            try {
                const methods = this.getBuiltinMethods(component._cppName);
                isNew = !methods.has(entity);
                methods.add(entity, convertForWasm(merged as Record<string, unknown>, component._colorKeys));
            } catch (e) {
                handleWasmError(e, `insertBuiltin(${component._name}, entity=${entity})`);
            }
        }

        if (isNew) {
            this.worldVersion_++;
            this.recordAddedTick_(component, entity);
        }
        this.recordChangedTick_(component, entity);
        return merged;
    }

    private getBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }
        try {
            const raw = this.getBuiltinMethods(component._cppName).get(entity);
            return convertFromWasm(
                raw as Record<string, unknown>,
                component._colorKeys,
            ) as T;
        } catch (e) {
            handleWasmError(e, `getBuiltin(${component._name}, entity=${entity})`);
            return { ...component._default } as T;
        }
    }

    private hasBuiltin(entity: Entity, component: BuiltinComponentDef<any>): boolean {
        if (!this.cppRegistry_) {
            return false;
        }
        try {
            return this.getBuiltinMethods(component._cppName).has(entity);
        } catch (e) {
            handleWasmError(e, `hasBuiltin(${component._name}, entity=${entity})`);
            return false;
        }
    }

    private removeBuiltin(entity: Entity, component: BuiltinComponentDef<any>): void {
        if (!this.cppRegistry_) {
            return;
        }
        try {
            this.getBuiltinMethods(component._cppName).remove(entity);
        } catch (e) {
            handleWasmError(e, `removeBuiltin(${component._name}, entity=${entity})`);
        }
        this.recordRemovedTick_(component, entity);
        this.worldVersion_++;
    }

    // =========================================================================
    // Script Component Operations (TypeScript storage)
    // =========================================================================

    private insertScript<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): T {
        let filtered: Partial<T> | undefined;
        if (data !== null && data !== undefined && typeof data === 'object') {
            const clean: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined) {
                    clean[k] = v;
                }
            }
            const errors = validateComponentData(
                component._name,
                component._default as Record<string, unknown>,
                clean
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
            filtered = clean as Partial<T>;
        }

        const value = component.create(filtered);
        const storage = this.getStorage(component);
        const isNew = !storage.has(entity);
        storage.set(entity, value);
        let ids = this.entityComponents_.get(entity);
        if (!ids) {
            ids = [];
            this.entityComponents_.set(entity, ids);
        }
        if (ids.indexOf(component._id) === -1) {
            ids.push(component._id);
        }
        if (isNew) {
            this.worldVersion_++;
            this.recordAddedTick_(component, entity);
        }
        this.recordChangedTick_(component, entity);
        return value;
    }

    private getScript<T>(entity: Entity, component: ComponentDef<T>): T {
        const storage = this.tsStorage_.get(component._id);
        if (!storage) {
            throw new Error(`Component not found: ${component._name}`);
        }
        return storage.get(entity) as T;
    }

    private hasScript<T>(entity: Entity, component: ComponentDef<T>): boolean {
        const storage = this.tsStorage_.get(component._id);
        return storage?.has(entity) ?? false;
    }

    private removeScript<T>(entity: Entity, component: ComponentDef<T>): void {
        const storage = this.tsStorage_.get(component._id);
        storage?.delete(entity);
        this.recordRemovedTick_(component, entity);
        this.worldVersion_++;
        const ids = this.entityComponents_.get(entity);
        if (ids) {
            const idx = ids.indexOf(component._id);
            if (idx !== -1) {
                ids.splice(idx, 1);
            }
        }
    }

    private getStorage(component: ComponentDef<any>): Map<Entity, unknown> {
        let storage = this.tsStorage_.get(component._id);
        if (!storage) {
            storage = new Map();
            this.tsStorage_.set(component._id, storage);
        }
        return storage;
    }

    /** @internal Pre-resolve a component to its direct storage/getter for fast iteration. */
    resolveGetter(component: AnyComponentDef): ((entity: Entity) => unknown) | null {
        if (isBuiltinComponent(component)) {
            if (!this.cppRegistry_) return null;

            if (this.module_) {
                const ptrGetter = this.resolvePtrGetter_(component._cppName);
                if (ptrGetter) return ptrGetter;
            }

            const methods = this.getBuiltinMethods(component._cppName);
            const colorKeys = component._colorKeys;
            if (colorKeys.length === 0) {
                return (e) => methods.get(e);
            }
            return (e) => convertFromWasm(methods.get(e) as Record<string, unknown>, colorKeys);
        }
        const storage = this.tsStorage_.get(component._id);
        if (!storage) return null;
        return (e) => storage.get(e);
    }

    private resolvePtrGetter_(cppName: string): ((entity: Entity) => unknown) | null {
        const mod = this.module_!;
        const reg = this.cppRegistry_!;

        if (cppName === 'Transform') {
            return (e: Entity) => {
                const ptr = mod.getTransformPtr(reg, e);
                if (!ptr) return null;
                const f = mod.HEAPF32;
                const b = ptr >> 2;
                return {
                    position:      { x: f[b],    y: f[b+1],  z: f[b+2] },
                    rotation:      { x: f[b+3],  y: f[b+4],  z: f[b+5],  w: f[b+6] },
                    scale:         { x: f[b+7],  y: f[b+8],  z: f[b+9] },
                    worldPosition: { x: f[b+10], y: f[b+11], z: f[b+12] },
                    worldRotation: { x: f[b+13], y: f[b+14], z: f[b+15], w: f[b+16] },
                    worldScale:    { x: f[b+17], y: f[b+18], z: f[b+19] },
                };
            };
        }

        if (cppName === 'Sprite') {
            return (e: Entity) => {
                const ptr = mod.getSpritePtr(reg, e);
                if (!ptr) return null;
                const f = mod.HEAPF32;
                const u8 = mod.HEAPU8;
                const i32 = new Int32Array(mod.HEAPF32.buffer);
                const u32 = mod.HEAPU32;
                const fb = ptr >> 2;
                return {
                    texture:  u32[fb],
                    color:    { r: f[fb+1], g: f[fb+2], b: f[fb+3], a: f[fb+4] },
                    size:     { x: f[fb+5], y: f[fb+6] },
                    uvOffset: { x: f[fb+7], y: f[fb+8] },
                    uvScale:  { x: f[fb+9], y: f[fb+10] },
                    layer:    i32[fb+11],
                    flipX:    u8[ptr + 48] !== 0,
                    flipY:    u8[ptr + 49] !== 0,
                    material: u32[fb+13],
                    enabled:  u8[ptr + 56] !== 0,
                };
            };
        }

        return null;
    }

    // =========================================================================
    // Query Support
    // =========================================================================

    resetQueryPool(): void {
        this.queryPoolIdx_ = 0;
    }

    getComponentTypes(entity: Entity): string[] {
        const types = new Set<string>();
        for (const [name, methods] of this.builtinMethodCache_) {
            try { if (methods.has(entity)) types.add(name); } catch {}
        }
        if (this.cppRegistry_) {
            for (const [name, comp] of getAllRegisteredComponents()) {
                if (isBuiltinComponent(comp) && !types.has(name)) {
                    try {
                        const m = this.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.add(name);
                    } catch {}
                }
            }
        }
        const ids = this.entityComponents_.get(entity);
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
                if (!this.cppRegistry_) return false;
                builtinOut.push(this.getBuiltinMethods(comp._cppName));
            } else {
                const storage = this.tsStorage_.get(comp._id);
                if (!storage) return false;
                scriptOut.push(storage);
            }
        }
        return true;
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
        const cached = this.queryCache_.get(cacheKey);
        if (cached && cached.version === this.worldVersion_) {
            return cached.result;
        }

        if (this.queryPoolIdx_ >= this.queryPool_.length) {
            this.queryPool_.push([]);
        }
        const entities = this.queryPool_[this.queryPoolIdx_++];
        entities.length = 0;

        const reqScript: Map<Entity, unknown>[] = [];
        const reqBuiltin: BuiltinMethods[] = [];
        if (!this.resolveStorages_(components, reqScript, reqBuiltin)) {
            this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: [] });
            return entities;
        }

        let withScript: Map<Entity, unknown>[] | null = null;
        let withBuiltin: BuiltinMethods[] | null = null;
        if (withFilters.length > 0) {
            withScript = [];
            withBuiltin = [];
            if (!this.resolveStorages_(withFilters, withScript, withBuiltin)) {
                this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: [] });
                return entities;
            }
        }

        let woScript: Map<Entity, unknown>[] | null = null;
        let woBuiltin: BuiltinMethods[] | null = null;
        if (withoutFilters.length > 0) {
            woScript = [];
            woBuiltin = [];
            this.resolveStorages_(withoutFilters, woScript, woBuiltin);
        }

        let smallestPool: Map<Entity, unknown> | null = null;
        let smallestSize = Infinity;
        for (let i = 0; i < reqScript.length; i++) {
            const size = reqScript[i].size;
            if (size < smallestSize) {
                smallestSize = size;
                smallestPool = reqScript[i];
            }
        }

        const candidates = smallestPool ? smallestPool.keys() : this.entities_.keys();
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

        this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: entities.slice() });

        return entities;
    }

    // =========================================================================
    // Change Detection
    // =========================================================================

    advanceTick(): void {
        this.worldTick_++;
    }

    getWorldTick(): number {
        return this.worldTick_;
    }

    enableChangeTracking(component: AnyComponentDef): void {
        this.trackedComponents_.add(component._id);
    }

    isAddedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentAddedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    isChangedSince(entity: Entity, component: AnyComponentDef, sinceTick: number): boolean {
        const map = this.componentChangedTicks_.get(component._id);
        if (!map) return false;
        const tick = map.get(entity);
        return tick !== undefined && tick > sinceTick;
    }

    getRemovedEntitiesSince(component: AnyComponentDef, sinceTick: number): Entity[] {
        const buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) return [];
        const result: Entity[] = [];
        for (const entry of buffer) {
            if (entry.tick > sinceTick) {
                result.push(entry.entity);
            }
        }
        return result;
    }

    cleanRemovedBuffer(beforeTick: number): void {
        for (const [id, buffer] of this.componentRemovedBuffer_) {
            let writeIdx = 0;
            for (let i = 0; i < buffer.length; i++) {
                if (buffer[i].tick >= beforeTick) {
                    buffer[writeIdx++] = buffer[i];
                }
            }
            buffer.length = writeIdx;
            if (writeIdx === 0) {
                this.componentRemovedBuffer_.delete(id);
            }
        }
    }

    private recordAddedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentAddedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentAddedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    private recordChangedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let map = this.componentChangedTicks_.get(component._id);
        if (!map) {
            map = new Map();
            this.componentChangedTicks_.set(component._id, map);
        }
        map.set(entity, this.worldTick_);
    }

    private recordRemovedTick_(component: AnyComponentDef, entity: Entity): void {
        if (!this.trackedComponents_.has(component._id)) return;
        let buffer = this.componentRemovedBuffer_.get(component._id);
        if (!buffer) {
            buffer = [];
            this.componentRemovedBuffer_.set(component._id, buffer);
        }
        buffer.push({ entity, tick: this.worldTick_ });
        this.componentAddedTicks_.get(component._id)?.delete(entity);
        this.componentChangedTicks_.get(component._id)?.delete(entity);
    }
}
