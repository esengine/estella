// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { CommandsInstance } from '../src/ecs/commands';
import { StateMachineAgent, registerFsm, clearFsmStore } from '../src/ai/fsm/StateMachineAgent';
import { aiRegistry, registerAction } from '../src/ai/fsm/AiContext';
import {
    stepStateMachines,
    agentBlackboard,
    StateMachines,
    type FsmWorldView,
} from '../src/ai/fsm/FsmPlugin';
import type { FsmDefinition } from '../src/ai/fsm/types';

/** Minimal in-memory world satisfying what stepStateMachines calls. */
class FakeWorld implements FsmWorldView {
    private store = new Map<string, unknown>();
    private next = 1;
    private entities: Entity[] = [];

    spawn(fsm: string): Entity {
        const e = this.next++ as Entity;
        this.store.set(`${e}:StateMachineAgent`, StateMachineAgent.create({ fsm }));
        this.entities.push(e);
        return e;
    }
    getEntitiesWithComponents(): Entity[] {
        return this.entities;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(entity: Entity, component: { _name: string }): any {
        return this.store.get(`${entity}:${component._name}`);
    }
    set(entity: Entity, component: { _name: string }, data: unknown): void {
        this.store.set(`${entity}:${component._name}`, data);
    }
    has(entity: Entity, component: { _name: string }): boolean {
        return this.store.has(`${entity}:${component._name}`);
    }
}

const NO_COMMANDS = {} as CommandsInstance;

const patrolChase: FsmDefinition = {
    initial: 'Patrol',
    states: [
        { name: 'Patrol', onUpdate: 'patrolMove', transitions: [{ to: 'Chase', guard: { key: 'seesPlayer', op: 'truthy' } }] },
        { name: 'Chase', onEnter: 'startChase', onUpdate: 'chaseMove', transitions: [{ to: 'Patrol', guard: { key: 'seesPlayer', op: 'falsy' } }] },
    ],
};

describe('stepStateMachines', () => {
    let log: string[];
    beforeEach(() => {
        aiRegistry.clear();
        clearFsmStore();
        log = [];
        for (const n of ['patrolMove', 'startChase', 'chaseMove']) {
            registerAction(n, ctx => log.push(`${n}:${ctx.entity}`));
        }
    });

    it('runs an agent FSM and writes the active state back to the component', () => {
        registerFsm('pc', patrolChase);
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('pc');

        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, StateMachineAgent).current).toBe('Patrol');
        expect(log).toEqual([`patrolMove:${e}`]);

        agentBlackboard(states, e).set('seesPlayer', true);
        stepStateMachines(world, NO_COMMANDS, 0.1, states); // → Chase
        expect(world.get(e, StateMachineAgent).current).toBe('Chase');

        stepStateMachines(world, NO_COMMANDS, 0.1, states); // Chase onEnter + onUpdate
        expect(log).toEqual([`patrolMove:${e}`, `startChase:${e}`, `chaseMove:${e}`]);

        agentBlackboard(states, e).set('seesPlayer', false);
        stepStateMachines(world, NO_COMMANDS, 0.1, states); // → Patrol
        expect(world.get(e, StateMachineAgent).current).toBe('Patrol');
    });

    it('is a no-op when the FSM key is unregistered', () => {
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('missing');
        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, StateMachineAgent).current).toBe(''); // untouched
    });

    it('exposes entity/get/has on the leaf context', () => {
        registerFsm('probe', {
            initial: 'S',
            states: [{ name: 'S', onUpdate: 'probe' }],
        });
        let seen: { entity: Entity; hasAgent: boolean; fsm: string } | null = null;
        registerAction('probe', ctx => {
            seen = {
                entity: ctx.entity,
                hasAgent: ctx.has(StateMachineAgent),
                fsm: ctx.get(StateMachineAgent).fsm,
            };
        });
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('probe');
        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(seen).toEqual({ entity: e, hasAgent: true, fsm: 'probe' });
    });
});

describe('StateMachines resource', () => {
    beforeEach(() => {
        aiRegistry.clear();
        clearFsmStore();
    });

    it('fires triggers that drive a transition and reports the current state', () => {
        registerFsm('gate', {
            initial: 'Closed',
            states: [
                { name: 'Closed', transitions: [{ to: 'Open', trigger: 'open' }] },
                { name: 'Open' },
            ],
        });
        const world = new FakeWorld();
        const states = new Map();
        const res = new StateMachines(states);
        const e = world.spawn('gate');

        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(res.state(e)).toBe('Closed');

        res.fire(e, 'open');
        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(res.state(e)).toBe('Open');
    });
});
