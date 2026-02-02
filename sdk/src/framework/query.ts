/**
 * @file    query.ts
 * @brief   Query system supporting both builtin and script components
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { Entity } from '../core/Types';
import { ComponentDef } from './component';
import { Schema, InferSchema } from './types';
import { World, AnyComponentDef } from './world';
import { BuiltinComponentDef } from './builtin';

// =============================================================================
// Component Data Type Inference
// =============================================================================

type ComponentData<C> =
    C extends BuiltinComponentDef<infer T> ? T :
    C extends ComponentDef<infer S> ? InferSchema<S> :
    never;

type ComponentsData<C extends readonly AnyComponentDef[]> = {
    [K in keyof C]: ComponentData<C[K]>;
};

// =============================================================================
// Query Descriptor
// =============================================================================

export interface QueryDescriptor<C extends readonly AnyComponentDef[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];

    with<W extends AnyComponentDef[]>(...components: W): QueryDescriptor<C>;
    without<W extends AnyComponentDef[]>(...components: W): QueryDescriptor<C>;
}

function createQueryDescriptor<C extends readonly AnyComponentDef[]>(
    components: C,
    withFilters: AnyComponentDef[] = [],
    withoutFilters: AnyComponentDef[] = []
): QueryDescriptor<C> {
    return {
        _type: 'query',
        _components: components,
        _with: withFilters,
        _without: withoutFilters,

        with<W extends AnyComponentDef[]>(...comps: W): QueryDescriptor<C> {
            return createQueryDescriptor(
                components,
                [...withFilters, ...comps],
                withoutFilters
            );
        },

        without<W extends AnyComponentDef[]>(...comps: W): QueryDescriptor<C> {
            return createQueryDescriptor(
                components,
                withFilters,
                [...withoutFilters, ...comps]
            );
        }
    };
}

// =============================================================================
// Query Factory
// =============================================================================

export function Query<C extends AnyComponentDef[]>(...components: C): QueryDescriptor<C> {
    return createQueryDescriptor(components);
}

// =============================================================================
// Query Result Type
// =============================================================================

export type QueryResult<C extends readonly AnyComponentDef[]> = [
    Entity,
    ...ComponentsData<C>
];

// =============================================================================
// Query Instance
// =============================================================================

export class QueryInstance<C extends readonly AnyComponentDef[]> implements Iterable<QueryResult<C>> {
    private readonly world_: World;
    private readonly descriptor_: QueryDescriptor<C>;

    constructor(world: World, descriptor: QueryDescriptor<C>) {
        this.world_ = world;
        this.descriptor_ = descriptor;
    }

    *[Symbol.iterator](): Iterator<QueryResult<C>> {
        const { _components, _with, _without } = this.descriptor_;

        const allRequired = [..._components, ..._with];
        const entities = this.world_.getEntitiesWithComponents(allRequired);

        for (const entity of entities) {
            let excluded = false;
            for (const comp of _without) {
                if (this.world_.has(entity, comp)) {
                    excluded = true;
                    break;
                }
            }

            if (excluded) continue;

            const components = _components.map(comp =>
                this.world_.getComponent(entity, comp)
            ) as ComponentsData<C>;

            yield [entity, ...components] as QueryResult<C>;
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

// =============================================================================
// Filter Helpers
// =============================================================================

export interface WithFilter<C extends AnyComponentDef[]> {
    readonly _filter: 'with';
    readonly _components: C;
}

export interface WithoutFilter<C extends AnyComponentDef[]> {
    readonly _filter: 'without';
    readonly _components: C;
}

export function With<C extends AnyComponentDef[]>(...components: C): WithFilter<C> {
    return { _filter: 'with', _components: components };
}

export function Without<C extends AnyComponentDef[]>(...components: C): WithoutFilter<C> {
    return { _filter: 'without', _components: components };
}
