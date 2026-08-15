// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FsmPlugin.ts
 * @brief   Ticks StateMachineAgents against the shared runtime + registry.
 *
 * Per-entity run state + blackboard live in a closure Map (the `defineBehavior`
 * pattern), so the component stays serializable. The per-frame body is
 * `stepStateMachines`, extracted to unit-test against a fake world. Gated to
 * play mode; runs in `Update` before nav follow so an FSM action can retarget a
 * NavAgent the same frame.
 */

import type { App, Plugin } from '../../app/app';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { defineSystem, Schedule, GetWorld, type SystemTouches } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import { defineResource } from '../../ecs/resource';
import { Commands, type CommandsInstance } from '../../ecs/commands';
import { playModeOnly } from '../../ecs/env';
import type { AnyComponentDef, ComponentData } from '../../ecs/component';
import { Assets } from '../../asset/AssetPlugin';
import { resolveAssetKey } from '../../asset/resolveAssetKey';
import { Blackboard } from './Blackboard';
import { createFsmRunState, stepFsm, type CompiledFsm, type FsmRunState } from './FsmRunner';
import { aiRegistry, type AiContext } from './AiContext';
import { StateMachineAgent, getFsm, allFsms } from './StateMachineAgent';
import { actionRefName, actionRefArg, actionRefParams } from './types';
import { TouchesBuilder, touchesOfLeaves, type LeafRef } from '../worldView';
import { ensureBuiltinAiRegistrations } from '../builtins';

/** Per-entity FSM runtime: blackboard persists; run rebuilds when the FSM key changes. */
interface AgentState {
    bb: Blackboard;
    run: FsmRunState | null;
    fsmKey: string | null;
}

/** The slice of `World` the FSM step needs — lets tests inject a fake. */
export interface FsmWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): readonly Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    has(entity: Entity, component: AnyComponentDef): boolean;
}

type MutableAiContext = {
    -readonly [K in keyof AiContext]: AiContext[K];
};

/** Get (creating if needed) an agent's blackboard — lets game code seed data / fire triggers early. */
export function agentBlackboard(states: Map<Entity, AgentState>, entity: Entity): Blackboard {
    let st = states.get(entity);
    if (!st) {
        st = { bb: new Blackboard(), run: null, fsmKey: null };
        states.set(entity, st);
    }
    return st.bb;
}

/** Advance every StateMachineAgent one tick. `states` carries per-entity runtime across frames. */
export function stepStateMachines(
    world: FsmWorldView,
    commands: CommandsInstance,
    dt: number,
    states: Map<Entity, AgentState>,
    // A `.esfsm` asset registers under its resolved path (the realm's ref resolver
    // maps a plain/`@uuid:` ref to that key); the agent still holds the authored
    // ref, so resolve before lookup. Falls back to the raw ref for `registerFsm`
    // code names, which are keyed verbatim. Optional so tests need no realm.
    resolveKey?: (ref: string) => string,
): void {
    if (dt <= 0) return;

    const ctx: MutableAiContext = {
        entity: 0 as Entity,
        dt,
        blackboard: null as unknown as Blackboard,
        world: world as unknown as World,
        commands,
        get: c => world.get(ctx.entity, c),
        set: (c, d) => world.set(ctx.entity, c, d),
        has: c => world.has(ctx.entity, c),
    };

    for (const entity of world.getEntitiesWithComponents([StateMachineAgent])) {
        const agent = world.get(entity, StateMachineAgent);
        if (!agent.fsm) continue;
        const fsm = getFsm(resolveKey ? resolveKey(agent.fsm) : agent.fsm) ?? getFsm(agent.fsm);
        if (!fsm) continue;

        let st = states.get(entity);
        if (!st) {
            st = { bb: new Blackboard(), run: null, fsmKey: null };
            states.set(entity, st);
        }
        if (st.run === null || st.fsmKey !== agent.fsm) {
            st.run = createFsmRunState(fsm);
            st.fsmKey = agent.fsm;
        }

        ctx.entity = entity;
        ctx.dt = dt;
        ctx.blackboard = st.bb;
        stepFsm(fsm, st.run, ctx, st.bb, aiRegistry);

        if (agent.current !== st.run.current) {
            agent.current = st.run.current;
            world.set(entity, StateMachineAgent, agent);
        }
    }
}

/** Every leaf a compiled FSM names: the three state hooks and the transition
 *  conditions. Blackboard guards reach no component, so they are not leaves. */
export function* fsmLeaves(fsm: CompiledFsm): Iterable<LeafRef> {
    for (const state of fsm.states.values()) {
        for (const hook of [state.onEnter, state.onUpdate, state.onExit]) {
            const name = actionRefName(hook);
            if (!name) continue;
            yield {
                kind: 'action',
                name,
                input: { arg: actionRefArg(hook), params: actionRefParams(hook) },
            };
        }
        for (const t of state.transitions ?? []) {
            if (t.condition) yield { kind: 'condition', name: t.condition };
        }
    }
}

/** What the FSM system reaches for: the union over every loaded graph. */
export function fsmTouches(): SystemTouches {
    const builder = new TouchesBuilder().writing(StateMachineAgent._name);
    for (const fsm of allFsms()) touchesOfLeaves(aiRegistry, fsmLeaves(fsm), builder);
    return builder.build();
}

/** Resource for game code to reach an agent's blackboard / current state. */
export class StateMachines {
    constructor(private states: Map<Entity, AgentState>) {}

    blackboard(entity: Entity): Blackboard {
        return agentBlackboard(this.states, entity);
    }

    /** Fire a one-shot trigger consumed by the agent's next enabled transition. */
    fire(entity: Entity, trigger: string): void {
        agentBlackboard(this.states, entity).fire(trigger);
    }

    /** The agent's active state name, or null before its first tick. */
    state(entity: Entity): string | null {
        return this.states.get(entity)?.run?.current ?? null;
    }
}

export const AiFsm = defineResource<StateMachines>(null!, 'AiFsm');

export class FsmPlugin implements Plugin {
    name = 'fsm';

    build(app: App): void {
        ensureBuiltinAiRegistrations();
        const states = new Map<Entity, AgentState>();
        app.world.onDespawn((entity: Entity) => states.delete(entity));
        app.insertResource(AiFsm, new StateMachines(states));

        const resolveKey = (ref: string): string =>
            resolveAssetKey(app.hasResource(Assets) ? app.getResource(Assets) : null, ref);

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Time), Commands(), GetWorld()],
                (time: TimeData, commands: CommandsInstance, world) => {
                    stepStateMachines(world as FsmWorldView, commands, time.delta, states, resolveKey);
                },
                // Asked per analysis, not once: a graph loaded later changes the
                // answer, and no graph at all means this system touches only the
                // agent component.
                { name: 'StateMachineSystem', touches: fsmTouches },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const fsmPlugin = new FsmPlugin();
