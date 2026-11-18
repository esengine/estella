// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a combo chains only inside the window the clip declares for it, and
 * a buffered press is remembered for its buffer and no longer - one made a little
 * early still chains, one made long before does not fire an attack nobody asked for.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, evaluateAnimatorTransitions,
    type AnimatorData, type AnimatorControllerDef,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { WrapMode, TrackType, type TimelineAsset } from '../src/timeline/TimelineTypes';
import type { Entity } from '../src/types';

const E = 1 as Entity;

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
        update(e: number, c: unknown, edit: (d: any) => void) { const d = mapOf(c).get(e); edit(d); mapOf(c).set(e, d); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** A one-second swing whose combo window is [0.5, 0.8). */
const swing: TimelineAsset = {
    version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Once,
    tracks: [{ type: TrackType.CustomEvent, name: 'beats', childPath: '',
        events: [{ time: 0.5, duration: 0.3, name: 'combo', payload: {} }] }],
} as TimelineAsset;

/** Idle -> Attack1 on `attack`; Attack1 -> Attack2 on `attack` inside `combo`; each swing back to Idle when done. */
function fighter(buffer?: number) {
    const timeline = new TimelineAPI();
    timeline.registerAsset('swing.estimeline', swing);
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    const def: AnimatorControllerDef = {
        parameters: [{ name: 'attack', type: 'trigger', ...(buffer !== undefined ? { buffer } : {}) }],
        initialState: 'Idle',
        states: [
            { name: 'Idle', motion: null as never, transitions: [{ to: 'Attack1', conditions: [{ param: 'attack', op: 'trigger' }] }] },
            {
                name: 'Attack1', motion: { kind: TIMELINE_MOTION, clip: 'swing.estimeline', loop: false },
                transitions: [
                    { to: 'Attack2', conditions: [{ param: 'attack', op: 'trigger' }, { param: 'combo', op: 'window' }] },
                    { to: 'Idle', conditions: [], hasExitTime: true },
                ],
            },
            {
                name: 'Attack2', motion: { kind: TIMELINE_MOTION, clip: 'swing.estimeline', loop: false },
                transitions: [{ to: 'Idle', conditions: [], hasExitTime: true }],
            },
        ],
    };
    ctrl.registerController('fighter', def);
    const world = makeWorld();
    world.insert(E, Animator, { controller: 'fighter', currentState: '', enabled: true } as AnimatorData);
    const state = () => (world.get(E, Animator) as AnimatorData).currentState;
    /** Step `seconds` in frames of 1/60. */
    const run = (seconds: number) => { for (let i = 0; i < Math.round(seconds * 60); i++) ctrl.update(world, 1 / 60); };
    ctrl.update(world, 0);
    return { ctrl, world, state, run };
}

describe('a combo window', () => {
    it('chains the next attack when it is pressed inside the window', () => {
        const f = fighter(0.2);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.1);
        expect(f.state()).toBe('Attack1');
        f.run(0.5);                              // 0.6s into the swing: the window is open
        f.ctrl.setTrigger(E, 'attack');
        f.run(1 / 60);
        expect(f.state()).toBe('Attack2');
    });

    it('does not chain outside it: a press before it opens waits, one after it shuts is too late', () => {
        const late = fighter(0.2);
        late.ctrl.setTrigger(E, 'attack');
        late.run(0.85);                          // past the window, before the swing ends
        late.ctrl.setTrigger(E, 'attack');
        late.run(0.1);
        expect(late.state()).toBe('Attack1');
    });

    it('takes a press made a little before the window opens, when it is within its buffer', () => {
        const f = fighter(0.2);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.4);                              // 0.1s before the window
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.15);                             // the window opens at 0.5
        expect(f.state()).toBe('Attack2');
    });

    it('drops a press made longer before than its buffer', () => {
        const f = fighter(0.2);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.1);
        f.ctrl.setTrigger(E, 'attack');          // 0.4s before the window
        f.run(0.6);
        expect(f.state()).toBe('Attack1');
    });

    it('does not let a dropped press start an attack once the swing is over', () => {
        const f = fighter(0.2);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.1);
        f.ctrl.setTrigger(E, 'attack');          // mashed during the windup
        f.run(1.2);                              // the swing ends, back to Idle
        expect(f.state()).toBe('Idle');
        f.run(0.2);
        expect(f.state()).toBe('Idle');
    });

    it('without a buffer keeps a trigger until something uses it, as before', () => {
        const f = fighter();
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.1);
        f.ctrl.setTrigger(E, 'attack');          // long before the window
        f.run(0.5);
        expect(f.state()).toBe('Attack2');      // taken the frame the window opened
    });

    it('with a buffer of 0 is asked on the next update only', () => {
        const f = fighter(0);
        f.ctrl.setTrigger(E, 'attack');
        f.run(1 / 60);
        expect(f.state()).toBe('Attack1');
        f.run(0.2);
        f.ctrl.setTrigger(E, 'attack');          // not in the window: gone after one frame
        f.run(0.5);
        expect(f.state()).toBe('Attack1');
    });

    it('restarts its buffer when pressed again', () => {
        const f = fighter(0.2);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.1);
        f.ctrl.setTrigger(E, 'attack');
        f.run(0.15);
        f.ctrl.setTrigger(E, 'attack');          // pressed again at 0.25: buffered to 0.45
        f.run(0.15);
        f.ctrl.setTrigger(E, 'attack');          // and at 0.4: to 0.6, past the opening
        f.run(0.15);
        expect(f.state()).toBe('Attack2');
    });
});

describe('the window condition, evaluated alone', () => {
    const scope = {
        initialState: 'A', parameters: [{ name: 'go', type: 'trigger' as const }],
        states: [{ name: 'A', motion: null as never, transitions: [{ to: 'B', conditions: [
            { param: 'go', op: 'trigger' as const }, { param: 'combo', op: 'window' as const }] }] },
        { name: 'B', motion: null as never, transitions: [] }],
    };

    it('holds only while the named window is open', () => {
        expect(evaluateAnimatorTransitions(scope, 'A', {}, new Set(['go']), true, new Set()).next).toBeNull();
        expect(evaluateAnimatorTransitions(scope, 'A', {}, new Set(['go']), true, new Set(['other'])).next).toBeNull();
        expect(evaluateAnimatorTransitions(scope, 'A', {}, new Set(['go']), true, new Set(['combo'])).next).toBe('B');
    });

    it('is false where no windows are given at all', () => {
        expect(evaluateAnimatorTransitions(scope, 'A', {}, new Set(['go'])).next).toBeNull();
    });
});
