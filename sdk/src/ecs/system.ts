// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    system.ts
 * @brief   System definition and scheduling
 */

import { AnyComponentDef } from './component';
import { getDefaultContext } from './context';
import { QueryDescriptor, QueryInstance, QueryArg, RemovedQueryDescriptor, RemovedQueryInstance, type QueryCost } from './query';
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

/**
 * When in a frame a system runs, in the order listed; `Startup` runs once before
 * the first frame. The `Fixed*` three are the simulation's cadence, running zero
 * or more times per frame as `Time.fixedDelta` accumulates — where anything that
 * must be deterministic belongs.
 *
 * @public
 */
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

/**
 * A request for the {@link World} itself, as {@link GetWorld} returns it — the
 * escape hatch for work the declared parameters cannot express.
 *
 * @public
 */
export interface GetWorldDescriptor {
    /** @internal */
    readonly _type: 'get_world';
}

/**
 * Ask a system for the {@link World} itself. The escape hatch: it declares no
 * access, so the scheduler cannot see what the system touches and the query cache
 * cannot serve it. Reach for `Query`/`Res`/`Commands` first.
 *
 * @public
 */
export function GetWorld(): GetWorldDescriptor {
    return { _type: 'get_world' };
}

// =============================================================================
// System Parameter Types
// =============================================================================

/**
 * Anything that may appear in a system's parameter list — what {@link Query},
 * {@link Res}, {@link Commands} and their siblings return. Each is a request for
 * access, resolved to a live value by {@link InferParams} when the system runs.
 *
 * @public
 */
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

/**
 * One parameter's declaration resolved to the value a system body receives.
 * {@link InferParams} maps this over a whole list; a request this does not
 * recognise resolves to `never`, which is what makes a bad parameter a type
 * error at the definition rather than a surprise at the call.
 *
 * @public
 */
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

/**
 * The values a system body receives, derived from the parameters it declared —
 * a `Query(...)` becomes a `QueryInstance`, a `Res(X)` becomes the resource
 * value. Inferred, so a system body's arguments are typed without annotation.
 *
 * @public
 */
export type InferParams<P extends readonly SystemParam[]> = {
    [K in keyof P]: InferParam<P[K]>;
};

// =============================================================================
// System Definition
// =============================================================================

/**
 * Predicate evaluated per-frame; returning false skips the system for that tick.
 * It is asked once per schedule run, so a set of nine systems gated on one pause
 * flag reads it once and either all nine run or none do.
 *
 * @public
 */
export type RunCondition = () => boolean;

/**
 * A declared system, as {@link defineSystem} returns it. Opaque: hand it to
 * `addSystem`, a {@link SystemSet} or a schedule rather than reading it — every
 * member is engine plumbing and may change.
 *
 * @public
 */
export interface SystemDef {
    /** @internal */
    readonly _id: symbol;
    /** @internal */
    readonly _params: readonly SystemParam[];
    /** @internal */
    readonly _fn: (...args: never[]) => void | Promise<void>;
    /** @internal */
    readonly _name: string;
    /** @internal */
    readonly _runBefore?: readonly string[];
    /** @internal */
    readonly _runAfter?: readonly string[];
    /** @internal */
    readonly _touches?: SystemTouches | (() => SystemTouches);
}

let templateCounter_ = 0;

/**
 * Ordering a system carries with it. The names are matched against other
 * systems' names and against {@link SystemSet} names, so a set can be ordered
 * against without knowing which systems are in it.
 *
 * @public
 */
export interface SystemOptions {
    /** Name other systems reference in their ordering edges. */
    name?: string;
    /** This system runs before each of these names (a system or a set). */
    runBefore?: string[];
    /** This system runs after each of these names (a system or a set). */
    runAfter?: string[];
    /**
     * What the system reaches for through {@link GetWorld}. See {@link SystemTouches}.
     *
     * A function is re-read every time the access is, which is what lets a system
     * running authored data (an FSM, a behaviour tree) answer from the data
     * actually loaded rather than from everything it could ever be handed.
     */
    touches?: SystemTouches | (() => SystemTouches);
}

/**
 * What a system reaches for outside its declared parameters — a {@link GetWorld}
 * user's claim about the escape hatch, without which the scheduler assumes it
 * touches everything. By component NAME: the reason to reach through the World
 * is usually a type registered later than the system.
 *
 * @public
 */
export interface SystemTouches {
    reads?: readonly string[];
    writes?: readonly string[];
    /**
     * Some of the reach genuinely cannot be named — a system running data a
     * project authored, where one of the leaves does not say what it writes.
     * Declared rather than left out: an omitted `touches` and a known-incomplete
     * one are both "assume everything", but only this one says so on purpose.
     */
    opaque?: boolean;
}

/**
 * Declare a system: what it reads and writes, and the function to run.
 *
 * Ordering declared here travels with the definition, so it applies wherever
 * the system is registered — including the top-level {@link addSystem}, which
 * takes no options of its own. Edges given again at the registration site (or
 * on the enclosing {@link SystemSet}) are added to these, not replaced.
 *
 * @public
 */
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
        _name: options?.name ?? '',
        _runBefore: options?.runBefore,
        _runAfter: options?.runAfter,
        _touches: options?.touches,
    };
}

/**
 * The same system under a scheduler-owned identity and name.
 *
 * Registration gives a template its own id so the same definition can be added
 * twice, and copying the fields by hand at each site is how a field added to
 * SystemDef silently stops travelling with it.
 */
export function rescopeSystem(system: SystemDef, name: string): SystemDef {
    return {
        ...system,
        _id: Symbol(`System_${name}`),
        _name: name,
    };
}

/** Union of ordering edges from two sources, preserving first-seen order. */
export function mergeOrderingEdges(
    a: readonly string[] | undefined,
    b: readonly string[] | undefined
): string[] | undefined {
    if (!a?.length) return b?.length ? [...b] : undefined;
    if (!b?.length) return [...a];
    const out = [...a];
    for (const name of b) {
        if (!out.includes(name)) out.push(name);
    }
    return out;
}

// =============================================================================
// System Set — group of systems sharing a run condition and ordering edges
// =============================================================================

/**
 * A named group of systems. When registered via `App.addSystemSet`, every
 * member gets the set's `runIf` and its `runBefore` / `runAfter` edges — the
 * group's ordering written once instead of per system. Other
 * systems or sets may also reference the set's *name* in their own edges; the
 * scheduler expands such a reference to every member of the set.
 *
 * Build one with {@link defineSystemSet}; the underscore-prefixed fields are
 * the scheduler's, not an authoring surface.
 *
 * @public
 */
export interface SystemSet {
    /** @internal */
    readonly _kind: 'set';
    /** @internal */
    readonly _name: string;
    /** @internal */
    readonly _systems: readonly SystemDef[];
    /** @internal */
    readonly _runIf?: RunCondition;
    /** @internal */
    readonly _runBefore?: readonly string[];
    /** @internal */
    readonly _runAfter?: readonly string[];
}

/**
 * What a {@link SystemSet} is built out of. `systems` keeps the order it is
 * written in; `runIf` and the two edge lists apply to every member.
 *
 * @public
 */
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

/**
 * Group systems under one name so ordering and run conditions are written once.
 *
 * ```ts
 * const physics = defineSystemSet('physics', {
 *     systems: [applyForces, integrateVelocity],
 *     runBefore: ['render'],
 *     runIf: () => !paused,
 * });
 * app.addSystemSetToSchedule(Schedule.FixedUpdate, physics);
 * ```
 *
 * Members keep the order they are listed in; anything constraining `'physics'`
 * constrains all of them.
 *
 * @public
 */
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

/**
 * Register a system to run once, before the first frame — where a project spawns
 * its world. Startup runs after the engine's own startup, so the components and
 * resources a system asks for are there.
 *
 * @public
 */
export function addStartupSystem(system: SystemDef): void {
    getPendingSystems().push({ schedule: Schedule.Startup, system });
}

/**
 * Register a system in a {@link Schedule}. This is how a project bundle's
 * systems reach the loop: the call records them, and the app drains what was
 * recorded when it starts, so module-level registration works before an `App`
 * exists.
 *
 * @public
 */
export function addSystemToSchedule(schedule: Schedule, system: SystemDef): void {
    getPendingSystems().push({ schedule, system });
}

/**
 * Register a {@link SystemSet} from a project bundle, the module-level twin of
 * `App.addSystemSetToSchedule`. Without it a project can define a set — the run
 * condition a pause is written as — and have no door to register it through.
 *
 * @public
 */
export function addSystemSetToSchedule(schedule: Schedule, set: SystemSet): void {
    getPendingSystems().push({ schedule, system: set });
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
    private queryCosts_: Map<string, QueryCost> | null = null;

    constructor(world: World, resources: ResourceStorage, eventRegistry?: EventRegistry) {
        this.world_ = world;
        this.resources_ = resources;
        this.eventRegistry_ = eventRegistry ?? null;
    }

    setTimingEnabled(enabled: boolean): void {
        this.timings_ = enabled ? new Map() : null;
        this.queryCosts_ = enabled ? new Map() : null;
        this.world_.setQueryCostEnabled(enabled);
    }

    getTimings(): ReadonlyMap<string, number> | null {
        return this.timings_;
    }

    /**
     * Per-system query cost for the frame: what each system's queries walked, and
     * how much of that a change filter then discarded. This is what turns "7ms"
     * into "7ms over 18,400 entities, none of which had changed".
     */
    getQueryCosts(): ReadonlyMap<string, QueryCost> | null {
        return this.queryCosts_;
    }

    /** @brief Clear timing data for the current frame */
    clearTimings(): void {
        this.timings_?.clear();
        this.queryCosts_?.clear();
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

        // Published only once every param resolved. Building a system's first set
        // of query instances can throw — an unregistered component reaches
        // resolveGetter, and that is exactly when it says so — and a cache
        // published up front kept whatever had been built before the throw. The
        // next frame then read `firstRun === false` against a SHORT array, found
        // `undefined` where a later query belonged, and reported
        // "cannot read properties of undefined (reading 'resetTick')" forever:
        // the true error scrolls away and every frame after it names the runner.
        // Commit at the end instead, so a failed setup is simply not cached and
        // the following frame re-raises the real one.
        const cachedQueries = this.queryCache_.get(system._id);
        const firstRun = !cachedQueries;
        const queries = cachedQueries ?? [];
        const removeds = this.removedCache_.get(system._id) ?? [];

        let qi = 0, ri = 0;
        for (let i = 0; i < system._params.length; i++) {
            const param = system._params[i];
            if (param._type === 'query') {
                if (firstRun) {
                    const inst = new QueryInstance(this.world_, param, this.currentLastRunTick_);
                    queries.push(inst);
                    args[i] = inst;
                } else {
                    const inst = queries[qi];
                    inst.resetTick(this.currentLastRunTick_);
                    args[i] = inst;
                }
                qi++;
            } else if (param._type === 'removed') {
                if (firstRun) {
                    const desc = param as RemovedQueryDescriptor<AnyComponentDef>;
                    const inst = new RemovedQueryInstance(this.world_, desc._component, this.currentLastRunTick_);
                    removeds.push(inst);
                    args[i] = inst;
                } else {
                    const inst = removeds[ri];
                    inst.resetTick(this.currentLastRunTick_);
                    args[i] = inst;
                }
                ri++;
            } else {
                args[i] = this.resolveParam(param);
            }
        }
        if (firstRun) {
            this.queryCache_.set(system._id, queries);
            this.removedCache_.set(system._id, removeds);
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
            // Parked here, another system may run. The iteration guard belongs to
            // the world, so this one's share of it is set aside until it resumes.
            const suspended = this.world_.suspendIteration();
            const resume = (): void => {
                this.world_.resumeIteration(suspended);
                this.flushSystem_(system, args, t0);
            };
            return result.then(resume, (e) => {
                resume();
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
        if (this.queryCosts_) {
            this.harvestQueryCost_(system);
        }
        if (this.timings_) {
            // Accumulated, not assigned: a fixed schedule runs as many times in one
            // frame as the accumulator has steps for, and the frame cost of such a
            // system is all of them. Assigning reported the last step alone.
            const name = system._name;
            this.timings_.set(name, (this.timings_.get(name) ?? 0) + (performance.now() - t0));
        }
        this.world_.resetIterationDepth();
        this.systemTicks_.set(system._id, this.world_.getWorldTick());
    }

    private harvestQueryCost_(system: SystemDef): void {
        const queries = this.queryCache_.get(system._id);
        if (!queries || queries.length === 0) return;
        const name = system._name;
        const total = this.queryCosts_!.get(name) ?? { calls: 0, scanned: 0, filtered: 0 };
        for (const q of queries) {
            const cost = q.takeCost();
            total.calls += cost.calls;
            total.scanned += cost.scanned;
            total.filtered += cost.filtered;
        }
        if (total.calls > 0) this.queryCosts_!.set(name, total);
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
