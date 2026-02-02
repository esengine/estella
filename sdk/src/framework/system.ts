/**
 * @file    system.ts
 * @brief   System definition API with parameter injection
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

import { QueryDescriptor, QueryInstance } from './query';
import { ResDescriptor, ResMutDescriptor, ResInstance, ResMutInstance, ResourceStorage } from './resource';
import { CommandsDescriptor, CommandsInstance } from './commands';
import { World, AnyComponentDef } from './world';

// =============================================================================
// System Parameter Types
// =============================================================================

export type SystemParam =
    | QueryDescriptor<readonly AnyComponentDef[]>
    | ResDescriptor<unknown>
    | ResMutDescriptor<unknown>
    | CommandsDescriptor;

// =============================================================================
// Parameter Type Inference
// =============================================================================

export type InferParam<P> =
    P extends QueryDescriptor<infer C> ? QueryInstance<C> :
    P extends ResDescriptor<infer T> ? T :
    P extends ResMutDescriptor<infer T> ? ResMutInstance<T> :
    P extends CommandsDescriptor ? CommandsInstance :
    never;

export type InferParams<P extends readonly SystemParam[]> = {
    [K in keyof P]: InferParam<P[K]>;
};

// =============================================================================
// System Definition
// =============================================================================

export interface SystemDef {
    readonly _id: symbol;
    readonly _params: readonly SystemParam[];
    readonly _fn: (...args: unknown[]) => void;
    readonly _name: string;
}

let systemCounter = 0;

export function defineSystem<P extends readonly SystemParam[]>(
    params: [...P],
    fn: (...args: InferParams<P>) => void,
    options?: { name?: string }
): SystemDef {
    const id = ++systemCounter;

    return {
        _id: Symbol(`System_${id}_${options?.name ?? ''}`),
        _params: params,
        _fn: fn as (...args: unknown[]) => void,
        _name: options?.name ?? `System_${id}`
    };
}

// =============================================================================
// System Runner
// =============================================================================

export class SystemRunner {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;

    constructor(world: World, resources: ResourceStorage) {
        this.world_ = world;
        this.resources_ = resources;
    }

    run(system: SystemDef): void {
        const args = system._params.map(param => this.resolveParam(param));

        system._fn(...args);

        for (const arg of args) {
            if (arg instanceof CommandsInstance) {
                arg.flush();
            }
        }
    }

    private resolveParam(param: SystemParam): unknown {
        switch (param._type) {
            case 'query':
                return new QueryInstance(this.world_, param);

            case 'res':
                return this.resources_.get(param._resource);

            case 'res_mut':
                return this.resources_.getResMut(param._resource);

            case 'commands':
                return new CommandsInstance(this.world_, this.resources_);

            default:
                throw new Error(`Unknown system parameter type`);
        }
    }
}

// =============================================================================
// System Condition
// =============================================================================

export type SystemCondition = () => boolean;

export interface ConditionalSystemDef extends SystemDef {
    readonly _condition?: SystemCondition;
}

export function runIf(condition: SystemCondition, system: SystemDef): ConditionalSystemDef {
    return {
        ...system,
        _condition: condition
    };
}
