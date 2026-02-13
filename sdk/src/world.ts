/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, ComponentData, BuiltinComponentDef, isBuiltinComponent } from './component';
import type { CppRegistry } from './wasm';

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

export class World {
    private cppRegistry_: CppRegistry | null = null;
    private entities_ = new Set<Entity>();
    private tsStorage_ = new Map<symbol, Map<Entity, unknown>>();

    connectCpp(cppRegistry: CppRegistry): void {
        this.cppRegistry_ = cppRegistry;
    }

    disconnectCpp(): void {
        this.cppRegistry_ = null;
    }

    get hasCpp(): boolean {
        return this.cppRegistry_ !== null;
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    spawn(): Entity {
        let entity: Entity;

        if (this.cppRegistry_) {
            entity = this.cppRegistry_.create();
        } else {
            entity = (this.entities_.size + 1) as Entity;
        }

        this.entities_.add(entity);
        return entity;
    }

    despawn(entity: Entity): void {
        if (this.cppRegistry_) {
            this.cppRegistry_.destroy(entity);
        }
        this.entities_.delete(entity);

        for (const storage of this.tsStorage_.values()) {
            storage.delete(entity);
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

    getAllEntities(): Entity[] {
        return Array.from(this.entities_);
    }

    setParent(child: Entity, parent: Entity): void {
        if (this.cppRegistry_) {
            this.cppRegistry_.setParent(child, parent);
        }
    }

    removeParent(entity: Entity): void {
        if (this.cppRegistry_) {
            this.cppRegistry_.removeParent(entity);
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

    remove(entity: Entity, component: AnyComponentDef): void {
        if (isBuiltinComponent(component)) {
            this.removeBuiltin(entity, component);
        } else {
            this.removeScript(entity, component as ComponentDef<any>);
        }
    }

    // =========================================================================
    // Builtin Component Operations (C++ Registry)
    // =========================================================================

    private insertBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>, data?: Partial<T>): T {
        const filtered: Record<string, unknown> = {};
        if (data !== null && data !== undefined && typeof data === 'object') {
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                if (v !== undefined) {
                    filtered[k] = v;
                }
            }
        }
        const merged = { ...component._default, ...filtered } as T;

        if (this.cppRegistry_) {
            const adder = `add${component._cppName}`;
            const fn = this.cppRegistry_[adder] as ((e: Entity, d: unknown) => void) | undefined;
            fn?.call(this.cppRegistry_, entity, convertForWasm(merged as Record<string, unknown>));
        }

        return merged;
    }

    private getBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }

        const getter = `get${component._cppName}`;
        const fn = this.cppRegistry_[getter] as ((e: Entity) => T) | undefined;
        return fn!.call(this.cppRegistry_, entity);
    }

    private hasBuiltin(entity: Entity, component: BuiltinComponentDef<any>): boolean {
        if (!this.cppRegistry_) {
            return false;
        }

        const checker = `has${component._cppName}`;
        const fn = this.cppRegistry_[checker] as ((e: Entity) => boolean) | undefined;
        return fn!.call(this.cppRegistry_, entity);
    }

    private removeBuiltin(entity: Entity, component: BuiltinComponentDef<any>): void {
        if (!this.cppRegistry_) {
            return;
        }

        const remover = `remove${component._cppName}`;
        const fn = this.cppRegistry_[remover] as ((e: Entity) => void) | undefined;
        fn!.call(this.cppRegistry_, entity);
    }

    // =========================================================================
    // Script Component Operations (TypeScript storage)
    // =========================================================================

    private insertScript<T>(entity: Entity, component: ComponentDef<T>, data?: unknown): T {
        const value = component.create(data as Partial<T>);
        this.getStorage(component).set(entity, value);
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

    getEntitiesWithComponents(components: AnyComponentDef[]): Entity[] {
        if (components.length === 0) {
            return this.getAllEntities();
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

        const entities: Entity[] = [];
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

        return entities;
    }
}
