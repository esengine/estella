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
    return typeof value === 'object' && value !== null && (value as any)._type === 'mut';
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
    data: unknown;
}

export class QueryInstance<C extends readonly QueryArg[]> implements Iterable<QueryResult<C>> {
    private readonly world_: World;
    private readonly descriptor_: QueryDescriptor<C>;
    private pendingMutations_: PendingMutation[] = [];

    constructor(world: World, descriptor: QueryDescriptor<C>) {
        this.world_ = world;
        this.descriptor_ = descriptor;
    }

    private getActualComponent(arg: QueryArg): AnyComponentDef {
        return isMutWrapper(arg) ? arg._component : arg;
    }

    private commitPending(): void {
        for (const mutation of this.pendingMutations_) {
            this.world_.insert(mutation.entity, mutation.component, mutation.data);
        }
        this.pendingMutations_ = [];
    }

    *[Symbol.iterator](): Iterator<QueryResult<C>> {
        const { _components, _mutIndices, _with, _without } = this.descriptor_;

        const actualComponents = _components.map(c => this.getActualComponent(c));
        const allRequired = [...actualComponents, ..._with];
        const entities = this.world_.getEntitiesWithComponents(allRequired);

        let prevEntity: Entity | null = null;
        let prevMutData: Array<{ component: AnyComponentDef; data: unknown }> = [];

        try {
            for (const entity of entities) {
                // Commit previous entity's mutations before moving to next
                if (prevEntity !== null) {
                    for (const mut of prevMutData) {
                        this.world_.insert(prevEntity, mut.component, mut.data);
                    }
                }
                prevMutData = [];

                let excluded = false;
                for (const comp of _without) {
                    if (this.world_.has(entity, comp)) {
                        excluded = true;
                        break;
                    }
                }
                if (excluded) continue;

                const components = actualComponents.map(comp =>
                    this.world_.get(entity, comp)
                ) as ComponentsData<C>;

                // Track mutable components for write-back
                for (const idx of _mutIndices) {
                    prevMutData.push({
                        component: actualComponents[idx],
                        data: components[idx]
                    });
                }
                prevEntity = entity;

                yield [entity, ...components] as QueryResult<C>;
            }
        } finally {
            // Commit last entity's mutations
            if (prevEntity !== null) {
                for (const mut of prevMutData) {
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
        return [...this];
    }
}
