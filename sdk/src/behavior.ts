// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    behavior.ts
 * @brief   defineBehavior — per-entity scripted behavior, compiled to one ECS system.
 *
 * The authoring sugar for the gameplay loop: a behavior is a `defineComponent`
 * (its `state`, attachable + tunable per-entity in the editor Details panel) plus
 * an auto-registered system that drives `start` / `update` / `destroy` for every
 * entity carrying that component. There is no second runtime — it desugars
 * entirely onto the existing ECS-system model (REARCH_GAMEPLAY.md §2.2).
 */
import type { Entity } from './types';
import {
    defineComponent,
    type AnyComponentDef,
    type ComponentData,
    type ComponentDef,
    type ComponentMetadata,
} from './component';
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from './system';
import { Query, Mut } from './query';
import { Res, Time, type TimeData } from './resource';
import { Commands, type CommandsInstance } from './commands';
import { Input, type InputState } from './input';
import type { World } from './world';

/**
 * The per-entity handle passed to a behavior's lifecycle hooks. `self` is the
 * behavior's own component data — mutate it freely, the change persists. The
 * object is REUSED across entities and frames (zero per-entity allocation): do
 * not retain it past the hook call; copy what you need.
 */
export interface BehaviorContext<S extends object> {
    /** The entity this behavior instance is attached to. */
    readonly entity: Entity;
    /** This behavior's own component data — mutate freely (persists). */
    readonly self: S;
    /** Frame timing (`delta` seconds, `elapsed`, …). */
    readonly time: TimeData;
    /** Runtime input (keyboard / mouse / touch). */
    readonly input: InputState;
    /** Deferred structural ops (spawn / despawn / insert) — safe mid-iteration. */
    readonly commands: CommandsInstance;
    /** The world, for cross-entity access. */
    readonly world: World;
    /** Read another component on THIS entity. */
    get<C extends AnyComponentDef>(component: C): ComponentData<C>;
    /** Write another component on THIS entity. */
    set<C extends AnyComponentDef>(component: C, data: ComponentData<C>): void;
    /** Whether THIS entity has `component`. */
    has(component: AnyComponentDef): boolean;
}

export interface BehaviorDef<S extends object> {
    /** Per-entity state → a `defineComponent`, editable in the Details panel. */
    state?: S;
    /** Schedule the lifecycle system runs in (default `Schedule.Update`). */
    schedule?: Schedule;
    /** Field-presentation metadata for `state` (ranges, enums, …), forwarded to the component. */
    metadata?: ComponentMetadata;
    /** Run once, the frame the behavior's component first appears on an entity. */
    start?(ctx: BehaviorContext<S>): void;
    /** Run every frame for each entity carrying the behavior. `dt` == `ctx.time.delta`. */
    update?(ctx: BehaviorContext<S>, dt: number): void;
    /** Run once when the component is removed OR the entity is despawned. */
    destroy?(ctx: BehaviorContext<S>): void;
}

/** Internal: the mutable backing of the reused {@link BehaviorContext}. */
interface MutableContext<S extends object> {
    entity: Entity;
    self: S;
    time: TimeData;
    input: InputState;
    commands: CommandsInstance;
    world: World;
    get<C extends AnyComponentDef>(component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(component: C, data: ComponentData<C>): void;
    has(component: AnyComponentDef): boolean;
}

/**
 * Define a per-entity behavior. Returns the backing {@link ComponentDef} (so you
 * can spawn/insert it from code), and registers the lifecycle system as a side
 * effect.
 *
 * @example
 * export const Patrol = defineBehavior('Patrol', {
 *   state: { speed: 60 },
 *   update(ctx, dt) { ctx.get(Transform).position.x += ctx.self.speed * dt; },
 * });
 */
export function defineBehavior<S extends object>(name: string, def: BehaviorDef<S>): ComponentDef<S> {
    const Comp = defineComponent<S>(name, (def.state ?? ({} as S)), def.metadata);
    const schedule = def.schedule ?? Schedule.Update;

    // Lifecycle is presence-diffed against the live query, NOT tick-based removed
    // detection: a behavior system that runs before whoever despawns would miss a
    // same-tick removal. Instead `destroy` fires the frame an entity drops out of
    // the query (component removed OR entity despawned) — order-independent.
    // `started` is per-system-instance state, rebuilt fresh on hot-reload, so a
    // reload re-runs `start` (matching the fast-restart semantics).
    const started = new Set<Entity>();
    const seen = new Set<Entity>();
    const lastData = def.destroy ? new Map<Entity, S>() : null;
    const gone: Entity[] = [];

    // One reused context; methods close over `ctx` (not `this`) so they survive
    // destructuring (`const { get } = ctx`).
    const ctx: MutableContext<S> = {
        entity: 0 as Entity,
        self: null as unknown as S,
        time: null as unknown as TimeData,
        input: null as unknown as InputState,
        commands: null as unknown as CommandsInstance,
        world: null as unknown as World,
        get(component) { return ctx.world.get(ctx.entity, component); },
        set(component, data) { ctx.world.set(ctx.entity, component, data); },
        has(component) { return ctx.world.has(ctx.entity, component); },
    };

    const { start, update, destroy } = def;

    const system = defineSystem(
        [Query(Mut(Comp)), Res(Time), Res(Input), Commands(), GetWorld()],
        (q, time, input, commands, world) => {
            ctx.time = time;
            ctx.input = input;
            ctx.commands = commands;
            ctx.world = world;
            seen.clear();

            for (const [entity, data] of q) {
                const self = data as unknown as S;
                seen.add(entity);
                ctx.entity = entity;
                ctx.self = self;
                if (!started.has(entity)) {
                    started.add(entity);
                    start?.(ctx);
                }
                update?.(ctx, time.delta);
                lastData?.set(entity, self);
            }

            if (destroy) {
                gone.length = 0;
                for (const e of started) if (!seen.has(e)) gone.push(e);
                for (const e of gone) {
                    started.delete(e);
                    ctx.entity = e;
                    ctx.self = (lastData?.get(e) ?? ({} as S));
                    destroy(ctx);
                    lastData?.delete(e);
                }
            }
        },
        { name: `Behavior:${name}` },
    );

    addSystemToSchedule(schedule, system);
    return Comp;
}
