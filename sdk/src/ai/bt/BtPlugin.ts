// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    BtPlugin.ts
 * @brief   Ticks BehaviorTreeAgents against the shared runtime + registry.
 *
 * Per-entity blackboard + tree run-state live in a closure Map (the
 * `defineBehavior` pattern); the component stays serializable. Reuses the same
 * `aiRegistry` and `AiContext` as FSM, so a tree's leaves and an FSM's actions
 * are the same named-registry entries. `stepBehaviorTrees` is extracted to
 * unit-test against a fake world. Gated to play mode; runs before nav follow.
 */

import type { App, Plugin } from '../../app';
import type { Entity } from '../../types';
import type { World } from '../../world';
import { defineSystem, Schedule, GetWorld } from '../../system';
import { Res, Time, type TimeData } from '../../resource';
import { defineResource } from '../../resource';
import { Commands, type CommandsInstance } from '../../commands';
import { playModeOnly } from '../../env';
import type { AnyComponentDef, ComponentData } from '../../component';
import { Blackboard } from '../fsm/Blackboard';
import { aiRegistry, type AiContext } from '../fsm/AiContext';
import { tickBt, createBtRunState, type BtRunState } from './BtRunner';
import { BehaviorTreeAgent, getBt } from './BehaviorTreeAgent';

interface BtAgentState {
    bb: Blackboard;
    rs: BtRunState;
    btKey: string | null;
    status: string;
}

/** The slice of `World` the BT step needs — lets tests inject a fake. */
export interface AiWorldView {
    getEntitiesWithComponents(components: readonly AnyComponentDef[]): Entity[];
    get<C extends AnyComponentDef>(entity: Entity, component: C): ComponentData<C>;
    set<C extends AnyComponentDef>(entity: Entity, component: C, data: ComponentData<C>): void;
    has(entity: Entity, component: AnyComponentDef): boolean;
}

type MutableAiContext = { -readonly [K in keyof AiContext]: AiContext[K] };

/** Get (creating if needed) an agent's blackboard — lets game code seed data early. */
export function agentBtBlackboard(states: Map<Entity, BtAgentState>, entity: Entity): Blackboard {
    let st = states.get(entity);
    if (!st) {
        st = { bb: new Blackboard(), rs: createBtRunState(), btKey: null, status: '' };
        states.set(entity, st);
    }
    return st.bb;
}

/** Advance every BehaviorTreeAgent one tick. `states` carries per-entity runtime across frames. */
export function stepBehaviorTrees(
    world: AiWorldView,
    commands: CommandsInstance,
    dt: number,
    states: Map<Entity, BtAgentState>,
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

    for (const entity of world.getEntitiesWithComponents([BehaviorTreeAgent])) {
        const agent = world.get(entity, BehaviorTreeAgent);
        if (!agent.bt) continue;
        const def = getBt(agent.bt);
        if (!def) continue;

        let st = states.get(entity);
        if (!st) {
            st = { bb: new Blackboard(), rs: createBtRunState(), btKey: null, status: '' };
            states.set(entity, st);
        }
        // A changed tree resets the run-state (Running memory would be stale).
        if (st.btKey !== agent.bt) {
            st.rs = createBtRunState();
            st.btKey = agent.bt;
        }

        ctx.entity = entity;
        ctx.dt = dt;
        ctx.blackboard = st.bb;
        const status = tickBt(def, ctx, st.bb, aiRegistry, st.rs, dt);

        st.status = status;
        if (agent.status !== status) {
            agent.status = status;
            world.set(entity, BehaviorTreeAgent, agent);
        }
    }
}

/** Resource for game code to reach an agent's blackboard / last status. */
export class BehaviorTrees {
    constructor(private states: Map<Entity, BtAgentState>) {}

    blackboard(entity: Entity): Blackboard {
        return agentBtBlackboard(this.states, entity);
    }

    status(entity: Entity): string | null {
        return this.states.get(entity)?.status ?? null;
    }
}

export const AiBt = defineResource<BehaviorTrees>(null!, 'AiBt');

export class BtPlugin implements Plugin {
    name = 'bt';

    build(app: App): void {
        const states = new Map<Entity, BtAgentState>();
        app.world.onDespawn((entity: Entity) => states.delete(entity));
        app.insertResource(AiBt, new BehaviorTrees(states));

        app.addSystemToSchedule(
            Schedule.Update,
            defineSystem(
                [Res(Time), Commands(), GetWorld()],
                (time: TimeData, commands: CommandsInstance, world) => {
                    stepBehaviorTrees(world as AiWorldView, commands, time.delta, states);
                },
                { name: 'BehaviorTreeSystem' },
            ),
            { runIf: playModeOnly },
        );
    }
}

export const btPlugin = new BtPlugin();
