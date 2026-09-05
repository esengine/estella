// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a clip that moves the character states a REQUEST and moves nothing;
 * the same clip in a state not declaring it stays an ordinary property animation.
 */
import { describe, it, expect } from 'vitest';
import {
    Animator, AnimatorControllerAPI, AnimatorRootMotion,
    type AnimatorData, type AnimatorControllerDef, type AnimatorRootMotionData,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { sampleRootPlacement, createRootPlacement } from '../src/timeline/TimelineEvaluator';
import { Transform, defineComponent, type TransformData } from '../src/ecs/component';
import { q } from '../src/math/quat';
import {
    WrapMode, TrackType, InterpType, type TimelineAsset, type Keyframe,
} from '../src/timeline/TimelineTypes';

const E = 1;

/** Registry is per context and reset between tests, so this is taken per call. */
const probeDef = () => defineComponent('RootProbe', { x: 0 });

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

const key = (time: number, value: number): Keyframe =>
    ({ time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear });

/**
 * A clip that walks its OWN entity `forward` units along -Z and turns it `yawDeg`
 * about world up, while holding a probe at 5 — the probe being the part of the
 * same clip that is an ordinary pose and must land whatever the root does.
 */
function travelClip(
    forward: number, duration = 1, wrapMode: WrapMode = WrapMode.Once, yawDeg = 0,
): TimelineAsset {
    const half = (yawDeg * Math.PI) / 360;
    return {
        version: '1.2', type: 'timeline', duration, wrapMode,
        tracks: [
            {
                type: TrackType.Property, component: 'Transform', childPath: '',
                name: 'root', channels: [
                    { property: 'position.z', keyframes: [key(0, 0), key(duration, -forward)] },
                    { property: 'rotation.w', keyframes: [key(0, 1), key(duration, Math.cos(half))] },
                    { property: 'rotation.y', keyframes: [key(0, 0), key(duration, Math.sin(half))] },
                ],
            },
            {
                type: TrackType.Property, component: 'RootProbe', childPath: '',
                name: 'probe', channels: [{ property: 'x', keyframes: [key(0, 5)] }],
            },
        ],
    } as TimelineAsset;
}

function controllerOver(asset: TimelineAsset): AnimatorControllerAPI {
    const timeline = new TimelineAPI();
    timeline.registerAsset('travel.estimeline', asset);
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    return ctrl;
}

const graph = (rootMotion: boolean, loop: boolean): AnimatorControllerDef => ({
    parameters: [],
    initialState: 'Travel',
    states: [{
        name: 'Travel',
        motion: { kind: TIMELINE_MOTION, clip: 'travel.estimeline', loop },
        rootMotion,
        transitions: [],
    }],
});

interface Setup {
    world: any;
    ctrl: AnimatorControllerAPI;
}

function seed(asset: TimelineAsset, rootMotion: boolean, opts: {
    loop?: boolean; publish?: boolean; enabled?: boolean; yaw?: number;
} = {}): Setup {
    const world = makeWorld();
    const ctrl = controllerOver(asset);
    ctrl.registerController('g', graph(rootMotion, opts.loop ?? false));
    world.insert(E, Animator, { controller: 'g', currentState: '', enabled: true } as AnimatorData);
    world.insert(E, probeDef(), { x: 0 });
    world.insert(E, Transform, {
        position: { x: 0, y: 0, z: 0 },
        rotation: q.axis('y', ((opts.yaw ?? 0) * Math.PI) / 180),
        scale: { x: 1, y: 1, z: 1 },
    } as unknown as TransformData);
    if (opts.publish !== false) {
        world.insert(E, AnimatorRootMotion, {
            enabled: opts.enabled ?? true,
            active: false,
            deltaPosition: { x: 0, y: 0, z: 0 },
            deltaRotation: { w: 1, x: 0, y: 0, z: 0 },
            deltaTime: 0,
        } as AnimatorRootMotionData);
    }
    return { world, ctrl };
}

/** Run `frames` steps, summing what the animator asked for on the way. */
function drive(setup: Setup, frames: number, dt = 0.05): {
    asked: { x: number; y: number; z: number };
    turn: { w: number; x: number; y: number; z: number };
    seconds: number;
    activeFrames: number;
} {
    const asked = { x: 0, y: 0, z: 0 };
    let turn = { w: 1, x: 0, y: 0, z: 0 };
    let seconds = 0;
    let activeFrames = 0;
    for (let i = 0; i < frames; i++) {
        setup.ctrl.update(setup.world, dt);
        if (!setup.world.has(E, AnimatorRootMotion)) continue;
        const rm = setup.world.get(E, AnimatorRootMotion) as AnimatorRootMotionData;
        asked.x += rm.deltaPosition.x;
        asked.y += rm.deltaPosition.y;
        asked.z += rm.deltaPosition.z;
        turn = q.mul(rm.deltaRotation, turn);
        seconds += rm.deltaTime;
        if (rm.active) activeFrames++;
    }
    return { asked, turn, seconds, activeFrames };
}

const positionOf = (world: any) => (world.get(E, Transform) as TransformData).position;
const probeX = (world: any) => (world.get(E, probeDef()) as { x: number }).x;

// =============================================================================
// The root track, read on its own
// =============================================================================

describe('what a clip says about its own entity', () => {
    it('is read over a neutral base, so an unanimated channel contributes nothing', () => {
        const out = createRootPlacement();
        expect(sampleRootPlacement(travelClip(300), 0.5, out)).toBe(true);
        expect(out.position.z).toBeCloseTo(-150, 6);
        expect(out.position.x).toBe(0);
    });

    it('is absent from a clip that only poses bones', () => {
        const bonesOnly: TimelineAsset = {
            version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
            tracks: [{
                type: TrackType.Property, component: 'Transform', childPath: 'Bone',
                name: 'bone', channels: [{ property: 'position.z', keyframes: [key(0, 9)] }],
            }],
        } as TimelineAsset;
        expect(sampleRootPlacement(bonesOnly, 0.5, createRootPlacement())).toBe(false);
    });
});

// =============================================================================
// Through the animator
// =============================================================================

describe('a state that declares root motion', () => {
    it('asks to move the whole way and moves the entity none of it', () => {
        const setup = seed(travelClip(300), true);
        const { asked, seconds } = drive(setup, 30);

        expect(asked.z).toBeCloseTo(-300, 4);
        expect(positionOf(setup.world).z).toBe(0);
        // The same clip's other channels still land: "the entity did not move"
        // is also what a clip nobody sampled looks like.
        expect(probeX(setup.world)).toBe(5);
        // Every step but the one the state was entered on, which covered no time.
        expect(seconds).toBeCloseTo(29 * 0.05, 4);
    });

    it('is what suppresses the write, not the component that publishes it', () => {
        const setup = seed(travelClip(300), true, { publish: false });
        drive(setup, 30);
        expect(positionOf(setup.world).z).toBe(0);
        expect(probeX(setup.world)).toBe(5);
    });

    it('keeps asking across a loop seam instead of unwinding at it', () => {
        const setup = seed(travelClip(300, 1, WrapMode.Loop), true, { loop: true });
        // 59 steps of 0.05s past the entry frame: 2.95 laps of 300 units.
        const { asked } = drive(setup, 60);
        expect(asked.z).toBeCloseTo(-300 * 2.95, 3);
    });

    it('states the turn the clip asks for, in the character’s own frame', () => {
        const setup = seed(travelClip(0, 1, WrapMode.Once, 90), true);
        const { turn } = drive(setup, 30);
        expect(q.toEuler(q.normalize(turn))[1]).toBeCloseTo(90, 3);
    });

    it('states the displacement in world space, so a turned character asks the other way', () => {
        const setup = seed(travelClip(300), true, { yaw: 180 });
        const { asked } = drive(setup, 30);
        expect(asked.z).toBeCloseTo(300, 3);
        expect(Math.abs(asked.x)).toBeLessThan(1e-6);
    });

    it('says it is driving on every frame of the state, still moment or not', () => {
        // Nothing moves in the second half; `active` is the state's declaration.
        const held: TimelineAsset = {
            version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Once,
            tracks: [{
                type: TrackType.Property, component: 'Transform', childPath: '',
                name: 'root', channels: [{
                    property: 'position.z', keyframes: [key(0, 0), key(0.5, -100), key(1, -100)],
                }],
            }],
        } as TimelineAsset;
        const setup = seed(held, true);
        const { activeFrames } = drive(setup, 30);
        expect(activeFrames).toBe(30);
    });
});

describe('the same clip in a state that does not', () => {
    it('is an ordinary property animation and moves the entity', () => {
        const setup = seed(travelClip(300), false);
        const { asked, activeFrames } = drive(setup, 30);
        expect(positionOf(setup.world).z).toBeCloseTo(-300, 4);
        expect(activeFrames).toBe(0);
        expect(asked.z).toBe(0);
    });
});

describe('publishing turned off', () => {
    it('stops the request without letting the clip move the entity instead', () => {
        const setup = seed(travelClip(300), true, { enabled: false });
        const { asked, activeFrames } = drive(setup, 30);
        expect(activeFrames).toBe(0);
        expect(asked.z).toBe(0);
        expect(positionOf(setup.world).z).toBe(0);
    });
});
