/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */

import { AnyComponentDef } from './component';
import { getDefaultContext } from './context';
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

/** Predicate evaluated per-frame; returning false skips the system for that tick. */
export type RunCondition = () => boolean;

export interface SystemDef {
    readonly _id: symbol;
    readonly _params: readonly SystemParam[];
    readonly _fn: (...args: never[]) => void | Promise<void>;
    readonly _name: string;
}

let templateCounter_ = 0;

export interface SystemOptions {
    name?: string;
    runBefore?: string[];
    runAfter?: string[];
}

export function defineSystem<P extends readonly SystemParam[]>(
    params: [...P],
    fn: (...args: InferParams<P>) => void | Promise<void>,
    options?: SystemOptions
): SystemDef {
    const tid = ++templateCounter_;

    return {
        _id: Symbol(`SystemTemplate_${tid}`),
        _params: params,
        _fn: fn as (...args: never[]) => void,
        _name: options?.name ?? ''
    };
}

// =============================================================================
// System Set — group of systems sharing a run condition and ordering edges
// =============================================================================

/**
 * A named group of systems. When registered via `App.addSystemSet`, each
 * contained system inherits the set's `runIf` (AND-combined with its own)
 * and `runBefore`/`runAfter` edges. Other systems or sets may also reference
 * the set's *name* in their own `runBefore`/`runAfter` lists; the scheduler
 * expands such references to every member of the set.
 */
export interface SystemSet {
    readonly _kind: 'set';
    readonly _name: string;
    readonly _systems: readonly SystemDef[];
    readonly _runIf?: RunCondition;
    readonly _runBefore?: readonly string[];
    readonly _runAfter?: readonly string[];
}

export interface SystemSetOptions {
    /** Systems contained in the set. */
    systems: SystemDef[];
    /** Predicate checked per-frame; false skips every member. */
    runIf?: RunCondition;
    /** Member systems run before each of these names (may reference a set). */
    runBefore?: string[];
    /** Member systems run after each of these names (may reference a set). */
    runAfter?: string[];
}

export function defineSystemSet(name: string, options: SystemSetOptions): SystemSet {
    if (!name) throw new Error('SystemSet requires a name');
    return {
        _kind: 'set',
        _name: name,
        _systems: options.systems,
        _runIf: options.runIf,
        _runBefore: options.runBefore,
        _runAfter: options.runAfter,
    };
}

// =============================================================================
// Global System Registration
// =============================================================================

function getPendingSystems(): Array<{ schedule: number; system: unknown }> {
    return getDefaultContext().pendingSystems;
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
    private readonly queryCache_ = new Map<symbol, QueryInstance<any>[]>();
    private readonly removedCache_ = new Map<symbol, RemovedQueryInstance<any>[]>();
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

    /** @brief Clear timing data for the current frame */
    clearTimings(): void {
        this.timings_?.clear();
    }

    /** @brief Remove cached state for a single system */
    evict(systemId: symbol): void {
        this.argsCache_.delete(systemId);
        this.systemTicks_.delete(systemId);
        this.queryCache_.delete(systemId);
        this.removedCache_.delete(systemId);
    }

    /** @brief Clear all cached state */
    reset(): void {
        this.argsCache_.clear();
        this.systemTicks_.clear();
        this.queryCache_.clear();
        this.removedCache_.clear();
    }

    run(system: SystemDef): void | Promise<void> {
        let args = this.argsCache_.get(system._id);
        if (!args) {
            args = new Array(system._params.length);
            this.argsCache_.set(system._id, args);
        }

        this.currentLastRunTick_ = this.systemTicks_.get(system._id) ?? -1;

        let queries = this.queryCache_.get(system._id);
        let removeds = this.removedCache_.get(system._id);
        const firstRun = !queries;

        if (firstRun) {
            queries = [];
            removeds = [];
            this.queryCache_.set(system._id, queries);
            this.removedCache_.set(system._id, removeds);
        }

        let qi = 0, ri = 0;
        for (let i = 0; i < system._params.length; i++) {
            const param = system._params[i];
            if (param._type === 'query') {
                if (firstRun) {
                    const inst = new QueryInstance(this.world_, param, this.currentLastRunTick_);
                    queries!.push(inst);
                    args[i] = inst;
                } else {
                    const inst = queries![qi];
                    inst.resetTick(this.currentLastRunTick_);
                    args[i] = inst;
                }
                qi++;
            } else if (param._type === 'removed') {
                if (firstRun) {
                    const desc = param as RemovedQueryDescriptor<AnyComponentDef>;
                    const inst = new RemovedQueryInstance(this.world_, desc._component, this.currentLastRunTick_);
                    removeds!.push(inst);
                    args[i] = inst;
                } else {
                    const inst = removeds![ri];
                    inst.resetTick(this.currentLastRunTick_);
                    args[i] = inst;
                }
                ri++;
            } else {
                args[i] = this.resolveParam(param);
            }
        }

        const t0 = this.timings_ ? performance.now() : 0;
        let result: void | Promise<void>;
        try {
            result = (system._fn as (...args: unknown[]) => void | Promise<void>)(...args);
        } catch (e) {
            this.flushSystem_(system, args, t0);
            throw e;
        }

        if (result instanceof Promise) {
            return result.then(() => {
                this.flushSystem_(system, args, t0);
            }, (e) => {
                this.flushSystem_(system, args, t0);
                throw e;
            });
        }

        this.flushSystem_(system, args, t0);
    }

    private flushSystem_(system: SystemDef, args: unknown[], t0: number): void {
        for (let i = 0; i < args.length; i++) {
            if (args[i] instanceof CommandsInstance) {
                (args[i] as CommandsInstance).flush();
            }
        }
        if (this.timings_) {
            this.timings_.set(system._name, performance.now() - t0);
        }
        this.world_.resetIterationDepth();
        this.systemTicks_.set(system._id, this.world_.getWorldTick());
    }

    private resolveParam(param: SystemParam): unknown {
        switch (param._type) {
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

            case 'get_world':
                return this.world_;

            default:
                throw new Error('Unknown system parameter type');
        }
    }
}
