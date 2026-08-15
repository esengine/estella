// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the systems that run AUTHORED graphs tell the schedule.
 *
 *        Their reach is a property of the loaded data, not of the system, so the
 *        claims here are about a graph: which leaves it names, what those leaves
 *        declared, and what one undeclared leaf does to the whole answer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { aiRegistry } from '../src/ai/fsm/AiContext';
import { registerFsm, clearFsmStore, StateMachineAgent } from '../src/ai/fsm/StateMachineAgent';
import { registerBt, clearBtStore, BehaviorTreeAgent } from '../src/ai/bt/BehaviorTreeAgent';
import { fsmTouches } from '../src/ai/fsm/FsmPlugin';
import { btTouches } from '../src/ai/bt/BtPlugin';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import { TouchesBuilder } from '../src/ai/worldView';

const noop = (): void => { };

beforeEach(() => {
    clearFsmStore();
    clearBtStore();
    aiRegistry.clear();
    ensureBuiltinAiRegistrations();
});

describe('an FSM system, asked what it touches', () => {
    it('names only its own component when no graph is loaded', () => {
        expect(fsmTouches()).toEqual({ reads: [], writes: [StateMachineAgent._name] });
    });

    it('answers from the graph that is loaded, not from the registry', () => {
        // `spriteAnim.*` is registered either way; what puts SpriteAnimator in
        // the answer is a graph that names it.
        expect(fsmTouches().writes).not.toContain('SpriteAnimator');
        registerFsm('run', {
            initial: 'idle',
            states: [{ name: 'idle', onEnter: 'spriteAnim.play' }],
        });
        expect(fsmTouches().writes).toContain('SpriteAnimator');
    });

    it('includes what a transition condition reads', () => {
        registerFsm('cutscene', {
            initial: 'playing',
            states: [
                { name: 'playing', transitions: [{ to: 'done', condition: 'timeline.finished' }] },
                { name: 'done' },
            ],
        });
        expect(fsmTouches().reads).toContain('TimelinePlayer');
    });

    it('reads the component out of a property.set path', () => {
        registerFsm('fade', {
            initial: 'hit',
            states: [{
                name: 'hit',
                onEnter: { name: 'property.set', params: { path: 'UIVisual.color.a', value: '0.5' } },
            }],
        });
        expect(fsmTouches().writes).toContain('UIVisual');
        expect(fsmTouches().opaque).toBeUndefined();
    });

    it('reads it out of the canonical string form too', () => {
        registerFsm('fade', {
            initial: 'hit',
            states: [{ name: 'hit', onEnter: { name: 'property.set', arg: 'Sprite.color.r=1' } }],
        });
        expect(fsmTouches().writes).toContain('Sprite');
    });

    // The whole point of declaring: a union that quietly dropped the leaf it
    // could not read would be a claim the scheduler trusts and the frame breaks.
    it('goes opaque when one leaf never declared', () => {
        aiRegistry.registerAction('game.mystery', noop);
        registerFsm('mixed', {
            initial: 'a',
            states: [{ name: 'a', onEnter: 'spriteAnim.play', onUpdate: 'game.mystery' }],
        });
        const touches = fsmTouches();
        expect(touches.opaque).toBe(true);
        // Still says what it DOES know — a bad claim is not a reason to say nothing.
        expect(touches.writes).toContain('SpriteAnimator');
    });

    it('takes a declaring registration at its word', () => {
        aiRegistry.registerAction('game.hurt', { run: noop, touches: { writes: ['Health'] } });
        registerFsm('fight', { initial: 'a', states: [{ name: 'a', onEnter: 'game.hurt' }] });
        expect(fsmTouches()).toMatchObject({ writes: ['Health', StateMachineAgent._name] });
    });

    // A name nothing registered is a no-op at run time, so counting it as
    // unknown would make one typo hide the reach of an entire project.
    it('ignores a leaf no registration answers to', () => {
        registerFsm('typo', { initial: 'a', states: [{ name: 'a', onEnter: 'spriteAnim.paly' }] });
        expect(fsmTouches().opaque).toBeUndefined();
    });
});

describe('a behaviour-tree system, asked what it touches', () => {
    it('walks the whole tree, not just the root', () => {
        registerBt('patrol', {
            root: {
                type: 'sequence',
                children: [
                    { type: 'condition', name: 'timeline.finished' },
                    { type: 'action', name: 'spriteAnim.stop' },
                ],
            },
        });
        const touches = btTouches();
        expect(touches.reads).toContain('TimelinePlayer');
        expect(touches.writes).toContain('SpriteAnimator');
        expect(touches.writes).toContain(BehaviorTreeAgent._name);
    });

    // Orphans are authored-but-unwired subtrees; the interpreter ticks only
    // `root`, so counting them would claim reach the frame never has.
    it('leaves an unwired subtree out of the claim', () => {
        registerBt('wip', {
            root: { type: 'action', name: 'spriteAnim.stop' },
            orphans: [{ type: 'action', name: 'timeline.play' }],
        });
        expect(btTouches().writes).not.toContain('TimelinePlayer');
    });
});

describe('the builder that folds leaf claims', () => {
    it('is not opaque until something says it cannot say', () => {
        expect(new TouchesBuilder().reading('A').build()).toEqual({ reads: ['A'], writes: [] });
        expect(new TouchesBuilder().add(undefined).build().opaque).toBe(true);
        expect(new TouchesBuilder().add({ opaque: true }).build().opaque).toBe(true);
    });
});
