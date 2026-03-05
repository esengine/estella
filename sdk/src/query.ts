/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentData, isBuiltinComponent } from './component';
import type { World } from './world';
import { computeQueryCacheKey } from './world';

// =============================================================================
// Mutable Component Wrapper
// =============================================================================

export interface MutWrapper<T extends AnyComponentDef> {
    readonly _type: 'mut';
    readonly _component: T;
}

export function Mut<T extends AnyComponentDef>(component: T): MutWrapper<T> {
    return { _type: 'mut', _component: component };
}

export function isMutWrapper(value: unknown): value is MutWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_type' in value && value._type === 'mut';
}

type UnwrapMut<T> = T extends MutWrapper<infer C> ? C : T;

// =============================================================================
// Change Detection Wrappers
// =============================================================================

export interface AddedWrapper<T extends AnyComponentDef> {
    readonly _filterType: 'added';
    readonly _component: T;
}

export interface ChangedWrapper<T extends AnyComponentDef> {
    readonly _filterType: 'changed';
    readonly _component: T;
}

export function Added<T extends AnyComponentDef>(component: T): AddedWrapper<T> {
    return { _filterType: 'added', _component: component };
}

export function Changed<T extends AnyComponentDef>(component: T): ChangedWrapper<T> {
    return { _filterType: 'changed', _component: component };
}

export function isAddedWrapper(value: unknown): value is AddedWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_filterType' in value && value._filterType === 'added';
}

export function isChangedWrapper(value: unknown): value is ChangedWrapper<AnyComponentDef> {
    return typeof value === 'object' && value !== null && '_filterType' in value && value._filterType === 'changed';
}

type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef> | AddedWrapper<AnyComponentDef> | ChangedWrapper<AnyComponentDef>;

// =============================================================================
// Query Descriptor
// =============================================================================

export interface QueryDescriptor<C extends readonly QueryArg[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _mutIndices: number[];
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
    readonly _addedFilters: Array<{ index: number; component: AnyComponentDef }>;
    readonly _changedFilters: Array<{ index: number; component: AnyComponentDef }>;
}

export interface QueryBuilder<C extends readonly QueryArg[]> extends QueryDescriptor<C> {
    with(...components: AnyComponentDef[]): QueryBuilder<C>;
    without(...components: AnyComponentDef[]): QueryBuilder<C>;
}

function unwrapComponent(comp: QueryArg): AnyComponentDef {
    if (isMutWrapper(comp)) return comp._component;
    if (isAddedWrapper(comp)) return comp._component;
    if (isChangedWrapper(comp)) return comp._component;
    return comp;
}

function createQueryDescriptor<C extends readonly QueryArg[]>(
    components: C,
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = []
): QueryBuilder<C> {
    const mutIndices: number[] = [];
    const addedFilters: Array<{ index: number; component: AnyComponentDef }> = [];
    const changedFilters: Array<{ index: number; component: AnyComponentDef }> = [];

    components.forEach((comp, i) => {
        if (isMutWrapper(comp)) {
            mutIndices.push(i);
        }
        if (isAddedWrapper(comp)) {
            addedFilters.push({ index: i, component: comp._component });
        } else if (isChangedWrapper(comp)) {
            changedFilters.push({ index: i, component: comp._component });
        }
    });

    return {
        _type: 'query',
        _components: components,
        _mutIndices: mutIndices,
        _with: withFilters,
        _without: withoutFilters,
        _addedFilters: addedFilters,
        _changedFilters: changedFilters,
        with(...extraWith: AnyComponentDef[]) {
            return createQueryDescriptor(components, [...withFilters, ...extraWith], withoutFilters);
        },
        without(...extraWithout: AnyComponentDef[]) {
            return createQueryDescriptor(components, withFilters, [...withoutFilters, ...extraWithout]);
        },
    };
}


// =============================================================================
// Query Factory
// =============================================================================

export function Query<C extends QueryArg[]>(...components: C): QueryBuilder<C> {
    return createQueryDescriptor(components);
}

// =============================================================================
// Query Result Type
// =============================================================================

type UnwrapQueryArg<T> =
    T extends MutWrapper<infer C> ? C :
    T extends AddedWrapper<infer C> ? C :
    T extends ChangedWrapper<infer C> ? C :
    T;
type ComponentsData<C extends readonly QueryArg[]> = {
    [K in keyof C]: ComponentData<UnwrapQueryArg<C[K]>>;
};

export type QueryResult<C extends readonly QueryArg[]> = [
    Entity,
    ...ComponentsData<C>
];

// =============================================================================
// Query Instance (Runtime)
// =============================================================================

interface PendingMutation {
    entity: Entity;
    component: AnyComponentDef;
    data: Record<string, unknown>;
}

export class QueryInstance<C extends readonly QueryArg[]> implements Iterable<QueryResult<C>> {
    private readonly world_: World;
    private readonly descriptor_: QueryDescriptor<C>;
    private readonly actualComponents_: AnyComponentDef[];
    private readonly allRequired_: AnyComponentDef[];
    private readonly result_: unknown[];
    private readonly mutData_: Array<{ component: AnyComponentDef; data: Record<string, unknown> }>;
    private readonly cacheKey_: string;
    private readonly lastRunTick_: number;

    constructor(world: World, descriptor: QueryDescriptor<C>, lastRunTick = -1) {
        this.world_ = world;
        this.descriptor_ = descriptor;
        this.lastRunTick_ = lastRunTick;
        this.actualComponents_ = descriptor._components.map(unwrapComponent);
        this.allRequired_ = this.actualComponents_.concat(descriptor._with);
        this.result_ = new Array(this.actualComponents_.length + 1);
        this.mutData_ = descriptor._mutIndices.map(idx => ({
            component: this.actualComponents_[idx],
            data: null as unknown as Record<string, unknown>
        }));
        this.cacheKey_ = computeQueryCacheKey(
            this.allRequired_,
            descriptor._with,
            descriptor._without,
        );
        for (const f of descriptor._addedFilters) {
            world.enableChangeTracking(f.component);
        }
        for (const f of descriptor._changedFilters) {
            world.enableChangeTracking(f.component);
        }
    }

    private passesChangeFilters_(entity: Entity): boolean {
        const { _addedFilters, _changedFilters } = this.descriptor_;
        if (_addedFilters.length === 0 && _changedFilters.length === 0) return true;
        const tick = this.lastRunTick_;
        for (const f of _addedFilters) {
            if (!this.world_.isAddedSince(entity, f.component, tick)) return false;
        }
        for (const f of _changedFilters) {
            if (!this.world_.isChangedSince(entity, f.component, tick)) return false;
        }
        return true;
    }

    [Symbol.iterator](): Iterator<QueryResult<C>> {
        const { _mutIndices } = this.descriptor_;
        const actualComponents = this.actualComponents_;
        const entities = this.world_.getEntitiesWithComponents(
            this.allRequired_,
            this.descriptor_._with,
            this.descriptor_._without,
            this.cacheKey_
        );
        const compCount = actualComponents.length;
        const hasMut = _mutIndices.length > 0;
        const hasChangeFilters = this.descriptor_._addedFilters.length > 0 || this.descriptor_._changedFilters.length > 0;
        const result = this.result_;
        const mutData = this.mutData_;
        const mutCount = mutData.length;
        const world = this.world_;
        const self = this;

        let idx = 0;
        let prevEntity: Entity | null = null;
        let started = false;
        let done = false;

        const finalize = () => {
            if (done) return;
            done = true;
            world.endIteration();
            if (prevEntity !== null && hasMut) {
                for (let i = 0; i < mutCount; i++) {
                    const mut = mutData[i];
                    world.set(prevEntity, mut.component, mut.data);
                }
            }
        };

        return {
            next(): IteratorResult<QueryResult<C>> {
                if (!started) {
                    started = true;
                    world.beginIteration();
                }

                while (idx < entities.length) {
                    const entity = entities[idx++];

                    if (hasChangeFilters && !self.passesChangeFilters_(entity)) {
                        continue;
                    }

                    if (prevEntity !== null && hasMut) {
                        for (let i = 0; i < mutCount; i++) {
                            const mut = mutData[i];
                            world.set(prevEntity, mut.component, mut.data);
                        }
                    }

                    result[0] = entity;
                    for (let i = 0; i < compCount; i++) {
                        result[i + 1] = world.get(entity, actualComponents[i]);
                    }

                    if (hasMut) {
                        for (let i = 0; i < mutCount; i++) {
                            mutData[i].data = result[_mutIndices[i] + 1] as Record<string, unknown>;
                        }
                        prevEntity = entity;
                    }

                    return { value: result as QueryResult<C>, done: false };
                }

                finalize();
                return { value: undefined as unknown as QueryResult<C>, done: true };
            },
            return(): IteratorResult<QueryResult<C>> {
                finalize();
                return { value: undefined as unknown as QueryResult<C>, done: true };
            },
        };
    }

    forEach(callback: (entity: Entity, ...components: ComponentsData<C>) => void): void {
        for (const [entity, ...components] of this) {
            callback(entity, ...(components as ComponentsData<C>));
        }
    }

    single(): QueryResult<C> | null {
        for (const result of this) {
            return result;
        }
        return null;
    }

    isEmpty(): boolean {
        return this.single() === null;
    }

    count(): number {
        return this.world_.getEntitiesWithComponents(
            this.allRequired_, this.descriptor_._with, this.descriptor_._without
        ).length;
    }

    toArray(): QueryResult<C>[] {
        const arr: QueryResult<C>[] = [];
        for (const row of this) {
            arr.push([...row] as QueryResult<C>);
        }
        return arr;
    }
}

// =============================================================================
// Removed Query
// =============================================================================

export interface RemovedQueryDescriptor<T extends AnyComponentDef> {
    readonly _type: 'removed';
    readonly _component: T;
}

export function Removed<T extends AnyComponentDef>(component: T): RemovedQueryDescriptor<T> {
    return { _type: 'removed', _component: component };
}

export class RemovedQueryInstance<T extends AnyComponentDef> implements Iterable<Entity> {
    private readonly world_: World;
    private readonly component_: T;
    private readonly lastRunTick_: number;

    constructor(world: World, component: T, lastRunTick: number) {
        this.world_ = world;
        this.component_ = component;
        this.lastRunTick_ = lastRunTick;
        world.enableChangeTracking(component);
    }

    *[Symbol.iterator](): Iterator<Entity> {
        yield* this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_);
    }

    isEmpty(): boolean {
        return this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_).length === 0;
    }

    toArray(): Entity[] {
        return this.world_.getRemovedEntitiesSince(this.component_, this.lastRunTick_);
    }
}
