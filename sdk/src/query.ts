/**
 * @file    query.ts
 * @brief   Component query system
 */

import { Entity } from './types';
import { AnyComponentDef, ComponentData } from './component';
import type { World } from './world';

// =============================================================================
// Query Descriptor
// =============================================================================

export interface QueryDescriptor<C extends readonly AnyComponentDef[]> {
    readonly _type: 'query';
    readonly _components: C;
    readonly _with: AnyComponentDef[];
    readonly _without: AnyComponentDef[];
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
        _without: withoutFilters
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

type ComponentsData<C extends readonly AnyComponentDef[]> = {
    [K in keyof C]: ComponentData<C[K]>;
};

export type QueryResult<C extends readonly AnyComponentDef[]> = [
    Entity,
    ...ComponentsData<C>
];

// =============================================================================
// Query Instance (Runtime)
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
                this.world_.get(entity, comp)
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
