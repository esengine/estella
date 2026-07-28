// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { CommandsInstance } from '../src/ecs/commands';
import { BehaviorTreeAgent, registerBt, clearBtStore } from '../src/ai/bt/BehaviorTreeAgent';
import { aiRegistry, registerAction, registerCondition } from '../src/ai/fsm/AiContext';
import { stepBehaviorTrees, agentBtBlackboard, BehaviorTrees, type AiWorldView } from '../src/ai/bt/BtPlugin';
import { Status } from '../src/ai/status';
import type { BtDefinition } from '../src/ai/bt/types';

class FakeWorld implements AiWorldView {
    private store = new Map<string, unknown>();
    private next = 1;
    private entities: Entity[] = [];

    spawn(bt: string): Entity {
        const e = this.next++ as Entity;
        this.store.set(`${e}:BehaviorTreeAgent`, BehaviorTreeAgent.create({ bt }));
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

const patrolChaseTree: BtDefinition = {
    root: {
        type: 'selector',
        children: [
            { type: 'sequence', children: [{ type: 'condition', name: 'seesPlayer' }, { type: 'action', name: 'chase' }] },
            { type: 'action', name: 'patrol' },
        ],
    },
};

describe('stepBehaviorTrees', () => {
    let acted: string[];
    beforeEach(() => {
        aiRegistry.clear();
        clearBtStore();
        acted = [];
        registerCondition('seesPlayer', (_c, bb) => bb.get('seesPlayer') === true);
        registerAction('chase', () => { acted.push('chase'); return Status.Running; });
        registerAction('patrol', () => { acted.push('patrol'); return Status.Running; });
    });

    it('runs a tree, writes root status back, and switches branch off the blackboard', () => {
        registerBt('enemy', patrolChaseTree);
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('enemy');

        stepBehaviorTrees(world, NO_COMMANDS, 0.1, states);
        expect(acted).toEqual(['patrol']); // no player → patrol fallback
        expect(world.get(e, BehaviorTreeAgent).status).toBe(Status.Running);

        agentBtBlackboard(states, e).set('seesPlayer', true);
        acted = [];
        stepBehaviorTrees(world, NO_COMMANDS, 0.1, states);
        expect(acted).toEqual(['chase']); // sees player → chase branch
    });

    it('is a no-op when the tree key is unregistered', () => {
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('missing');
        stepBehaviorTrees(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, BehaviorTreeAgent).status).toBe(''); // untouched
    });

    it('exposes entity/get/has on the leaf context', () => {
        let seen: { entity: Entity; has: boolean; bt: string } | null = null;
        registerAction('probe', ctx => {
            seen = { entity: ctx.entity, has: ctx.has(BehaviorTreeAgent), bt: ctx.get(BehaviorTreeAgent).bt };
        });
        registerBt('probe', { root: { type: 'action', name: 'probe' } });
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('probe');
        stepBehaviorTrees(world, NO_COMMANDS, 0.1, states);
        expect(seen).toEqual({ entity: e, has: true, bt: 'probe' });
    });

    it('BehaviorTrees resource reports blackboard and last status', () => {
        registerBt('enemy', patrolChaseTree);
        const world = new FakeWorld();
        const states = new Map();
        const res = new BehaviorTrees(states);
        const e = world.spawn('enemy');
        stepBehaviorTrees(world, NO_COMMANDS, 0.1, states);
        expect(res.status(e)).toBe(Status.Running);
        res.blackboard(e).set('seesPlayer', true);
        expect(res.blackboard(e).get('seesPlayer')).toBe(true);
    });
});
