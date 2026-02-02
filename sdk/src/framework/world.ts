/**
 * @file    world.ts
 * @brief   ECS World with dual Registry support (C++ builtin + TS script)
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity } from '../core/Types';
import { Registry } from '../ecs/Registry';
import { ComponentDef } from './component';
import { Schema, InferSchema } from './types';
import { BuiltinComponentDef, isBuiltinComponent, getBuiltinDefaults } from './builtin';
import { createComponentProxy, writeComponentData } from './proxy';

// =============================================================================
// C++ Registry Interface
// =============================================================================

export interface CppRegistry {
    create(): Entity;
    destroy(entity: Entity): void;
    valid(entity: Entity): boolean;

    addLocalTransform(entity: Entity, data: unknown): void;
    getLocalTransform(entity: Entity): unknown;
    hasLocalTransform(entity: Entity): boolean;
    removeLocalTransform(entity: Entity): void;

    addSprite(entity: Entity, data: unknown): void;
    getSprite(entity: Entity): unknown;
    hasSprite(entity: Entity): boolean;
    removeSprite(entity: Entity): void;

    addCamera(entity: Entity, data: unknown): void;
    getCamera(entity: Entity): unknown;
    hasCamera(entity: Entity): boolean;
    removeCamera(entity: Entity): void;

    addCanvas(entity: Entity, data: unknown): void;
    getCanvas(entity: Entity): unknown;
    hasCanvas(entity: Entity): boolean;
    removeCanvas(entity: Entity): void;

    addVelocity(entity: Entity, data: unknown): void;
    getVelocity(entity: Entity): unknown;
    hasVelocity(entity: Entity): boolean;
    removeVelocity(entity: Entity): void;

    // Schema Components (Script-defined, direct memory access)
    registerSchemaPool(name: string, stride: number): number;
    getSchemaPoolId(name: string): number;
    addSchemaComponent(poolId: number, entity: Entity): number;
    hasSchemaComponent(poolId: number, entity: Entity): boolean;
    getSchemaComponentOffset(poolId: number, entity: Entity): number;
    removeSchemaComponent(poolId: number, entity: Entity): void;
    getSchemaPoolBasePtr(poolId: number): number;
    getSchemaPoolStride(poolId: number): number;
    querySchema(poolId: number): Entity[];

    [key: string]: unknown;
}

// =============================================================================
// Any Component Type
// =============================================================================

export type AnyComponentDef = ComponentDef<Schema> | BuiltinComponentDef<unknown>;

// =============================================================================
// World
// =============================================================================

export class World {
    private tsRegistry_: Registry;
    private cppRegistry_: CppRegistry | null = null;
    private heapBuffer_: ArrayBuffer | null = null;
    private componentKeys_ = new Map<symbol, symbol>();
    private entities_ = new Set<Entity>();

    constructor() {
        this.tsRegistry_ = new Registry();
    }

    /** @brief Connect to C++ Registry (called by App) */
    connectCpp(cppRegistry: CppRegistry, heapBuffer: ArrayBuffer): void {
        this.cppRegistry_ = cppRegistry;
        this.heapBuffer_ = heapBuffer;
    }

    /** @brief Check if C++ Registry is connected */
    get hasCpp(): boolean {
        return this.cppRegistry_ !== null;
    }

    /** @brief Update HEAP buffer reference (needed after WASM memory growth) */
    updateHeapBuffer(heapBuffer: ArrayBuffer): void {
        this.heapBuffer_ = heapBuffer;
    }

    // =========================================================================
    // Entity Management
    // =========================================================================

    spawn(): Entity {
        let entity: Entity;

        if (this.cppRegistry_) {
            entity = this.cppRegistry_.create();
        } else {
            entity = this.tsRegistry_.create();
        }

        this.entities_.add(entity);
        return entity;
    }

    despawn(entity: Entity): void {
        if (this.cppRegistry_) {
            this.cppRegistry_.destroy(entity);
        } else {
            this.tsRegistry_.destroy(entity);
        }
        this.entities_.delete(entity);
    }

    valid(entity: Entity): boolean {
        if (this.cppRegistry_) {
            return this.cppRegistry_.valid(entity);
        }
        return this.tsRegistry_.valid(entity);
    }

    entityCount(): number {
        return this.entities_.size;
    }

    getAllEntities(): Entity[] {
        return Array.from(this.entities_);
    }

    // =========================================================================
    // Component Management - Generic
    // =========================================================================

    insert(entity: Entity, component: AnyComponentDef, data?: unknown): unknown {
        if (isBuiltinComponent(component)) {
            return this.insertBuiltin(entity, component, data);
        }
        return this.insertScript(entity, component as ComponentDef<Schema>, data as never);
    }

    remove(entity: Entity, component: AnyComponentDef): void {
        if (isBuiltinComponent(component)) {
            this.removeBuiltin(entity, component);
        } else {
            this.removeScript(entity, component as ComponentDef<Schema>);
        }
    }

    get(entity: Entity, component: AnyComponentDef): unknown {
        if (isBuiltinComponent(component)) {
            return this.getBuiltin(entity, component);
        }
        return this.getScript(entity, component as ComponentDef<Schema>);
    }

    tryGet(entity: Entity, component: AnyComponentDef): unknown | undefined {
        if (!this.has(entity, component)) {
            return undefined;
        }
        return this.get(entity, component);
    }

    has(entity: Entity, component: AnyComponentDef): boolean {
        if (isBuiltinComponent(component)) {
            return this.hasBuiltin(entity, component);
        }
        return this.hasScript(entity, component as ComponentDef<Schema>);
    }

    // =========================================================================
    // Built-in Component Operations (C++ Registry)
    // =========================================================================

    private insertBuiltin(entity: Entity, component: BuiltinComponentDef<unknown>, data?: unknown): unknown {
        const defaults = getBuiltinDefaults(component) as object;
        const merged = { ...defaults, ...(data as object) };

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

    private hasBuiltin(entity: Entity, component: BuiltinComponentDef<unknown>): boolean {
        if (!this.cppRegistry_) {
            return false;
        }

        const checker = `has${component._cppName}` as keyof CppRegistry;
        const fn = this.cppRegistry_[checker] as (e: Entity) => boolean;
        return fn.call(this.cppRegistry_, entity);
    }

    private removeBuiltin(entity: Entity, component: BuiltinComponentDef<unknown>): void {
        if (!this.cppRegistry_) {
            return;
        }

        const remover = `remove${component._cppName}` as keyof CppRegistry;
        const fn = this.cppRegistry_[remover] as (e: Entity) => void;
        fn.call(this.cppRegistry_, entity);
    }

    // =========================================================================
    // Script Component Operations (Schema-based with direct memory access)
    // =========================================================================

    private insertScript<S extends Schema>(
        entity: Entity,
        component: ComponentDef<S>,
        data?: Partial<InferSchema<S>>
    ): InferSchema<S> {
        const initialData = component.create(data);

        if (this.cppRegistry_ && this.heapBuffer_) {
            const poolId = this.ensureCppRegistered(component);
            const byteOffset = this.cppRegistry_.addSchemaComponent(poolId, entity);
            const basePtr = this.cppRegistry_.getSchemaPoolBasePtr(poolId);

            writeComponentData(
                component._layout,
                this.heapBuffer_,
                basePtr + byteOffset,
                initialData
            );

            return createComponentProxy<S>(
                component._layout,
                this.heapBuffer_,
                basePtr + byteOffset
            );
        } else {
            const key = this.getOrCreateKey(component);
            this.tsRegistry_.emplace(entity, key, initialData);
            return initialData;
        }
    }

    private getScript<S extends Schema>(entity: Entity, component: ComponentDef<S>): InferSchema<S> {
        if (this.cppRegistry_ && this.heapBuffer_ && component._cppId !== null) {
            const byteOffset = this.cppRegistry_.getSchemaComponentOffset(component._cppId, entity);
            const basePtr = this.cppRegistry_.getSchemaPoolBasePtr(component._cppId);

            return createComponentProxy<S>(
                component._layout,
                this.heapBuffer_,
                basePtr + byteOffset
            );
        }

        const key = this.componentKeys_.get(component._id);
        if (!key) {
            throw new Error(`Component not registered: ${component._name}`);
        }
        return this.tsRegistry_.get<InferSchema<S>>(entity, key);
    }

    private hasScript<S extends Schema>(entity: Entity, component: ComponentDef<S>): boolean {
        if (this.cppRegistry_ && component._cppId !== null) {
            return this.cppRegistry_.hasSchemaComponent(component._cppId, entity);
        }

        const key = this.componentKeys_.get(component._id);
        if (!key) {
            return false;
        }
        return this.tsRegistry_.has(entity, key);
    }

    private removeScript<S extends Schema>(entity: Entity, component: ComponentDef<S>): void {
        if (this.cppRegistry_ && component._cppId !== null) {
            this.cppRegistry_.removeSchemaComponent(component._cppId, entity);
            return;
        }

        const key = this.componentKeys_.get(component._id);
        if (key) {
            this.tsRegistry_.remove(entity, key);
        }
    }

    private ensureCppRegistered<S extends Schema>(component: ComponentDef<S>): number {
        if (component._cppId === null) {
            const id = this.cppRegistry_!.registerSchemaPool(
                component._name,
                component._layout.stride
            );
            component._cppId = id;
            return id;
        }
        return component._cppId;
    }

    private getOrCreateKey<S extends Schema>(component: ComponentDef<S>): symbol {
        let key = this.componentKeys_.get(component._id);
        if (!key) {
            key = Symbol(component._name);
            this.componentKeys_.set(component._id, key);
        }
        return key;
    }

    // =========================================================================
    // Query Support
    // =========================================================================

    getEntitiesWithComponents(components: AnyComponentDef[]): Entity[] {
        if (components.length === 0) {
            return this.getAllEntities();
        }

        // Optimize: if all components are script components with C++ IDs,
        // use C++ querySchema for the first component and filter
        if (this.cppRegistry_ && components.length > 0) {
            const firstComp = components[0];
            if (!isBuiltinComponent(firstComp)) {
                const scriptComp = firstComp as ComponentDef<Schema>;
                if (scriptComp._cppId !== null) {
                    const baseEntities = this.cppRegistry_.querySchema(scriptComp._cppId);
                    if (components.length === 1) {
                        return baseEntities;
                    }

                    return baseEntities.filter((entity: Entity) => {
                        for (let i = 1; i < components.length; i++) {
                            if (!this.has(entity, components[i])) {
                                return false;
                            }
                        }
                        return true;
                    });
                }
            }
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

    getComponent(entity: Entity, component: AnyComponentDef): unknown {
        return this.get(entity, component);
    }

    // =========================================================================
    // Internal Access
    // =========================================================================

    get tsRegistry(): Registry {
        return this.tsRegistry_;
    }

    get cppRegistry(): CppRegistry | null {
        return this.cppRegistry_;
    }
}
