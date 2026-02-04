/**
 * @file    world.ts
 * @brief   ECS World with C++ Registry integration
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentDef, BuiltinComponentDef, isBuiltinComponent } from './component';
import type { CppRegistry } from './wasm';

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

    // =========================================================================
    // Component Management
    // =========================================================================

    insert(entity: Entity, component: AnyComponentDef, data?: unknown): unknown {
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin(entity, component, data);
        }
        return this.insertScript(entity, component as ComponentDef<any>, data);
    }

    get(entity: Entity, component: AnyComponentDef): unknown {
        if (isBuiltinComponent(component)) {
            return this.getBuiltin(entity, component);
        }
        return this.getScript(entity, component as ComponentDef<any>);
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

    private insertBuiltin(entity: Entity, component: BuiltinComponentDef<any>, data?: unknown): unknown {
        const merged = { ...component._default, ...(data as object) };

        if (this.cppRegistry_) {
            const adder = `add${component._cppName}` as keyof CppRegistry;
            const fn = this.cppRegistry_[adder] as (e: Entity, d: unknown) => void;
            fn.call(this.cppRegistry_, entity, merged);
        }

        return merged;
    }

    private getBuiltin<T>(entity: Entity, component: BuiltinComponentDef<T>): T {
        if (!this.cppRegistry_) {
            throw new Error('C++ Registry not connected');
        }

        const getter = `get${component._cppName}` as keyof CppRegistry;
        const fn = this.cppRegistry_[getter] as (e: Entity) => T;
        return fn.call(this.cppRegistry_, entity);
    }

    private hasBuiltin(entity: Entity, component: BuiltinComponentDef<any>): boolean {
        if (!this.cppRegistry_) {
            return false;
        }

        const checker = `has${component._cppName}` as keyof CppRegistry;
        const fn = this.cppRegistry_[checker] as (e: Entity) => boolean;
        return fn.call(this.cppRegistry_, entity);
    }

    private removeBuiltin(entity: Entity, component: BuiltinComponentDef<any>): void {
        if (!this.cppRegistry_) {
            return;
        }

        const remover = `remove${component._cppName}` as keyof CppRegistry;
        const fn = this.cppRegistry_[remover] as (e: Entity) => void;
        fn.call(this.cppRegistry_, entity);
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

        const entities: Entity[] = [];

        for (const entity of this.entities_) {
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
