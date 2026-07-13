// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The FSM → Timeline drive channel: the built-in `timeline.play`/`timeline.pause`
 * actions and the `timeline.finished` condition, plus the full code-free cutscene
 * loop (enter state → clip plays → completion drives the transition → replay
 * rewinds). The timeline half runs the real drive functions each frame, mirroring
 * what TimelineSystem does per entity.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import type { CommandsInstance } from '../src/commands';
import { StateMachineAgent, registerFsm, clearFsmStore } from '../src/ai/fsm/StateMachineAgent';
import { aiRegistry, registerAction } from '../src/ai/fsm/AiContext';
import { stepStateMachines, agentBlackboard, type FsmWorldView } from '../src/ai/fsm/FsmPlugin';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import type { FsmDefinition } from '../src/ai/fsm/types';
import { TimelinePlayer } from '../src/timeline/TimelinePlugin';
import {
    advanceTimelineTS,
    createTimelineState,
    applyPlayerFlags,
    latchPlayerFinish,
    type TimelineState,
} from '../src/timeline/TimelineDrive';
import { WrapMode, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { SampleDeps } from '../src/timeline/TimelineEvaluator';

/** Minimal in-memory world satisfying what stepStateMachines calls. */
class FakeWorld implements FsmWorldView {
    private store = new Map<string, unknown>();
    private next = 1;
    private entities: Entity[] = [];

    spawn(fsm: string, withPlayer = true): Entity {
        const e = this.next++ as Entity;
        this.store.set(`${e}:StateMachineAgent`, StateMachineAgent.create({ fsm }));
        if (withPlayer) this.store.set(`${e}:TimelinePlayer`, TimelinePlayer.create({ timeline: 'cut.estimeline' }));
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

const bareAsset: TimelineAsset = {
    version: '1.1', type: 'timeline', duration: 1, wrapMode: WrapMode.Once, tracks: [],
};
const stubDeps: SampleDeps = {
    world: {} as SampleDeps['world'],
    getComponent: () => undefined,
    resolveChild: () => null,
};

/** One TimelineSystem tick for one entity (the same reconcile → advance → latch). */
function tickTimeline(world: FakeWorld, e: Entity, state: TimelineState, dt: number): void {
    const player = world.get(e, TimelinePlayer);
    const rewound = applyPlayerFlags(player, state);
    const fin = advanceTimelineTS(bareAsset, e, state, dt, { deps: stubDeps });
    if (latchPlayerFinish(player, state, fin) || rewound) world.set(e, TimelinePlayer, player);
}

beforeEach(() => {
    aiRegistry.clear();
    clearFsmStore();
    ensureBuiltinAiRegistrations();
});

describe('ensureBuiltinAiRegistrations', () => {
    it('registers the timeline names (visible to editor palettes)', () => {
        expect(aiRegistry.actionNames()).toEqual(expect.arrayContaining(['timeline.play', 'timeline.pause']));
        expect(aiRegistry.conditionNames()).toContain('timeline.finished');
    });

    it('is idempotent and never overwrites a game registration', () => {
        aiRegistry.clear();
        const game = (): void => { /* game's own override */ };
        registerAction('timeline.play', game);
        ensureBuiltinAiRegistrations();
        ensureBuiltinAiRegistrations();
        expect(aiRegistry.getAction('timeline.play')).toBe(game);
        expect(aiRegistry.hasAction('timeline.pause')).toBe(true);
    });
});

describe('built-in timeline actions/condition', () => {
    it('timeline.play raises the component flag; timeline.pause lowers it', () => {
        registerFsm('t', {
            initial: 'Play',
            states: [
                { name: 'Play', onEnter: 'timeline.play', transitions: [{ to: 'Pause', trigger: 'halt' }] },
                { name: 'Pause', onEnter: 'timeline.pause' },
            ],
        });
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('t');

        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, TimelinePlayer).playing).toBe(true);

        agentBlackboard(states, e).fire('halt');
        stepStateMachines(world, NO_COMMANDS, 0.1, states); // → Pause
        stepStateMachines(world, NO_COMMANDS, 0.1, states); // Pause onEnter
        expect(world.get(e, TimelinePlayer).playing).toBe(false);
    });

    it('both actions are no-ops without a TimelinePlayer', () => {
        registerFsm('t', { initial: 'S', states: [{ name: 'S', onEnter: 'timeline.play', onUpdate: 'timeline.pause' }] });
        const world = new FakeWorld();
        const e = world.spawn('t', /* withPlayer */ false);
        expect(() => stepStateMachines(world, NO_COMMANDS, 0.1, new Map())).not.toThrow();
        expect(world.has(e, TimelinePlayer)).toBe(false);
    });

    it('timeline.finished holds false until the latch is set', () => {
        registerFsm('t', {
            initial: 'Wait',
            states: [
                { name: 'Wait', transitions: [{ to: 'Done', condition: 'timeline.finished' }] },
                { name: 'Done' },
            ],
        });
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('t');

        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, StateMachineAgent).current).toBe('Wait');

        const player = world.get(e, TimelinePlayer);
        player.finished = true;
        world.set(e, TimelinePlayer, player);
        stepStateMachines(world, NO_COMMANDS, 0.1, states);
        expect(world.get(e, StateMachineAgent).current).toBe('Done');
    });
});

describe('code-free cutscene loop (FSM state ↔ timeline clip)', () => {
    const cutsceneFsm: FsmDefinition = {
        initial: 'Cutscene',
        states: [
            { name: 'Cutscene', onEnter: 'timeline.play', transitions: [{ to: 'Gameplay', condition: 'timeline.finished' }] },
            { name: 'Gameplay', transitions: [{ to: 'Cutscene', trigger: 'replay' }] },
        ],
    };

    it('plays the clip on enter, transitions on completion, and replays from the top', () => {
        registerFsm('cutscene', cutsceneFsm);
        const world = new FakeWorld();
        const states = new Map();
        const e = world.spawn('cutscene');
        const clock = createTimelineState(WrapMode.Once);

        const frame = (dt: number): void => {
            stepStateMachines(world, NO_COMMANDS, dt, states);
            tickTimeline(world, e, clock, dt);
        };

        frame(0.4); // enter Cutscene → play; clip at 0.4
        expect(world.get(e, TimelinePlayer).playing).toBe(true);
        expect(world.get(e, StateMachineAgent).current).toBe('Cutscene');

        frame(0.4); // clip at 0.8 — still going
        expect(world.get(e, StateMachineAgent).current).toBe('Cutscene');

        frame(0.4); // clip crosses 1.0 → finished latched
        expect(world.get(e, TimelinePlayer)).toMatchObject({ playing: false, finished: true });

        frame(0.4); // FSM sees timeline.finished → Gameplay
        expect(world.get(e, StateMachineAgent).current).toBe('Gameplay');

        agentBlackboard(states, e).fire('replay');
        frame(0.4); // → Cutscene (onEnter runs next tick)
        frame(0.4); // onEnter replays the finished clip: rewind + advance
        expect(world.get(e, TimelinePlayer)).toMatchObject({ playing: true, finished: false });
        expect(clock.time).toBeCloseTo(0.4, 5); // from the top, not the parked end
    });
});
