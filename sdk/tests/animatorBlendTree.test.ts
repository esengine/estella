// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a 1D blend over sampleable motions MIXES its neighbouring stops
 * rather than picking one, at a shared phase rather than a shared second.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, blend1DPair, selectBlendStop,
    type AnimatorData, type AnimatorControllerDef, type AnimatorBlend1DMotion,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { defineComponent } from '../src/ecs/component';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const E = 1;

const probe = () => defineComponent('BlendProbe', { lift: 0 });

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
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

function seedWorld() {
    const world = makeWorld();
    world.insert(E, probe(), { lift: 0 });
    return world;
}

const liftOf = (world: any) => (world.get(E, probe()) as { lift: number }).lift;

/** A clip holding `lift` for `duration` seconds. */
function hold(lift: number, duration: number): TimelineAsset {
    return {
        version: '1.2', type: 'timeline', duration, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'BlendProbe', childPath: '', name: 't',
            channels: [{
                property: 'lift',
                keyframes: [{
                    time: 0, value: lift, inTangent: 0, outTangent: 0,
                    interpolation: InterpType.Linear,
                }],
            }],
        }],
    } as TimelineAsset;
}

/** A clip ramping `lift` from 0 to 100 over its whole length. */
function ramp(duration: number): TimelineAsset {
    const key = (time: number, value: number) => ({
        time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear,
    });
    return {
        version: '1.2', type: 'timeline', duration, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'BlendProbe', childPath: '', name: 't',
            channels: [{ property: 'lift', keyframes: [key(0, 0), key(duration, 100)] }],
        }],
    } as TimelineAsset;
}

const clip = (name: string) => ({ kind: TIMELINE_MOTION, clip: name });

/** One state playing `motion`, driven by the float parameters named. */
function controllerOf(
    motion: AnimatorBlend1DMotion,
    assets: Record<string, TimelineAsset>,
    params: string[],
): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    for (const [name, asset] of Object.entries(assets)) timeline.registerAsset(name, asset);
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));

    const def: AnimatorControllerDef = {
        parameters: params.map(name => ({ name, type: 'float' as const, default: 0 })),
        initialState: 'Move',
        states: [{ name: 'Move', motion, transitions: [] }],
    };
    ctrl.registerController('loco', def);
    return ctrl;
}

function attach(world: any): void {
    world.insert(E, Animator, {
        controller: 'loco', currentState: '', enabled: true,
    } as AnimatorData);
}

describe('where a parameter sits among the stops', () => {
    const blend: AnimatorBlend1DMotion = {
        kind: 'blend1d', parameter: 'speed',
        thresholds: [
            { value: 0, motion: clip('idle') },
            { value: 1, motion: clip('walk') },
            { value: 4, motion: clip('run') },
        ],
    };

    it('divides between the two it falls between', () => {
        const { lower, upper, t } = blend1DPair(blend, 2.5);
        expect(lower?.value).toBe(1);
        expect(upper?.value).toBe(4);
        expect(t).toBeCloseTo(0.5, 6);
    });

    it('gives the top stop the whole of it past the last threshold', () => {
        const { lower, upper, t } = blend1DPair(blend, 99);
        expect(lower?.value).toBe(4);
        expect(upper).toBeNull();
        expect(t).toBe(0);
    });

    it('clamps up to the lowest stop under every threshold', () => {
        const under: AnimatorBlend1DMotion = {
            kind: 'blend1d', parameter: 'speed',
            thresholds: [{ value: 2, motion: clip('walk') }, { value: 4, motion: clip('run') }],
        };
        const { lower, upper } = blend1DPair(under, 0);
        expect(lower?.value).toBe(2);
        expect(upper).toBeNull();
    });

    it('is the same answer a switched motion selects', () => {
        // `apply` picks and `sample` mixes, but they must not disagree about
        // WHICH stop is the dominant one, or a sprite blend and a skeletal one
        // read the same parameter differently.
        expect(selectBlendStop(blend, 2.5)).toBe(blend1DPair(blend, 2.5).lower);
        expect(selectBlendStop(blend, 0)?.value).toBe(0);
    });
});

describe('a 1D blend over sampleable motions', () => {
    const twoStops: AnimatorBlend1DMotion = {
        kind: 'blend1d', parameter: 'speed',
        thresholds: [
            { value: 0, motion: clip('idle.estimeline') },
            { value: 1, motion: clip('run.estimeline') },
        ],
    };
    const held = { 'idle.estimeline': hold(0, 10), 'run.estimeline': hold(100, 10) };

    it('is half of each at the midpoint, not the stop below', () => {
        const world = seedWorld();
        const ctrl = controllerOf(twoStops, held, ['speed']);
        attach(world);

        ctrl.setFloat(E, 'speed', 0.5);
        ctrl.update(world, 0.016);

        expect(liftOf(world)).toBeCloseTo(50, 4);
    });

    it('walks the whole way across as the parameter rises', () => {
        const world = seedWorld();
        const ctrl = controllerOf(twoStops, held, ['speed']);
        attach(world);

        for (const [speed, expected] of [[0, 0], [0.25, 25], [0.75, 75], [1, 100]] as const) {
            ctrl.setFloat(E, 'speed', speed);
            ctrl.update(world, 0.016);
            expect(liftOf(world)).toBeCloseTo(expected, 4);
        }
    });

    it('samples both stops at the same phase, not the same second', () => {
        // A 2s and a 1s ramp, half and half: the blend runs 1.5s, so at 0.75s both
        // are at their own halfway point. Sampled at the same second instead, the
        // short clip is three quarters through and drags the answer to 56.25.
        const world = seedWorld();
        const ramps: AnimatorBlend1DMotion = {
            kind: 'blend1d', parameter: 'speed',
            thresholds: [
                { value: 0, motion: clip('slow.estimeline') },
                { value: 1, motion: clip('fast.estimeline') },
            ],
        };
        const ctrl = controllerOf(
            ramps, { 'slow.estimeline': ramp(2), 'fast.estimeline': ramp(1) }, ['speed'],
        );
        attach(world);
        ctrl.setFloat(E, 'speed', 0.5);
        // Entering a state restarts its clock, so the seconds have to be put on
        // a state the entity is already in.
        ctrl.update(world, 0);
        ctrl.update(world, 0.75);

        expect(liftOf(world)).toBeCloseTo(50, 3);
    });

    it('states the blended length, so an exit-time transition waits for it', () => {
        const world = seedWorld();
        const ramps: AnimatorBlend1DMotion = {
            kind: 'blend1d', parameter: 'speed',
            thresholds: [
                { value: 0, motion: clip('slow.estimeline') },
                { value: 1, motion: clip('fast.estimeline') },
            ],
        };
        const ctrl = controllerOf(
            ramps, { 'slow.estimeline': ramp(2), 'fast.estimeline': ramp(1) }, ['speed'],
        );
        attach(world);
        ctrl.setFloat(E, 'speed', 0.5);
        ctrl.update(world, 0.016);

        // Reached through the driver the animator itself asks: 2s and 1s, half
        // and half, is 1.5s — not the 2s of the stop a selection would name.
        const motion = ramps;
        const anyCtrl = ctrl as unknown as {
            motions_: { context(w: unknown, e: number, p: unknown): { duration(m: unknown): number } };
        };
        const ctx = anyCtrl.motions_.context(world, E, { speed: 0.5 });
        expect(ctx.duration(motion)).toBeCloseTo(1.5, 6);
    });
});

describe('a blend nested inside a blend', () => {
    it('keeps its own pair while the inner one resolves', () => {
        // Resolving the inner pair overwrites the shared scratch the outer one
        // just wrote, so an implementation that reads its own answer back
        // afterwards blends the wrong two clips.
        const world = seedWorld();
        const inner = (a: string, b: string): AnimatorBlend1DMotion => ({
            kind: 'blend1d', parameter: 'lean',
            thresholds: [{ value: 0, motion: clip(a) }, { value: 1, motion: clip(b) }],
        });
        const outer: AnimatorBlend1DMotion = {
            kind: 'blend1d', parameter: 'gait',
            thresholds: [
                { value: 0, motion: inner('a.estimeline', 'b.estimeline') },
                { value: 1, motion: inner('c.estimeline', 'd.estimeline') },
            ],
        };
        const ctrl = controllerOf(outer, {
            'a.estimeline': hold(0, 10), 'b.estimeline': hold(100, 10),
            'c.estimeline': hold(200, 10), 'd.estimeline': hold(300, 10),
        }, ['gait', 'lean']);
        attach(world);

        // The two parameters differ on purpose: at the same value the inner
        // blend's answer and the outer one's are the same number, and reading
        // one for the other would pass.
        ctrl.setFloat(E, 'gait', 0.25);
        ctrl.setFloat(E, 'lean', 0.75);
        ctrl.update(world, 0.016);

        // Inner low is 75, inner high is 275; a quarter of the way up is 125.
        expect(liftOf(world)).toBeCloseTo(125, 4);
    });
});
