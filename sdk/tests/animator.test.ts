// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import {
    Animator,
    AnimatorControllerApi,
    evaluateAnimatorTransitions,
    resolveParams,
    type AnimatorControllerDef,
    type AnimatorData,
} from '../src/animation/Animator';
import { SpriteAnimator, type SpriteAnimatorData } from '../src/animation/SpriteAnimator';

function heroController(): AnimatorControllerDef {
    return {
        parameters: [
            { name: 'speed', type: 'float', default: 0 },
            { name: 'grounded', type: 'bool', default: true },
            { name: 'jump', type: 'trigger' },
        ],
        initialState: 'idle',
        states: [
            { name: 'idle', clip: 'idle_clip', transitions: [
                { to: 'run', conditions: [{ param: 'speed', op: 'gt', value: 0.1 }] },
            ] },
            { name: 'run', clip: 'run_clip', speed: 1.5, loop: true, transitions: [
                { to: 'idle', conditions: [{ param: 'speed', op: 'lt', value: 0.1 }] },
            ] },
            { name: 'jump', clip: 'jump_clip', transitions: [
                { to: 'idle', conditions: [{ param: 'grounded', op: 'true' }] },
            ] },
        ],
        anyStateTransitions: [
            { to: 'jump', conditions: [{ param: 'jump', op: 'trigger' }] },
        ],
    };
}

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

describe('evaluateAnimatorTransitions', () => {
    const def = heroController();

    it('fires a float-gt transition', () => {
        const r = evaluateAnimatorTransitions(def, 'idle', { speed: 5, grounded: true }, new Set());
        expect(r.next).toBe('run');
        expect(r.consumedTriggers).toEqual([]);
    });

    it('stays when no condition holds', () => {
        expect(evaluateAnimatorTransitions(def, 'idle', { speed: 0 }, new Set()).next).toBeNull();
    });

    it('fires the reverse float-lt transition', () => {
        expect(evaluateAnimatorTransitions(def, 'run', { speed: 0 }, new Set()).next).toBe('idle');
    });

    it('checks bool true/false', () => {
        expect(evaluateAnimatorTransitions(def, 'jump', { grounded: true }, new Set()).next).toBe('idle');
        expect(evaluateAnimatorTransitions(def, 'jump', { grounded: false }, new Set()).next).toBeNull();
    });

    it('any-state transition takes precedence over the current state', () => {
        // speed=5 would fire idle->run, but the any-state jump trigger wins.
        const r = evaluateAnimatorTransitions(def, 'idle', { speed: 5 }, new Set(['jump']));
        expect(r.next).toBe('jump');
        expect(r.consumedTriggers).toEqual(['jump']);
    });

    it('fires a trigger transition and reports it consumed', () => {
        const r = evaluateAnimatorTransitions(def, 'idle', { speed: 0 }, new Set(['jump']));
        expect(r.next).toBe('jump');
        expect(r.consumedTriggers).toEqual(['jump']);
    });

    it('eq / neq comparisons', () => {
        const d: AnimatorControllerDef = {
            parameters: [{ name: 'phase', type: 'float', default: 0 }],
            initialState: 'a',
            states: [
                { name: 'a', clip: 'a', transitions: [{ to: 'b', conditions: [{ param: 'phase', op: 'eq', value: 2 }] }] },
                { name: 'b', clip: 'b', transitions: [{ to: 'a', conditions: [{ param: 'phase', op: 'neq', value: 2 }] }] },
            ],
        };
        expect(evaluateAnimatorTransitions(d, 'a', { phase: 2 }, new Set()).next).toBe('b');
        expect(evaluateAnimatorTransitions(d, 'a', { phase: 1 }, new Set()).next).toBeNull();
        expect(evaluateAnimatorTransitions(d, 'b', { phase: 1 }, new Set()).next).toBe('a');
    });
});

describe('resolveParams', () => {
    const def = heroController();
    it('seeds declared defaults, excludes triggers', () => {
        expect(resolveParams(def, new Map())).toEqual({ speed: 0, grounded: true });
    });
    it('applies per-entity overrides', () => {
        expect(resolveParams(def, new Map<string, number | boolean>([['speed', 9]]))).toEqual({ speed: 9, grounded: true });
    });
});

// ---------------------------------------------------------------------------
// AnimatorControllerApi.update drives SpriteAnimator (mock World)
// ---------------------------------------------------------------------------

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, data: unknown) { mapOf(c).set(e, data); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter((e) => rest.every((c) => mapOf(c).has(e)));
        },
    } as any;
}

function spriteData(over: Partial<SpriteAnimatorData> = {}): SpriteAnimatorData {
    return { clip: '', speed: 1, playing: false, loop: true, enabled: true, currentFrame: 5, frameTimer: 0.3, ...over };
}

describe('AnimatorControllerApi.update', () => {
    const E = 1;

    function setup() {
        const ctrl = new AnimatorControllerApi();
        ctrl.registerController('hero', heroController());
        const world = makeWorld();
        world.insert(E, Animator, { controller: 'hero', currentState: '', enabled: true } as AnimatorData);
        world.insert(E, SpriteAnimator, spriteData());
        return { ctrl, world };
    }

    it('seeds the initial state and applies its clip on first update', () => {
        const { ctrl, world } = setup();
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('idle');
        const sp = world.get(E, SpriteAnimator) as SpriteAnimatorData;
        expect(sp.clip).toBe('idle_clip');
        expect(sp.currentFrame).toBe(0);
        expect(sp.frameTimer).toBe(0);
        expect(sp.playing).toBe(true);
    });

    it('transitions on a float parameter and switches the clip (with state speed/loop)', () => {
        const { ctrl, world } = setup();
        ctrl.update(world); // → idle
        ctrl.setFloat(E, 'speed', 5);
        ctrl.update(world); // → run
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('run');
        const sp = world.get(E, SpriteAnimator) as SpriteAnimatorData;
        expect(sp.clip).toBe('run_clip');
        expect(sp.speed).toBe(1.5);
    });

    it('transitions back when the parameter reverses', () => {
        const { ctrl, world } = setup();
        ctrl.update(world);
        ctrl.setFloat(E, 'speed', 5); ctrl.update(world);
        ctrl.setFloat(E, 'speed', 0); ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('idle');
    });

    it('any-state trigger jumps, consumes the trigger, then returns', () => {
        const { ctrl, world } = setup();
        ctrl.update(world); // idle
        ctrl.setTrigger(E, 'jump');
        ctrl.update(world); // → jump (trigger consumed)
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('jump');
        // grounded defaults true → next update returns to idle, and the trigger
        // was consumed so it does not re-fire.
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('idle');
    });

    it('disabled animator does not change state', () => {
        const { ctrl, world } = setup();
        world.insert(E, Animator, { controller: 'hero', currentState: 'run', enabled: false } as AnimatorData);
        ctrl.setFloat(E, 'speed', 0);
        ctrl.update(world);
        expect((world.get(E, Animator) as AnimatorData).currentState).toBe('run');
    });

    it('removeEntity drops parameter state', () => {
        const { ctrl } = setup();
        ctrl.setFloat(E, 'speed', 9);
        expect(ctrl.getFloat(E, 'speed')).toBe(9);
        ctrl.removeEntity(E);
        expect(ctrl.getFloat(E, 'speed')).toBe(0);
    });
});
