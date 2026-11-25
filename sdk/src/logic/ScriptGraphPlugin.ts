// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScriptGraphPlugin.ts
 * @brief   Ticks ScriptGraphAgents against the shared runtime + registry.
 *
 * Per-entity run state and blackboard live in a closure Map (the `defineBehavior`
 * pattern), so the component stays serializable. The per-frame body is
 * `stepScriptGraphs`, extracted to unit-test against a fake world. Gated to play
 * mode and run in `Update` beside the FSM, which is the schedule slot the other
 * authored-graph interpreters already hold.
 */

import type { App, Plugin } from '../app/app';
import type { Entity } from '../types';
import type { World } from '../ecs/world';
import { defineSystem, Schedule, GetWorld, type SystemTouches } from '../ecs/system';
import { Res, Time, defineResource, type TimeData } from '../ecs/resource';
import { Commands, type CommandsInstance } from '../ecs/commands';
import { playModeOnly } from '../ecs/env';
import type { AnyComponentDef, ComponentData } from '../ecs/component';
import { log } from '../util/logger';
import { Blackboard } from '../ai/fsm/Blackboard';
import { aiRegistry, noInput, type AiContext } from '../ai/fsm/AiContext';
import { Input, type InputState } from '../input/input';
import { ensureBuiltinAiRegistrations } from '../ai/builtins';
import { ensureBuiltinScriptNodes } from './builtinNodes';
import { TouchesBuilder, touchesOfLeaves, type LeafRef } from '../ai/worldView';
import { appRegistryAsset, appRegistryAssets } from '../asset/registryLookup';
import { sceneContextForEntity } from '../scene/sceneManagerResource';
import type { SceneContext } from '../scene/sceneManager';
import { ensureEntityEvents, type EntityEvent, type EntityEventQueue, type Unsubscribe } from '../ecs/entityEvents';
import { ScriptGraphAgent, getScriptGraph, allScriptGraphs } from './ScriptGraphAgent';
import {
    createScriptRunState, stepScriptGraph, destroyScriptGraph, fireScriptGraphEvent,
    type CompiledScriptGraph, type ScriptRunState, type ScriptTickContext,
} from './ScriptGraphRunner';
import type { ScriptValue } from './types';

/** Per-entity graph runtime: blackboard persists; run rebuilds when the key changes. */
interface AgentState {
    bb: Blackboard;
    run: ScriptRunState | null;
    graphKey: string | null;
    compiled: CompiledScriptGraph | null;
    /** Refs this agent asked for and nothing had, reported once each. */
    missing: Set<string>;
}

/** The slice of `World` the step needs — lets tests inject a fake. */
export interface ScriptGraphWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): readonly Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    has(entity: Entity, component: AnyComponentDef): boolean;
}

type MutableAiContext = { -readonly [K in keyof AiContext]: AiContext[K] };
type GraphResolver = (ref: string, entity: Entity) => CompiledScriptGraph | undefined;
type SpawnSceneResolver = (entity: Entity) => Pick<SceneContext, 'adopt'> | null;

/** Get (creating if needed) an agent's blackboard — lets game code seed data early. */
export function agentGraphBlackboard(states: Map<Entity, AgentState>, entity: Entity): Blackboard {
    let st = states.get(entity);
    if (!st) {
        st = { bb: new Blackboard(), run: null, graphKey: null, compiled: null, missing: new Set() };
        states.set(entity, st);
    }
    return st.bb;
}

function contextFor(world: ScriptGraphWorldView, commands: CommandsInstance, input: InputState): MutableAiContext {
    const ctx: MutableAiContext = {
        entity: 0 as Entity,
        dt: 0,
        blackboard: null as unknown as Blackboard,
        input,
        world: world as unknown as World,
        commands,
        get: c => world.get(ctx.entity, c),
        set: (c, d) => world.set(ctx.entity, c, d),
        has: c => world.has(ctx.entity, c),
    };
    return ctx;
}

function agentTick(
    ctx: MutableAiContext, entity: Entity, st: AgentState, dt: number,
    resolveGraph?: GraphResolver, onProblem?: (entity: Entity, message: string) => void, sceneForSpawn?: SpawnSceneResolver,
): ScriptTickContext<AiContext> {
    ctx.entity = entity;
    ctx.dt = dt;
    ctx.blackboard = st.bb;
    return {
        ctx, bb: st.bb, registry: aiRegistry, dt, world: ctx.world,
        onProblem: message => onProblem?.(entity, message),
        resolveGraph: ref => resolveGraph?.(ref, entity) ?? getScriptGraph(ref),
        sceneForSpawn: sceneForSpawn && (() => sceneForSpawn(entity)),
    };
}

/**
 * Advance every ScriptGraphAgent one tick, and run `event.destroy` for the ones
 * that left. Presence is diffed against the live query rather than watching for
 * removals, so a graph's teardown fires the frame its entity drops out however
 * it left — the `defineBehavior` lifecycle contract.
 */
export function stepScriptGraphs(
    world: ScriptGraphWorldView,
    commands: CommandsInstance,
    dt: number,
    states: Map<Entity, AgentState>,
    resolveGraph?: (ref: string, entity: Entity) => CompiledScriptGraph | undefined,
    onProblem?: (entity: Entity, message: string) => void,
    input: InputState = noInput(),
    sceneForSpawn?: (entity: Entity) => Pick<SceneContext, 'adopt'> | null,
): void {
    const ctx = contextFor(world, commands, input);
    const tick = (entity: Entity, st: AgentState, delta: number) =>
        agentTick(ctx, entity, st, delta, resolveGraph, onProblem, sceneForSpawn);

    const absent = new Set(states.keys());
    for (const entity of world.getEntitiesWithComponents([ScriptGraphAgent])) {
        absent.delete(entity);
        const agent = world.get(entity, ScriptGraphAgent);

        let st = states.get(entity);
        if (!st) {
            if (!agent.graph) continue;
            st = { bb: new Blackboard(), run: null, graphKey: null, compiled: null, missing: new Set() };
            states.set(entity, st);
        }
        if (st.graphKey !== agent.graph) {
            st.graphKey = agent.graph;
            st.run = null;
        }
        if (!agent.graph) {
            st.compiled = null;
            continue;
        }
        const compiled = resolveGraph?.(agent.graph, entity) ?? getScriptGraph(agent.graph);
        st.compiled = compiled ?? null;
        // A ref nothing has is the loudest thing this system can find: the
        // entity carries a graph, and NOT running it looks exactly like running
        // one that does nothing.
        if (!compiled) {
            if (!st.missing.has(agent.graph)) {
                st.missing.add(agent.graph);
                onProblem?.(entity, `graph "${agent.graph}" is not registered — nothing runs`);
            }
            continue;
        }
        st.missing.delete(agent.graph);
        if (st.run === null) {
            st.run = createScriptRunState(compiled);
            for (const problem of compiled.problems) onProblem?.(entity, problem);
        }
        stepScriptGraph(compiled, st.run, tick(entity, st, dt));
    }

    for (const entity of absent) {
        const st = states.get(entity);
        if (st?.run && st.graphKey) {
            const lastTick = tick(entity, st, 0);
            const compiled = lastTick.resolveGraph?.(st.graphKey);
            if (compiled) destroyScriptGraph(compiled, st.run, lastTick);
        }
        states.delete(entity);
    }
}

/** Every leaf a compiled graph names — one per `call` node. */
export function* scriptGraphLeaves(compiled: CompiledScriptGraph): Iterable<LeafRef> {
    for (const node of compiled.graph.nodes) {
        if (node.kind === 'call' && node.ref) yield { kind: 'action', name: node.ref };
    }
}

/**
 * What the script-graph system reaches for: the union over the graphs THIS app
 * has. Read per app, because a schedule is per app.
 */
export function scriptGraphTouches(app: App): SystemTouches {
    const builder = new TouchesBuilder().reading(ScriptGraphAgent._name);
    const loaded = [
        ...appRegistryAssets<CompiledScriptGraph>(app, 'scriptgraph'),
        ...allScriptGraphs(),
    ];
    for (const compiled of loaded) touchesOfLeaves(aiRegistry, scriptGraphLeaves(compiled), builder);
    return builder.build();
}

/**
 * Keeps the subscribed event types equal to the union the loaded graphs listen
 * for. One handler per TYPE rather than per (entity, type): a graph swapped at
 * runtime then needs no re-subscription, and a bubbled event still reaches an
 * ancestor's graph because it dispatches with `currentTarget` set to it.
 */
function createEventBridge(
    events: EntityEventQueue,
    states: Map<Entity, AgentState>,
    tickOf: (entity: Entity, st: AgentState) => ScriptTickContext<AiContext>,
): { sync(): void; dispose(): void } {
    const subscriptions = new Map<string, Unsubscribe>();

    const handle = (event: EntityEvent): void => {
        const self = event.currentTarget;
        const st = states.get(self);
        if (!st?.compiled || !st.run || !st.graphKey) return;
        const tick = tickOf(self, st);
        if (tick.ctx.world.tryGet(self, ScriptGraphAgent)?.graph !== st.graphKey) return;
        // A reload can retire the previous prefab recipes between the frame and this event.
        const compiled = tick.resolveGraph?.(st.graphKey);
        if (!compiled) return;
        // The payload's `other` when it has one — physics names the contact's
        // partner there, and that is the entity a game reacts to.
        const data = event.data as { other?: number; payload?: unknown } | undefined;
        const other = Number(data?.other ?? 0);
        // The fields a node's payload pins read: the event's own, and those of its `payload` (a timeline marker's).
        const inner = data?.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : null;
        const fields = data && typeof data === 'object' ? { ...(data as Record<string, unknown>), ...inner } : undefined;
        fireScriptGraphEvent(compiled, st.run, tick, event.type, event.target as number, other, fields);
    };

    return {
        sync(): void {
            const wanted = new Set<string>();
            for (const st of states.values()) {
                if (!st.compiled) continue;
                for (const type of st.compiled.events.keys()) wanted.add(type);
            }
            for (const [type, off] of subscriptions) {
                if (!wanted.has(type)) { off(); subscriptions.delete(type); }
            }
            for (const type of wanted) {
                if (!subscriptions.has(type)) subscriptions.set(type, events.on(type, handle));
            }
        },
        dispose(): void {
            for (const off of subscriptions.values()) off();
            subscriptions.clear();
        },
    };
}

/** Resource for game code to reach an agent's variables and blackboard. */
export class ScriptGraphs {
    constructor(private states: Map<Entity, AgentState>) {}

    blackboard(entity: Entity): Blackboard {
        return agentGraphBlackboard(this.states, entity);
    }

    /** A graph variable's value, or null before the instance has started. */
    variable(entity: Entity, name: string): ScriptValue {
        return this.states.get(entity)?.run?.vars.get(name) ?? null;
    }

    /** Write a graph variable — how game code hands a running graph its input. */
    setVariable(entity: Entity, name: string, value: ScriptValue): void {
        this.states.get(entity)?.run?.vars.set(name, value);
    }

    /** Whether the instance spent its step budget and stopped. */
    halted(entity: Entity): boolean {
        return this.states.get(entity)?.run?.halted ?? false;
    }
}

export const AiScriptGraphs = defineResource<ScriptGraphs>(null!, 'AiScriptGraphs');

export class ScriptGraphPlugin implements Plugin {
    name = 'scriptGraph';

    build(app: App): void {
        ensureBuiltinAiRegistrations();
        ensureBuiltinScriptNodes();
        const states = new Map<Entity, AgentState>();
        app.world.onDespawn((entity: Entity) => states.delete(entity));
        app.insertResource(AiScriptGraphs, new ScriptGraphs(states));

        const world = app.world as unknown as ScriptGraphWorldView;
        const events = ensureEntityEvents(app);
        let commands_: CommandsInstance | null = null;
        let dt_ = 0;
        let input_: InputState = noInput();

        const onProblem = (entity: Entity, message: string): void => {
            log.warn('logic', `ScriptGraphAgent on entity ${entity as number}: ${message}`);
        };

        // An event arrives outside the system body, so the context it runs on is
        // built from the frame's last known commands and delta.
        const resolveGraph: GraphResolver = (ref, entity) => appRegistryAsset<CompiledScriptGraph>(app, 'scriptgraph', ref, entity);
        const sceneForSpawn: SpawnSceneResolver = entity => sceneContextForEntity(app, entity);
        const bridge = createEventBridge(events, states, (entity, st) => {
            const ctx = contextFor(world, commands_ as CommandsInstance, input_);
            return agentTick(ctx, entity, st, dt_, resolveGraph, onProblem, sceneForSpawn);
        });

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Time), Res(Input), Commands(), GetWorld()],
                (time: TimeData, input: InputState, commands: CommandsInstance, w) => {
                    commands_ = commands;
                    dt_ = time.delta;
                    input_ = input;
                    stepScriptGraphs(w as ScriptGraphWorldView, commands, time.delta, states, resolveGraph, onProblem, input, sceneForSpawn);
                    bridge.sync();
                },
                // Asked per analysis, not once: a graph loaded later changes the
                // answer, and no graph at all means this system touches only the
                // agent component.
                { name: 'ScriptGraphSystem', touches: () => scriptGraphTouches(app) },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const scriptGraphPlugin = new ScriptGraphPlugin();
