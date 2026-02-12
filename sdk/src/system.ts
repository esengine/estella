/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */

import { AnyComponentDef } from './component';
import { QueryDescriptor, QueryInstance, MutWrapper } from './query';
import { ResDescriptor, ResMutDescriptor, ResMutInstance, ResourceStorage } from './resource';
import { CommandsDescriptor, CommandsInstance } from './commands';
import type { World } from './world';

// =============================================================================
// Schedule Phases
// =============================================================================

export enum Schedule {
    Startup = 0,
    First = 1,
    PreUpdate = 2,
    Update = 3,
    PostUpdate = 4,
    Last = 5,
    FixedPreUpdate = 10,
    FixedUpdate = 11,
    FixedPostUpdate = 12,
}

// =============================================================================
// System Parameter Types
// =============================================================================

type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef>;

export type SystemParam =
    | QueryDescriptor<readonly QueryArg[]>
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
// Global System Registration
// =============================================================================

function getPendingSystems(): Array<{ schedule: number; system: unknown }> {
    if (typeof window === 'undefined') return [];
    return (window.__esengine_pendingSystems ??= []);
}

export function addSystem(system: SystemDef): void {
    getPendingSystems().push({ schedule: Schedule.Update, system });
}

export function addStartupSystem(system: SystemDef): void {
    getPendingSystems().push({ schedule: Schedule.Startup, system });
}

export function addSystemToSchedule(schedule: Schedule, system: SystemDef): void {
    getPendingSystems().push({ schedule, system });
}

// =============================================================================
// System Runner
// =============================================================================

export class SystemRunner {
    private readonly world_: World;
    private readonly resources_: ResourceStorage;
    private readonly argsCache_ = new Map<symbol, unknown[]>();

    constructor(world: World, resources: ResourceStorage) {
        this.world_ = world;
        this.resources_ = resources;
    }

    run(system: SystemDef): void {
        let args = this.argsCache_.get(system._id);
        if (!args) {
            args = new Array(system._params.length);
            this.argsCache_.set(system._id, args);
        }

        for (let i = 0; i < system._params.length; i++) {
            args[i] = this.resolveParam(system._params[i]);
        }

        system._fn(...args);

        for (let i = 0; i < args.length; i++) {
            if (args[i] instanceof CommandsInstance) {
                (args[i] as CommandsInstance).flush();
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
                throw new Error('Unknown system parameter type');
        }
    }
}
