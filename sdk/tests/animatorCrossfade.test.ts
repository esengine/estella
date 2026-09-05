// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a crossfade composes poses, so what lands is one write whose value
 * does not depend on which motion was sampled first.
 */
import { describe, it, expect } from 'vitest';
import { Pose, mixPoses, Animator, AnimatorControllerAPI,
         type AnimatorData, type AnimatorControllerDef } from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { defineComponent } from '../src/ecs/component';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const E = 1;

/** Registry is per context and reset between tests, so this is taken per call. */
const probe = () => defineComponent('MixProbe', {
    lift: 0,
    pos: { x: 0, y: 0, z: 0 },
    rot: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
});

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

/** A pose stating exactly `values` for the probe component on E. */
function poseStating(world: any, values: Record<string, unknown>): Pose {
    const pose = new Pose();
    pose.reset();
    const track = pose.track(world, E, probe())!;
    for (const [field, value] of Object.entries(values)) {
        track.data[field] = value;
        track.touched.add(field);
    }
    return pose;
}

function seedWorld() {
    const world = makeWorld();
    world.insert(E, probe(), {
        lift: 0, pos: { x: 0, y: 0, z: 0 },
        rot: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
    });
    return world;
}

const read = (world: any) => world.get(E, probe()) as {
    lift: number;
    pos: { x: number; y: number; z: number };
    rot: { w: number; x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
};

describe('the pose mixer', () => {
    it('averages scalars and vectors by weight', () => {
        const world = seedWorld();
        const a = poseStating(world, { lift: 0, pos: { x: 0, y: 10, z: 0 } });
        const b = poseStating(world, { lift: 10, pos: { x: 100, y: 20, z: 0 } });
        const out = new Pose();

        mixPoses([{ pose: a, weight: 0.25 }, { pose: b, weight: 0.75 }], out, world);
        out.applyTo(world);

        const got = read(world);
        expect(got.lift).toBeCloseTo(7.5, 6);
        expect(got.pos.x).toBeCloseTo(75, 6);
        expect(got.pos.y).toBeCloseTo(17.5, 6);
    });

    it('takes the shortest arc between rotations, whichever way they are spelled', () => {
        const world = seedWorld();
        const identity = { w: 1, x: 0, y: 0, z: 0 };
        // The SAME rotation as (0.7071, 0, 0, 0.7071) - a quarter turn about Z -
        // written negated. Averaged naively this cancels toward a three-quarter
        // turn the other way instead of meeting the identity halfway.
        const quarterTurnNegated = { w: -Math.SQRT1_2, x: -0, y: -0, z: -Math.SQRT1_2 };

        const a = poseStating(world, { rot: identity });
        const b = poseStating(world, { rot: quarterTurnNegated });
        const out = new Pose();

        mixPoses([{ pose: a, weight: 0.5 }, { pose: b, weight: 0.5 }], out, world);
        out.applyTo(world);

        // Halfway from 0 to 90 degrees about Z is 45: (cos22.5, 0, 0, sin22.5).
        const got = read(world).rot;
        expect(got.w).toBeCloseTo(Math.cos(Math.PI / 8), 5);
        expect(got.z).toBeCloseTo(Math.sin(Math.PI / 8), 5);
        expect(Math.hypot(got.w, got.x, got.y, got.z)).toBeCloseTo(1, 6);
    });

    it('gives a field only one motion writes to that motion whole', () => {
        const world = seedWorld();
        // `lift` is B's alone. At weight 0.1 it must still arrive at 50, not be
        // dragged nine tenths of the way back to the base value.
        const a = poseStating(world, { pos: { x: 4, y: 0, z: 0 } });
        const b = poseStating(world, { lift: 50 });
        const out = new Pose();

        mixPoses([{ pose: a, weight: 0.9 }, { pose: b, weight: 0.1 }], out, world);
        out.applyTo(world);

        expect(read(world).lift).toBeCloseTo(50, 6);
        expect(read(world).pos.x).toBeCloseTo(4, 6);
    });

    it('mixes each entity on its own, as a skeleton\u2019s joints are', () => {
        const world = makeWorld();
        const def = probe();
        const base = () => ({
            lift: 0, pos: { x: 0, y: 0, z: 0 },
            rot: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        });
        const JOINTS = [10, 11, 12];
        for (const j of JOINTS) world.insert(j, def, base());

        // Two poses over three entities: what one joint blends to must not
        // depend on what its neighbours are doing.
        const posed = (values: Record<number, number>): Pose => {
            const pose = new Pose();
            pose.reset();
            for (const [entity, lift] of Object.entries(values)) {
                const track = pose.track(world, Number(entity), def)!;
                track.data.lift = lift;
                track.touched.add('lift');
            }
            return pose;
        };
        const a = posed({ 10: 0, 11: 100, 12: 50 });
        const b = posed({ 10: 100, 11: 0, 12: 50 });

        const out = new Pose();
        mixPoses([{ pose: a, weight: 0.25 }, { pose: b, weight: 0.75 }], out, world);
        out.applyTo(world);

        const liftOf = (e: number) => (world.get(e, def) as { lift: number }).lift;
        expect(liftOf(10)).toBeCloseTo(75, 6);
        expect(liftOf(11)).toBeCloseTo(25, 6);
        expect(liftOf(12)).toBeCloseTo(50, 6);
    });

    it('is the same answer whichever order the poses arrive in', () => {
        const run = (swap: boolean) => {
            const world = seedWorld();
            const a = poseStating(world, {
                lift: 3, pos: { x: 0, y: 1, z: 2 },
                rot: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
            });
            const b = poseStating(world, {
                lift: 9, pos: { x: 8, y: 5, z: -3 },
                rot: { w: -Math.SQRT1_2, x: 0, y: 0, z: -Math.SQRT1_2 },
                scale: { x: 2, y: 3, z: 4 },
            });
            const sources = [{ pose: a, weight: 0.3 }, { pose: b, weight: 0.7 }];
            const out = new Pose();
            mixPoses(swap ? [...sources].reverse() : sources, out, world);
            out.applyTo(world);
            return read(world);
        };

        // Not "close to": composition is addition, and addition commutes.
        expect(run(true)).toEqual(run(false));
    });
});

// ---------------------------------------------------------------------------
// End to end, through the animator
// ---------------------------------------------------------------------------

/** A clip holding the probe at a constant pose. */
function holdPose(lift: number, rot: { w: number; x: number; y: number; z: number }): TimelineAsset {
    const key = (value: number) => ([{
        time: 0, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear,
    }]);
    return {
        version: '1.2', type: 'timeline', duration: 10, wrapMode: WrapMode.Loop,
        tracks: [{
            type: TrackType.Property, component: 'MixProbe', childPath: '', name: 't',
            channels: [
                { property: 'lift', keyframes: key(lift) },
                { property: 'rot.w', keyframes: key(rot.w) },
                { property: 'rot.x', keyframes: key(rot.x) },
                { property: 'rot.y', keyframes: key(rot.y) },
                { property: 'rot.z', keyframes: key(rot.z) },
            ],
        }],
    } as TimelineAsset;
}

const IDENTITY = { w: 1, x: 0, y: 0, z: 0 };
const QUARTER_Z = { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 };

/** Idle at lift 0 / no turn, Run at lift 100 / a quarter turn, fading over 1s. */
function fadingController(fadeSeconds: number): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    timeline.registerAsset('idle.estimeline', holdPose(0, IDENTITY));
    timeline.registerAsset('run.estimeline', holdPose(100, QUARTER_Z));
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));

    const def: AnimatorControllerDef = {
        parameters: [{ name: 'speed', type: 'float', default: 0 }],
        initialState: 'Idle',
        states: [
            {
                name: 'Idle',
                motion: { kind: TIMELINE_MOTION, clip: 'idle.estimeline' },
                transitions: [{
                    to: 'Run',
                    conditions: [{ param: 'speed', op: 'gt', value: 0 }],
                    duration: fadeSeconds,
                }],
            },
            {
                name: 'Run',
                motion: { kind: TIMELINE_MOTION, clip: 'run.estimeline' },
                transitions: [],
            },
        ],
    };
    ctrl.registerController('loco', def);
    return ctrl;
}

describe('a crossfade through the animator', () => {
    it('is all of the outgoing motion the moment the fade begins', () => {
        const world = seedWorld();
        const ctrl = fadingController(1);
        world.insert(E, Animator, { controller: 'loco', currentState: '', enabled: true } as AnimatorData);

        ctrl.update(world, 0.016);
        expect(read(world).lift).toBe(0);

        // The frame the transition fires: no time has elapsed in the fade yet.
        ctrl.setFloat(E, 'speed', 1);
        ctrl.update(world, 0);
        expect(read(world).lift).toBeCloseTo(0, 6);
        expect(read(world).rot.w).toBeCloseTo(1, 6);
    });

    it('is halfway across at the midpoint, in both position and rotation', () => {
        const world = seedWorld();
        const ctrl = fadingController(1);
        world.insert(E, Animator, { controller: 'loco', currentState: '', enabled: true } as AnimatorData);

        ctrl.update(world, 0.016);
        ctrl.setFloat(E, 'speed', 1);
        ctrl.update(world, 0);        // fires the transition
        ctrl.update(world, 0.5);      // half of a one-second fade

        const got = read(world);
        expect(got.lift).toBeCloseTo(50, 4);
        // Half of a quarter turn is an eighth: cos/sin of 22.5 degrees.
        expect(got.rot.w).toBeCloseTo(Math.cos(Math.PI / 8), 4);
        expect(got.rot.z).toBeCloseTo(Math.sin(Math.PI / 8), 4);
    });

    it('is all of the incoming motion once the fade is over', () => {
        const world = seedWorld();
        const ctrl = fadingController(1);
        world.insert(E, Animator, { controller: 'loco', currentState: '', enabled: true } as AnimatorData);

        ctrl.update(world, 0.016);
        ctrl.setFloat(E, 'speed', 1);
        ctrl.update(world, 0);
        ctrl.update(world, 1.2);      // past the end of the fade

        const got = read(world);
        expect(got.lift).toBeCloseTo(100, 5);
        expect(got.rot.w).toBeCloseTo(QUARTER_Z.w, 5);
        expect(got.rot.z).toBeCloseTo(QUARTER_Z.z, 5);
    });

    it('cuts when the transition names no duration', () => {
        const world = seedWorld();
        const ctrl = fadingController(0);
        world.insert(E, Animator, { controller: 'loco', currentState: '', enabled: true } as AnimatorData);

        ctrl.update(world, 0.016);
        ctrl.setFloat(E, 'speed', 1);
        ctrl.update(world, 0);
        expect(read(world).lift).toBeCloseTo(100, 6);
    });
});
