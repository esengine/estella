// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The FSM → SpriteAnimator drive channel: the built-in `spriteAnim.*` actions
 * and `spriteAnim.finished` condition, the action-argument plumbing
 * (FsmActionRef / BtNode.arg → AiAction's third parameter), and the animator's
 * finished-latch flag contract (raising `playing` on a finished one-shot
 * replays from frame 0).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { aiRegistry, type AiContext } from '../src/ai/fsm/AiContext';
import { ensureBuiltinAiRegistrations } from '../src/ai/builtins';
import { compileFsm, createFsmRunState, stepFsm } from '../src/ai/fsm/FsmRunner';
import { Blackboard } from '../src/ai/fsm/Blackboard';
import { createBtRunState, tickBt } from '../src/ai/bt/BtRunner';
import type { BtDefinition } from '../src/ai/bt/types';
import type { FsmDefinition } from '../src/ai/fsm/types';
import {
    SpriteAnimator, SpriteAnimationApi, type SpriteAnimatorData, type SpriteAnimClip,
} from '../src/animation/SpriteAnimator';
import type { World } from '../src/world';

/** A one-entity AiContext over a plain component store. */
function makeCtx(components: Map<string, unknown>): AiContext {
    return {
        entity: 1 as never,
        dt: 1 / 60,
        blackboard: new Blackboard(),
        world: {} as never,
        commands: {} as never,
        get: (c: { _name: string }) => structuredClone(components.get(c._name)) as never,
        set: (c: { _name: string }, data: unknown) => void components.set(c._name, data),
        has: (c: { _name: string }) => components.has(c._name),
    } as AiContext;
}

function animator(over: Partial<SpriteAnimatorData> = {}): SpriteAnimatorData {
    return SpriteAnimator.create(over) as SpriteAnimatorData;
}

const sp = (m: Map<string, unknown>) => m.get('SpriteAnimator') as SpriteAnimatorData;

beforeEach(() => {
    aiRegistry.clear();
    ensureBuiltinAiRegistrations();
});

describe('spriteAnim builtins', () => {
    it('play with an arg switches the clip and rewinds', () => {
        const comps = new Map<string, unknown>([
            ['SpriteAnimator', animator({ clip: 'idle.esanim', currentFrame: 3, frameTimer: 0.05, playing: true })],
        ]);
        aiRegistry.getAction('spriteAnim.play')!(makeCtx(comps), new Blackboard(), 'run.esanim');
        expect(sp(comps).clip).toBe('run.esanim');
        expect(sp(comps).currentFrame).toBe(0);
        expect(sp(comps).playing).toBe(true);
    });

    it('play without an arg resumes without rewinding, and is a no-op while playing', () => {
        const comps = new Map<string, unknown>([
            ['SpriteAnimator', animator({ clip: 'idle.esanim', currentFrame: 3, playing: false })],
        ]);
        aiRegistry.getAction('spriteAnim.play')!(makeCtx(comps), new Blackboard());
        expect(sp(comps).playing).toBe(true);
        expect(sp(comps).currentFrame).toBe(3);
    });

    it('restart rewinds even mid-flight', () => {
        const comps = new Map<string, unknown>([
            ['SpriteAnimator', animator({ clip: 'attack.esanim', currentFrame: 2, playing: true })],
        ]);
        aiRegistry.getAction('spriteAnim.restart')!(makeCtx(comps), new Blackboard());
        expect(sp(comps).currentFrame).toBe(0);
        expect(sp(comps).playing).toBe(true);
    });

    it('finished is latched only after a one-shot completes', () => {
        const comps = new Map<string, unknown>([
            ['SpriteAnimator', animator({ clip: 'attack.esanim', playing: true })],
        ]);
        const cond = aiRegistry.getCondition('spriteAnim.finished')!;
        expect(cond(makeCtx(comps), new Blackboard())).toBe(false);
        comps.set('SpriteAnimator', animator({ clip: 'attack.esanim', playing: false, finished: true, currentFrame: 1 }));
        expect(cond(makeCtx(comps), new Blackboard())).toBe(true);
    });
});

describe('action argument plumbing', () => {
    it('FSM hooks pass FsmActionRef.arg to the action', () => {
        const seen: (string | undefined)[] = [];
        aiRegistry.registerAction('capture', (_ctx, _bb, arg) => void seen.push(arg));
        const def: FsmDefinition = {
            initial: 'a',
            states: [{ name: 'a', onEnter: { name: 'capture', arg: 'hello' }, onUpdate: 'capture' }],
        };
        const ctx = makeCtx(new Map());
        const compiled = compileFsm(def);
        const run = createFsmRunState(compiled);
        stepFsm(compiled, run, ctx, new Blackboard(), aiRegistry);
        expect(seen).toEqual(['hello', undefined]);
    });

    it('BT action leaves pass node.arg', () => {
        let seen: string | undefined;
        aiRegistry.registerAction('capture', (_ctx, _bb, arg) => void (seen = arg));
        const def: BtDefinition = { root: { type: 'action', name: 'capture', arg: 'clips/run.esanim' } };
        tickBt(def, makeCtx(new Map()), new Blackboard(), aiRegistry, createBtRunState(), 1 / 60);
        expect(seen).toBe('clips/run.esanim');
    });
});

describe('finished-latch flag contract (system side)', () => {
    /** Minimal World for SpriteAnimationApi.update: one entity, two components.
     *  `get` returns the live object (the real World's semantic — frame-timer
     *  accrual persists between ticks without an insert). */
    function makeWorld(comps: Map<string, unknown>): World {
        return {
            getEntitiesWithComponents: () => [1],
            get: (_e: number, c: { _name: string }) => comps.get(c._name),
            has: (_e: number, c: { _name: string }) => comps.has(c._name),
            insert: (_e: number, c: { _name: string }, data: unknown) => void comps.set(c._name, data),
        } as unknown as World;
    }

    const clip: SpriteAnimClip = {
        name: 'attack.esanim', fps: 10, loop: false,
        frames: [{ texture: 1 }, { texture: 2 }],
    };

    it('one-shot completion latches finished; raising playing replays from frame 0', () => {
        const api = new SpriteAnimationApi();
        api.registerClip(clip);
        const comps = new Map<string, unknown>([
            ['SpriteAnimator', animator({ clip: 'attack.esanim', loop: false, playing: true })],
        ]);
        const world = makeWorld(comps);
        // 2 frames at 10fps = 0.2s; overshoot to complete.
        for (let i = 0; i < 5; i++) api.update(world, 0.06);
        expect(sp(comps).playing).toBe(false);
        expect(sp(comps).finished).toBe(true);
        expect(sp(comps).currentFrame).toBe(1);

        // The FSM raises the flag (replay) — the system rewinds and clears the latch.
        aiRegistry.getAction('spriteAnim.play')!(makeCtx(comps), new Blackboard());
        api.update(world, 0.01);
        expect(sp(comps).finished).toBe(false);
        expect(sp(comps).currentFrame).toBe(0);
        expect(sp(comps).playing).toBe(true);
    });
});
