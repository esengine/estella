// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a clip can say what happened, and the animator says it once, on the
 * step that CROSSED it — never twice on a loop, never from a fading motion.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI,
    type AnimatorData, type AnimatorControllerDef, type AnimatorEventPayload,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { playheadRuns, collectCustomEvents } from '../src/timeline/timelineEvents';
import { defineComponent } from '../src/ecs/component';
import {
    WrapMode, TrackType, InterpType, type TimelineAsset,
} from '../src/timeline/TimelineTypes';

const E = 1;

/** Registry is per context and reset between tests, so this is taken per call. */
const probeDef = () => defineComponent('EventProbe', { x: 0 });

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
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            if (d === undefined) throw new Error('update: entity does not carry it');
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

/** A clip holding the probe at `value`, carrying the events it is given. */
function clipWith(
    value: number, events: { time: number; name: string; payload?: Record<string, unknown> }[],
    duration = 1, wrapMode: WrapMode = WrapMode.Loop,
): TimelineAsset {
    return {
        version: '1.2', type: 'timeline', duration, wrapMode,
        tracks: [
            {
                type: TrackType.Property, component: 'EventProbe', childPath: '',
                name: 'probe', channels: [{
                    property: 'x',
                    keyframes: [{
                        time: 0, value, inTangent: 0, outTangent: 0,
                        interpolation: InterpType.Linear,
                    }],
                }],
            },
            {
                type: TrackType.CustomEvent, name: 'events', childPath: '',
                events: events.map(e => ({ time: e.time, name: e.name, payload: e.payload ?? {} })),
            },
        ],
    } as TimelineAsset;
}

/** The events an animator posted, in order. */
function sink(): { got: AnimatorEventPayload[]; send(e: AnimatorEventPayload): void } {
    const got: AnimatorEventPayload[] = [];
    return { got, send(e) { got.push({ ...e }); } };
}

function controllerOver(clips: Record<string, TimelineAsset>): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    for (const [name, asset] of Object.entries(clips)) timeline.registerAsset(name, asset);
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    return ctrl;
}

function seed(world: any, controller: string): void {
    world.insert(E, Animator, { controller, currentState: '', enabled: true } as AnimatorData);
    world.insert(E, probeDef(), { x: 0 });
}

const oneState = (clip: string, loop = true): AnimatorControllerDef => ({
    parameters: [],
    initialState: 'Play',
    states: [{ name: 'Play', motion: { kind: TIMELINE_MOTION, clip, loop }, transitions: [] }],
});

// =============================================================================
// The window, on its own
// =============================================================================

describe('the stretch of clip a step covered', () => {
    it('is the interval, not the instant a step happened to land on', () => {
        // 0.20 → 0.25 contains 0.23; no step ever lands on 0.23 itself.
        const runs = playheadRuns(0.20, 0.25, 1, WrapMode.Loop, false);
        expect(runs).toEqual([{ from: 0.20, to: 0.25, inclusiveStart: false }]);
    });

    it('splits at a loop seam rather than reading the wrap as a rewind', () => {
        const runs = playheadRuns(0.95, 1.05, 1, WrapMode.Loop, false);
        expect(runs.length).toBe(2);
        expect(runs[0]).toEqual({ from: 0.95, to: 1, inclusiveStart: false });
        // The head of the clip is a NEW lap, so an event authored at 0 is in it.
        expect(runs[1].from).toBe(0);
        expect(runs[1].to).toBeCloseTo(0.05, 12);
        expect(runs[1].inclusiveStart).toBe(true);
    });

    it('opens a lap that a step begins exactly on', () => {
        const runs = playheadRuns(2, 2.1, 1, WrapMode.Loop, false);
        expect(runs.length).toBe(1);
        expect(runs[0].from).toBe(0);
        expect(runs[0].to).toBeCloseTo(0.1, 12);
        expect(runs[0].inclusiveStart).toBe(true);
    });

    it('closes the frame a state was entered on, which is the only zero-length one', () => {
        expect(playheadRuns(0, 0, 1, WrapMode.Loop, true))
            .toEqual([{ from: 0, to: 0, inclusiveStart: true }]);
        expect(playheadRuns(0, 0, 1, WrapMode.Loop, false))
            .toEqual([{ from: 0, to: 0, inclusiveStart: false }]);
    });

    it('covers a whole pass once however long the step was', () => {
        expect(playheadRuns(0, 7.5, 1, WrapMode.Loop, false))
            .toEqual([{ from: 0, to: 1, inclusiveStart: true }]);
    });

    it('stops at the end of a clip that does not repeat', () => {
        expect(playheadRuns(0.9, 3, 1, WrapMode.Once, false))
            .toEqual([{ from: 0.9, to: 1, inclusiveStart: false }]);
        // And says nothing more once it is parked there.
        expect(playheadRuns(3, 4, 1, WrapMode.Once, false))
            .toEqual([{ from: 1, to: 1, inclusiveStart: false }]);
    });

    it('turns around with a ping-pong clip, so a pass back crosses the same events', () => {
        const runs = playheadRuns(0.9, 1.2, 1, WrapMode.PingPong, false);
        expect(runs).toEqual([
            { from: 0.9, to: 1, inclusiveStart: false },
            { from: 1, to: 0.8, inclusiveStart: false },
        ]);
    });
});

describe('which events a window crossed', () => {
    const asset = clipWith(1, [
        { time: 0.23, name: 'swing' },
        { time: 0.31, name: 'hit' },
        { time: 0.58, name: 'recover' },
    ]);

    it('reports several in one step, in the order the clip declares them', () => {
        const out: { name: string }[] = [];
        collectCustomEvents(asset, playheadRuns(0.20, 0.40, 1, WrapMode.Loop, false), out as never);
        expect(out.map(e => e.name)).toEqual(['swing', 'hit']);
    });

    it('reports none for a window that crossed nothing', () => {
        const out: { name: string }[] = [];
        collectCustomEvents(asset, playheadRuns(0.35, 0.40, 1, WrapMode.Loop, false), out as never);
        expect(out).toEqual([]);
    });
});

// =============================================================================
// Through the animator
// =============================================================================

describe('an animator over a clip that declares events', () => {
    it('fires each one exactly once on the way past', () => {
        const world = makeWorld();
        const ctrl = controllerOver({
            'attack.estimeline': clipWith(1, [
                { time: 0, name: 'start' },
                { time: 0.23, name: 'swing' },
                { time: 0.31, name: 'hit' },
                { time: 0.58, name: 'recover' },
            ], 1, WrapMode.Once),
        });
        ctrl.registerController('a', oneState('attack.estimeline', false));
        seed(world, 'a');

        const events = sink();
        for (let i = 0; i < 40; i++) ctrl.update(world, 0.05, events);

        expect(events.got.map(e => e.name)).toEqual(['start', 'swing', 'hit', 'recover']);
    });

    it('carries the payload the clip authored', () => {
        const world = makeWorld();
        const ctrl = controllerOver({
            'attack.estimeline': clipWith(1, [
                { time: 0.2, name: 'hit', payload: { value: 12, text: 'blade' } },
            ], 1, WrapMode.Once),
        });
        ctrl.registerController('a', oneState('attack.estimeline', false));
        seed(world, 'a');

        const events = sink();
        for (let i = 0; i < 10; i++) ctrl.update(world, 0.05, events);
        expect(events.got).toEqual([{ entity: E, name: 'hit', value: 12, text: 'blade' }]);
    });

    it('fires once per lap of a looping clip, including at the boundary', () => {
        const world = makeWorld();
        const ctrl = controllerOver({
            'walk.estimeline': clipWith(1, [
                { time: 0, name: 'left' },
                { time: 0.5, name: 'right' },
            ]),
        });
        ctrl.registerController('w', oneState('walk.estimeline'));
        seed(world, 'w');

        const events = sink();
        // Ten laps at a step that never lands on either event.
        for (let i = 0; i < 1000; i++) ctrl.update(world, 0.01, events);

        const left = events.got.filter(e => e.name === 'left').length;
        const right = events.got.filter(e => e.name === 'right').length;
        // The first `left` is the frame the state was entered on, then one a lap.
        expect(left).toBe(10);
        expect(right).toBe(10);
        // And they alternate: a seam handler that fired the head of the lap early
        // would report two lefts in a row.
        expect(events.got.map(e => e.name).slice(0, 4))
            .toEqual(['left', 'right', 'left', 'right']);
    });

    it('says nothing when nobody is listening, and still plays', () => {
        const world = makeWorld();
        const ctrl = controllerOver({ 'walk.estimeline': clipWith(7, [{ time: 0.2, name: 'x' }]) });
        ctrl.registerController('w', oneState('walk.estimeline'));
        seed(world, 'w');
        for (let i = 0; i < 10; i++) ctrl.update(world, 0.05);
        expect((world.get(E, probeDef()) as { x: number }).x).toBe(7);
    });
});

describe('a crossfade decides whose events those are', () => {
    /** Idle → Attack on a trigger, blending over `fade` seconds. */
    const graph = (fade: number): AnimatorControllerDef => ({
        parameters: [{ name: 'go', type: 'trigger' }],
        initialState: 'Idle',
        states: [
            {
                name: 'Idle',
                motion: { kind: TIMELINE_MOTION, clip: 'idle.estimeline', loop: true },
                transitions: [{
                    to: 'Attack', conditions: [{ param: 'go', op: 'trigger' }], duration: fade,
                }],
            },
            {
                name: 'Attack',
                motion: { kind: TIMELINE_MOTION, clip: 'attack.estimeline', loop: false },
                transitions: [],
            },
        ],
    });

    function run(fade: number): AnimatorEventPayload[] {
        const world = makeWorld();
        const ctrl = controllerOver({
            // Idle keeps declaring events all the way through the fade.
            'idle.estimeline': clipWith(1, [
                { time: 0.1, name: 'idle-tick' }, { time: 0.3, name: 'idle-tick' },
                { time: 0.5, name: 'idle-tick' }, { time: 0.7, name: 'idle-tick' },
                { time: 0.9, name: 'idle-tick' },
            ]),
            'attack.estimeline': clipWith(2, [
                { time: 0, name: 'attack-start' }, { time: 0.2, name: 'attack-hit' },
            ], 1, WrapMode.Once),
        });
        ctrl.registerController('g', graph(fade));
        seed(world, 'g');

        const events = sink();
        for (let i = 0; i < 10; i++) ctrl.update(world, 0.05, events);
        events.got.length = 0;
        ctrl.setTrigger(E, 'go');
        for (let i = 0; i < 10; i++) ctrl.update(world, 0.05, events);
        return events.got;
    }

    it('gives them to the state being entered, from its own first frame', () => {
        expect(run(0.3).map(e => e.name)).toEqual(['attack-start', 'attack-hit']);
    });

    it('and the answer does not depend on how long the blend is', () => {
        expect(run(0).map(e => e.name)).toEqual(run(0.3).map(e => e.name));
    });
});

describe('a 1D blend', () => {
    it('reports the events of the stop it is playing, and only those', () => {
        const world = makeWorld();
        const ctrl = controllerOver({
            'walk.estimeline': clipWith(1, [{ time: 0.4, name: 'walk-step' }]),
            'run.estimeline': clipWith(2, [{ time: 0.4, name: 'run-step' }]),
        });
        ctrl.registerController('b', {
            parameters: [{ name: 'speed', type: 'float', default: 0 }],
            initialState: 'Loco',
            states: [{
                name: 'Loco',
                motion: {
                    kind: 'blend1d', parameter: 'speed',
                    thresholds: [
                        { value: 0, motion: { kind: TIMELINE_MOTION, clip: 'walk.estimeline', loop: true } },
                        { value: 5, motion: { kind: TIMELINE_MOTION, clip: 'run.estimeline', loop: true } },
                    ],
                },
                transitions: [],
            }],
        });
        seed(world, 'b');

        const events = sink();
        for (let i = 0; i < 20; i++) ctrl.update(world, 0.05, events);
        expect(events.got.map(e => e.name)).toEqual(['walk-step']);

        events.got.length = 0;
        ctrl.setFloat(E, 'speed', 9);
        for (let i = 0; i < 20; i++) ctrl.update(world, 0.05, events);
        expect(events.got.map(e => e.name)).toEqual(['run-step']);
    });
});
