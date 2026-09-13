// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a blend over sampleable motions MIXES the stops around the
 * parameter rather than picking one, at a shared phase rather than a shared
 * second — over a line and over a plane, by the same operation.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, blend1DPair, selectBlendStop,
    blend2DWeights, dominantBlendPoint,
    type AnimatorData, type AnimatorControllerDef,
    type AnimatorBlend1DMotion, type AnimatorBlend2DMotion, type AnimatorMotion,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { defineComponent, Transform } from '../src/ecs/component';
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
    motion: AnimatorMotion,
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

// ---------------------------------------------------------------------------
// Over a plane
// ---------------------------------------------------------------------------

const at = (x: number, y: number, name: string) => ({ position: { x, y }, motion: clip(name) });

/** Weights for `blend` at (x, y), as a plain array. */
function weightsAt(blend: AnimatorBlend2DMotion, x: number, y: number): number[] {
    const out = blend.points.map(() => ({ weight: 0 }));
    blend2DWeights(blend, x, y, out);
    return out.map(o => o.weight);
}

describe('how a 2D blend divides its plane', () => {
    /** North/south/east/west around the origin — the shape a locomotion grid is. */
    const compass: AnimatorBlend2DMotion = {
        kind: 'blend2d', parameterX: 'right', parameterY: 'forward',
        points: [at(1, 0, 'east'), at(0, 1, 'north'), at(-1, 0, 'west'), at(0, -1, 'south')],
    };

    it('gives a point standing on a clip that clip alone', () => {
        expect(weightsAt(compass, 1, 0)).toEqual([1, 0, 0, 0]);
        expect(weightsAt(compass, 0, -1)).toEqual([0, 0, 0, 1]);
    });

    it('shares a diagonal between the two clips that reach it', () => {
        // What no pair of 1D blends can say: half east and half north is ONE
        // motion, where two lines would pick a direction and a speed apart.
        const [east, north, west, south] = weightsAt(compass, 0.5, 0.5);
        expect(east).toBeCloseTo(0.5, 6);
        expect(north).toBeCloseTo(0.5, 6);
        expect(west).toBe(0);
        expect(south).toBe(0);
    });

    it('always divides the whole of it, never more or less', () => {
        for (const [x, y] of [[0, 0], [0.3, -0.2], [-0.9, 0.4], [2, 2], [-5, 0]] as const) {
            const sum = weightsAt(compass, x, y).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1, 6);
        }
    });

    it('holds a sample outside the hull by the clip nearest it', () => {
        const line: AnimatorBlend2DMotion = {
            kind: 'blend2d', parameterX: 'x', parameterY: 'y',
            points: [at(0, 0, 'idle'), at(2, 0, 'run')],
        };
        expect(weightsAt(line, 3, 0)).toEqual([0, 1]);
        expect(weightsAt(line, -4, 0)).toEqual([1, 0]);
    });

    it('names the heaviest point as the one a switched motion gets', () => {
        expect(dominantBlendPoint(compass, 0.9, 0.1)?.motion).toBe(compass.points[0]!.motion);
        expect(dominantBlendPoint(compass, -0.1, -0.9)?.motion).toBe(compass.points[3]!.motion);
    });
});

describe('a 2D blend through the animator', () => {
    const held = {
        'east.estimeline': hold(100, 10), 'north.estimeline': hold(200, 10),
        'west.estimeline': hold(0, 10), 'south.estimeline': hold(300, 10),
    };
    const compass: AnimatorBlend2DMotion = {
        kind: 'blend2d', parameterX: 'right', parameterY: 'forward',
        points: [
            at(1, 0, 'east.estimeline'), at(0, 1, 'north.estimeline'),
            at(-1, 0, 'west.estimeline'), at(0, -1, 'south.estimeline'),
        ],
    };

    it('mixes the two clips a diagonal reaches', () => {
        const world = seedWorld();
        const ctrl = controllerOf(compass, held, ['right', 'forward']);
        attach(world);

        ctrl.setFloat(E, 'right', 0.5);
        ctrl.setFloat(E, 'forward', 0.5);
        ctrl.update(world, 0.016);

        // Half of east (100) and half of north (200). Either one alone — which is
        // what selecting would give — is 100 or 200.
        expect(liftOf(world)).toBeCloseTo(150, 4);
    });

    it('plays one clip whole where the parameters stand on it', () => {
        const world = seedWorld();
        const ctrl = controllerOf(compass, held, ['right', 'forward']);
        attach(world);

        ctrl.setFloat(E, 'forward', -1);
        ctrl.update(world, 0.016);

        expect(liftOf(world)).toBeCloseTo(300, 4);
    });

    it('samples every contributing point at the same phase', () => {
        const world = seedWorld();
        const ramps: AnimatorBlend2DMotion = {
            kind: 'blend2d', parameterX: 'x', parameterY: 'y',
            points: [at(0, 0, 'slow.estimeline'), at(2, 0, 'fast.estimeline')],
        };
        const ctrl = controllerOf(
            ramps, { 'slow.estimeline': ramp(2), 'fast.estimeline': ramp(1) }, ['x', 'y'],
        );
        attach(world);
        ctrl.setFloat(E, 'x', 1);
        ctrl.update(world, 0);
        ctrl.update(world, 0.75);

        expect(liftOf(world)).toBeCloseTo(50, 3);
    });

    it('keeps its own weights while a nested blend resolves', () => {
        // Each point of the plane is a line of its own. Both borrow the same kind
        // of scratch, so an inner blend that got the outer one's list would mix
        // the outer weights into its own answer.
        const world = seedWorld();
        const lean = (a: string, b: string): AnimatorBlend1DMotion => ({
            kind: 'blend1d', parameter: 'lean',
            thresholds: [{ value: 0, motion: clip(a) }, { value: 1, motion: clip(b) }],
        });
        const outer: AnimatorBlend2DMotion = {
            kind: 'blend2d', parameterX: 'gait', parameterY: 'y',
            points: [
                { position: { x: 0, y: 0 }, motion: lean('a.estimeline', 'b.estimeline') },
                { position: { x: 1, y: 0 }, motion: lean('c.estimeline', 'd.estimeline') },
            ],
        };
        const ctrl = controllerOf(outer, {
            'a.estimeline': hold(0, 10), 'b.estimeline': hold(100, 10),
            'c.estimeline': hold(200, 10), 'd.estimeline': hold(300, 10),
        }, ['gait', 'lean', 'y']);
        attach(world);

        ctrl.setFloat(E, 'gait', 0.25);
        ctrl.setFloat(E, 'lean', 0.75);
        ctrl.update(world, 0.016);

        // Inner low is 75, inner high 275; three quarters of the way to the first.
        expect(liftOf(world)).toBeCloseTo(125, 4);
    });
});

// ---------------------------------------------------------------------------
// Displacement follows the same weights the pose does
// ---------------------------------------------------------------------------

/** A clip that walks `metres` along +Z over its whole length, as root motion. */
function travel(metres: number): TimelineAsset {
    const key = (time: number, value: number) => ({
        time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear,
    });
    return {
        version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'Transform', childPath: '', name: 'root',
            channels: [{ property: 'position.z', keyframes: [key(0, 0), key(1, metres)] }],
        }],
    } as TimelineAsset;
}

describe('a blend’s displacement', () => {
    const locomotion: AnimatorBlend1DMotion = {
        kind: 'blend1d', parameter: 'speed',
        thresholds: [
            { value: 0, motion: clip('walk.estimeline') },
            { value: 1, motion: clip('run.estimeline') },
        ],
    };

    /** How far the blend asks to move over one whole second at `speed`. */
    function asked(speed: number): number {
        const world = seedWorld();
        world.insert(E, Transform, {
            position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
        });

        const timeline = new TimelineAPI();
        timeline.registerAsset('walk.estimeline', travel(100));
        timeline.registerAsset('run.estimeline', travel(400));
        const ctrl = new AnimatorControllerAPI();
        ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));

        const anyCtrl = ctrl as unknown as {
            motions_: {
                context(w: unknown, e: number, p: unknown): {
                    rootDelta(m: unknown, s: unknown, o: { position: { z: number } }): boolean;
                };
            };
        };
        const ctx = anyCtrl.motions_.context(world, E, { speed });
        const out = { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } };
        const stated = ctx.rootDelta(locomotion, { from: 0, to: 1, inclusiveStart: true }, out);
        return stated ? out.position.z : NaN;
    }

    it('is weighted, not picked', () => {
        // Picking makes a character crossing run's threshold jump from 100 to 400
        // in one frame — the one thing a locomotion tree exists to prevent.
        expect(asked(0)).toBeCloseTo(100, 3);
        expect(asked(1)).toBeCloseTo(400, 3);
        expect(asked(0.5)).toBeCloseTo(250, 3);
        expect(asked(0.25)).toBeCloseTo(175, 3);
    });

    it('climbs without a step anywhere across the range', () => {
        let previous = asked(0);
        for (let speed = 0.05; speed <= 1.0001; speed += 0.05) {
            const here = asked(speed);
            expect(here - previous).toBeCloseTo(15, 3);
            previous = here;
        }
    });
});
