/**
 * @file    query.ts
 * @brief   Component query system with mutable component support
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentData, isBuiltinComponent } from './component';
import type { World } from './world';

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
type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef>;

// =============================================================================
// Query Descriptor
// =============================================================================

export interface QueryDescriptor<C extends readonly QueryArg[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _mutIndices: number[];
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
}

function createQueryDescriptor<C extends readonly QueryArg[]>(
    components: C,
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = []
): QueryDescriptor<C> {
    const mutIndices: number[] = [];
    components.forEach((comp, i) => {
        if (isMutWrapper(comp)) {
            mutIndices.push(i);
        }
    });

    return {
        _type: 'query',
        _components: components,
        _mutIndices: mutIndices,
        _with: withFilters,
        _without: withoutFilters
    };
}

// =============================================================================
// Query Factory
// =============================================================================

export function Query<C extends QueryArg[]>(...components: C): QueryDescriptor<C> {
    return createQueryDescriptor(components);
}

// =============================================================================
// Query Result Type
// =============================================================================

type UnwrapQueryArg<T> = T extends MutWrapper<infer C> ? C : T;
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
    data: any;
}

export class QueryInstance<C extends readonly QueryArg[]> implements Iterable<QueryResult<C>> {
    private readonly world_: World;
    private readonly descriptor_: QueryDescriptor<C>;
    private readonly actualComponents_: AnyComponentDef[];
    private readonly allRequired_: AnyComponentDef[];
    private readonly result_: any[];
    private readonly mutData_: Array<{ component: AnyComponentDef; data: any }>;

    constructor(world: World, descriptor: QueryDescriptor<C>) {
        this.world_ = world;
        this.descriptor_ = descriptor;
        this.actualComponents_ = descriptor._components.map(c =>
            isMutWrapper(c) ? c._component : c
        );
        this.allRequired_ = this.actualComponents_.concat(descriptor._with);
        this.result_ = new Array(this.actualComponents_.length + 1);
        this.mutData_ = descriptor._mutIndices.map(idx => ({
            component: this.actualComponents_[idx],
            data: null as any
        }));
    }

    *[Symbol.iterator](): Iterator<QueryResult<C>> {
        const { _mutIndices, _without } = this.descriptor_;
        const actualComponents = this.actualComponents_;
        const entities = this.world_.getEntitiesWithComponents(this.allRequired_);
        const compCount = actualComponents.length;
        const hasMut = _mutIndices.length > 0;
        const hasWithout = _without.length > 0;
        const result = this.result_;
        const mutData = this.mutData_;
        const mutCount = mutData.length;

        let prevEntity: Entity | null = null;

        this.world_.beginIteration();
        try {
            for (const entity of entities) {
                if (prevEntity !== null && hasMut) {
                    for (let i = 0; i < mutCount; i++) {
                        const mut = mutData[i];
                        this.world_.insert(prevEntity, mut.component, mut.data);
                    }
                }

                if (hasWithout) {
                    let excluded = false;
                    for (let i = 0; i < _without.length; i++) {
                        if (this.world_.has(entity, _without[i])) {
                            excluded = true;
                            break;
                        }
                    }
                    if (excluded) continue;
                }

                result[0] = entity;
                for (let i = 0; i < compCount; i++) {
                    result[i + 1] = this.world_.get(entity, actualComponents[i]);
                }

                if (hasMut) {
                    for (let i = 0; i < mutCount; i++) {
                        mutData[i].data = result[_mutIndices[i] + 1];
                    }
                    prevEntity = entity;
                }

                yield result.slice() as QueryResult<C>;
            }
        } finally {
            this.world_.endIteration();
            if (prevEntity !== null && hasMut) {
                for (let i = 0; i < mutCount; i++) {
                    const mut = mutData[i];
                    this.world_.insert(prevEntity, mut.component, mut.data);
                }
            }
        }
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
        let n = 0;
        for (const _ of this) {
            n++;
        }
        return n;
    }

    toArray(): QueryResult<C>[] {
        const arr: QueryResult<C>[] = [];
        for (const row of this) {
            arr.push([...row] as QueryResult<C>);
        }
        return arr;
    }
}
