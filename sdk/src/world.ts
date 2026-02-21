/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent, getAllRegisteredComponents, getComponentRegistry } from './component';
import type { CppRegistry } from './wasm';
import { validateComponentData, formatValidationErrors } from './validation';
import { handleWasmError } from './wasmError';

function convertForWasm(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
            const rec = val as Record<string, unknown>;
            if ('r' in rec && 'g' in rec && 'b' in rec && 'a' in rec && !('x' in rec)) {
                result[key] = { x: rec.r, y: rec.g, z: rec.b, w: rec.a };
            } else {
                result[key] = convertForWasm(rec);
            }
        } else {
            result[key] = val;
        }
    }
    return result;
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
    private entities_ = new Set<Entity>();
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();
    private entityComponents_ = new Map<Entity, symbol[]>();
    private queryPool_: Entity[][] = [];
    private queryPoolIdx_ = 0;
    private worldVersion_ = 0;
    private queryCache_ = new Map<string, { version: number; result: Entity[] }>();
    private builtinMethodCache_ = new Map<string, BuiltinMethods>();
    private iterationDepth_ = 0;
    private nextEntityId_ = 0;

    connectCpp(cppRegistry: CppRegistry): void {
        this.cppRegistry_ = cppRegistry;
        this.builtinMethodCache_.clear();
    }

    disconnectCpp(): void {
        this.cppRegistry_ = null;
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

        this.entities_.add(entity);
        return entity;
    }

    despawn(entity: Entity): void {
        if (this.isIterating()) {
            throw new Error(
                'Cannot despawn entity during query iteration. ' +
                'Use Commands to defer entity destruction until after iteration completes.'
            );
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
            }
            this.entityComponents_.delete(entity);
        }
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
        return Array.from(this.entities_);
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
                return methods.get(entity) as ComponentData<C>;
            } catch (e) {
                handleWasmError(e, `tryGet(${component._name}, entity=${entity})`);
                return null;
            }
        }
        if (!this.hasScript(entity, component as ComponentDef<any>)) return null;
        return this.getScript(entity, component as ComponentDef<any>) as ComponentData<C>;
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
        const filtered: Record<string, unknown> = {};
        if (data !== null && data !== undefined && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined) {
                    filtered[k] = v;
                }
            }

            const errors = validateComponentData(
                component._name,
                component._default as Record<string, unknown>,
                filtered
            );
            if (errors.length > 0) {
                throw new Error(formatValidationErrors(component._name, errors));
            }
        }
        const merged = { ...component._default, ...filtered } as T;

        if (this.cppRegistry_) {
            try {
                this.getBuiltinMethods(component._cppName).add(entity, convertForWasm(merged as Record<string, unknown>));
            } catch (e) {
                handleWasmError(e, `insertBuiltin(${component._name}, entity=${entity})`);
            }
        }

        return merged;
    }

    private getBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }
        try {
            return this.getBuiltinMethods(component._cppName).get(entity) as T;
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
        this.getStorage(component).set(entity, value);
        this.worldVersion_++;
        let ids = this.entityComponents_.get(entity);
        if (!ids) {
            ids = [];
            this.entityComponents_.set(entity, ids);
        }
        if (ids.indexOf(component._id) === -1) {
            ids.push(component._id);
        }
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

    // =========================================================================
    // Query Support
    // =========================================================================

    resetQueryPool(): void {
        this.queryPoolIdx_ = 0;
        this.queryCache_.clear();
    }

    getComponentTypes(entity: Entity): string[] {
        const types: string[] = [];
        for (const [name, methods] of this.builtinMethodCache_) {
            try { if (methods.has(entity)) types.push(name); } catch {}
        }
        if (this.cppRegistry_) {
            for (const [name, comp] of getAllRegisteredComponents()) {
                if (isBuiltinComponent(comp) && !types.includes(name)) {
                    try {
                        const m = this.getBuiltinMethods(comp._cppName);
                        if (m.has(entity)) types.push(name);
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
                        types.push(name);
                        break;
                    }
                }
            }
        }
        return types;
    }

    getEntitiesWithComponents(
        components: AnyComponentDef[],
        withFilters: AnyComponentDef[] = [],
        withoutFilters: AnyComponentDef[] = []
    ): Entity[] {
        if (components.length === 0 && withFilters.length === 0 && withoutFilters.length === 0) {
            return this.getAllEntities();
        }

        let cacheKey = components.map(c => c._name).sort().join(',');
        if (withFilters.length > 0) {
            cacheKey += '|+' + withFilters.map(c => c._name).sort().join(',');
        }
        if (withoutFilters.length > 0) {
            cacheKey += '|-' + withoutFilters.map(c => c._name).sort().join(',');
        }
        const cached = this.queryCache_.get(cacheKey);
        if (cached && cached.version === this.worldVersion_) {
            return cached.result;
        }

        let smallestPool: Map<Entity, unknown> | null = null;
        let smallestSize = Infinity;

        for (const comp of components) {
            if (!isBuiltinComponent(comp)) {
                const storage = this.tsStorage_.get(comp._id);
                const size = storage ? storage.size : 0;
                if (size < smallestSize) {
                    smallestSize = size;
                    smallestPool = storage ?? null;
                }
            }
        }

        if (this.queryPoolIdx_ >= this.queryPool_.length) {
            this.queryPool_.push([]);
        }
        const entities = this.queryPool_[this.queryPoolIdx_++];
        entities.length = 0;

        const candidates = smallestPool ? smallestPool.keys() : this.entities_;

        for (const entity of candidates) {
            let hasAll = true;
            for (const comp of components) {
                if (!this.has(entity, comp)) {
                    hasAll = false;
                    break;
                }
            }
            if (hasAll) {
                entities.push(entity);
            }
        }

        this.queryCache_.set(cacheKey, { version: this.worldVersion_, result: entities });

        return entities;
    }
}
