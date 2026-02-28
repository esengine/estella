/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */

import { AnyComponentDef } from './component';
import { QueryDescriptor, QueryInstance, MutWrapper, RemovedQueryDescriptor, RemovedQueryInstance } from './query';
import { ResDescriptor, ResMutDescriptor, ResMutInstance, ResourceStorage } from './resource';
import { CommandsDescriptor, CommandsInstance } from './commands';
import {
    EventWriterDescriptor, EventReaderDescriptor,
    EventWriterInstance, EventReaderInstance,
    EventRegistry,
} from './event';
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
// World Access Descriptor
// =============================================================================

export interface GetWorldDescriptor {
    readonly _type: 'get_world';
}

export function GetWorld(): GetWorldDescriptor {
    return { _type: 'get_world' };
}

// =============================================================================
// System Parameter Types
// =============================================================================

type QueryArg = AnyComponentDef | MutWrapper<AnyComponentDef>;

export type SystemParam =
    | QueryDescriptor<readonly QueryArg[]>
    | ResDescriptor<unknown>
    | ResMutDescriptor<unknown>
    | CommandsDescriptor
    | EventWriterDescriptor<unknown>
    | EventReaderDescriptor<unknown>
    | RemovedQueryDescriptor<AnyComponentDef>
    | GetWorldDescriptor;

// =============================================================================
// Parameter Type Inference
// =============================================================================

export type InferParam<P> =
    P extends QueryDescriptor<infer C> ? QueryInstance<C> :
    P extends ResDescriptor<infer T> ? T :
    P extends ResMutDescriptor<infer T> ? ResMutInstance<T> :
    P extends CommandsDescriptor ? CommandsInstance :
    P extends EventWriterDescriptor<infer T> ? EventWriterInstance<T> :
    P extends EventReaderDescriptor<infer T> ? EventReaderInstance<T> :
    P extends RemovedQueryDescriptor<infer _T> ? RemovedQueryInstance<_T> :
    P extends GetWorldDescriptor ? World :
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
    readonly _fn: (...args: never[]) => void;
    readonly _name: string;
}

let systemCounter = 0;

export interface SystemOptions {
    name?: string;
    runBefore?: string[];
    runAfter?: string[];
}

export function defineSystem<P extends readonly SystemParam[]>(
    params: [...P],
    fn: (...args: InferParams<P>) => void,
    options?: SystemOptions
): SystemDef {
    const id = ++systemCounter;

    return {
        _id: Symbol(`System_${id}_${options?.name ?? ''}`),
        _params: params,
        _fn: fn as (...args: never[]) => void,
        _name: options?.name ?? `System_${id}`
    };
}

// =============================================================================
// Global System Registration
// =============================================================================

function getPendingSystems(): Array<{ schedule: number; system: unknown }> {
    const g = globalThis as any;
    return (g.__esengine_pendingSystems ??= []);
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
    private readonly eventRegistry_: EventRegistry | null;
    private readonly argsCache_ = new Map<symbol, unknown[]>();
    private readonly systemTicks_ = new Map<symbol, number>();
    private currentLastRunTick_ = -1;
    private timings_: Map<string, number> | null = null;

    constructor(world: World, resources: ResourceStorage, eventRegistry?: EventRegistry) {
        this.world_ = world;
        this.resources_ = resources;
        this.eventRegistry_ = eventRegistry ?? null;
    }

    setTimingEnabled(enabled: boolean): void {
        this.timings_ = enabled ? new Map() : null;
    }

    getTimings(): ReadonlyMap<string, number> | null {
        return this.timings_;
    }

    run(system: SystemDef): void {
        let args = this.argsCache_.get(system._id);
        if (!args) {
            args = new Array(system._params.length);
            this.argsCache_.set(system._id, args);
        }

        this.currentLastRunTick_ = this.systemTicks_.get(system._id) ?? -1;

        for (let i = 0; i < system._params.length; i++) {
            args[i] = this.resolveParam(system._params[i]);
        }

        const t0 = this.timings_ ? performance.now() : 0;
        try {
            (system._fn as (...args: unknown[]) => void)(...args);

            for (let i = 0; i < args.length; i++) {
                if (args[i] instanceof CommandsInstance) {
                    (args[i] as CommandsInstance).flush();
                }
            }
        } finally {
            if (this.timings_) {
                this.timings_.set(system._name, performance.now() - t0);
            }
            this.world_.resetIterationDepth();
            this.systemTicks_.set(system._id, this.world_.getWorldTick());
        }
    }

    private resolveParam(param: SystemParam): unknown {
        switch (param._type) {
            case 'query':
                return new QueryInstance(this.world_, param, this.currentLastRunTick_);

            case 'res':
                return this.resources_.get(param._resource);

            case 'res_mut':
                return this.resources_.getResMut(param._resource);

            case 'commands':
                return new CommandsInstance(this.world_, this.resources_);

            case 'event_writer': {
                const desc = param as EventWriterDescriptor<unknown>;
                const bus = this.eventRegistry_
                    ? this.eventRegistry_.getBus(desc._event)
                    : (() => { throw new Error('EventRegistry not available'); })();
                return new EventWriterInstance(bus);
            }

            case 'event_reader': {
                const desc = param as EventReaderDescriptor<unknown>;
                const bus = this.eventRegistry_
                    ? this.eventRegistry_.getBus(desc._event)
                    : (() => { throw new Error('EventRegistry not available'); })();
                return new EventReaderInstance(bus);
            }

            case 'removed': {
                const desc = param as RemovedQueryDescriptor<AnyComponentDef>;
                return new RemovedQueryInstance(this.world_, desc._component, this.currentLastRunTick_);
            }

            case 'get_world':
                return this.world_;

            default:
                throw new Error('Unknown system parameter type');
        }
    }
}
