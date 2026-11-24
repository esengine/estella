// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a state played by distance stands at the point of its clip with that much root travel left, never goes
 * back, keeps to a few times its own pace after the first frame, and plays on by time once the distance is spent.
 */
import { describe, it, expect } from 'vitest';
import { Animator, AnimatorControllerAPI, type AnimatorData, type AnimatorControllerDef } from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { Transform, type TransformData } from '../src/ecs/component';
import { WrapMode, TrackType, InterpType, type TimelineAsset } from '../src/timeline/TimelineTypes';

const E = 1;

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

const key = (time: number, value: number) => ({ time, value, inTangent: 0, outTangent: 0, interpolation: InterpType.Linear });

/** A two-second stop: its root goes 0 to 100 along Z, 80 of it in the first second. */
const stopClip = (): TimelineAsset => ({
    version: '1.2', type: 'timeline', duration: 2, wrapMode: WrapMode.Once,
    tracks: [{
        type: TrackType.Property, component: 'Transform', childPath: '', name: 'root',
        channels: [{ property: 'position.z', keyframes: [key(0, 0), key(1, 80), key(2, 100)] }],
    }],
} as TimelineAsset);

function setup() {
    const timeline = new TimelineAPI();
    timeline.registerAsset('stop', stopClip());
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    const def: AnimatorControllerDef = {
        parameters: [{ name: 'left', type: 'float', default: 0 }],
        initialState: 'Stop',
        states: [{
            name: 'Stop', motion: { kind: TIMELINE_MOTION, clip: 'stop', loop: false }, rootMotion: true,
            distanceParameter: 'left', transitions: [],
        }],
    };
    ctrl.registerController('c', def);
    const world = makeWorld();
    world.insert(E, Animator, { controller: 'c', currentState: '', enabled: true } as AnimatorData);
    world.insert(E, Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } as unknown as TransformData);
    return { world, ctrl, clock: () => (ctrl as any).runtimes_.get(E).layers[0].time as number };
}

describe('a state played by distance', () => {
    it('goes straight to the point with that much travel left', () => {
        const { world, ctrl, clock } = setup();
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 60);
        ctrl.update(world, 1 / 60);
        // 60 left of 100 is 40 travelled: half way through the first second.
        expect(clock()).toBeCloseTo(0.5, 3);
    });

    it('follows the distance as it falls, within a few times its own pace', () => {
        const { world, ctrl, clock } = setup();
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 60);
        ctrl.update(world, 1 / 60);
        ctrl.setFloat(E, 'left', 58);
        ctrl.update(world, 1 / 60);
        expect(clock()).toBeCloseTo(0.525, 3);
        // A jump of most of the clip in a frame is held to 2.5 frames of it.
        ctrl.setFloat(E, 'left', 3);
        ctrl.update(world, 1 / 60);
        expect(clock()).toBeCloseTo(0.525 + 2.5 / 60, 3);
    });

    it('never goes back', () => {
        const { world, ctrl, clock } = setup();
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 40);
        ctrl.update(world, 1 / 60);
        const was = clock();
        ctrl.setFloat(E, 'left', 90);
        ctrl.update(world, 1 / 60);
        expect(clock()).toBeGreaterThanOrEqual(was);
    });

    it('plays on by time once the distance is spent', () => {
        const { world, ctrl, clock } = setup();
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 10);
        ctrl.update(world, 1 / 60);
        const was = clock();
        ctrl.setFloat(E, 'left', 0);
        ctrl.update(world, 0.1);
        expect(clock()).toBeCloseTo(was + 0.1, 5);
    });
});

describe('what a state played by distance says about itself', () => {
    it('takes its catch-up limit from the state', () => {
        const { world, ctrl, clock } = setup();
        const def = (ctrl as any).getController('c');
        def.states[0].distanceMaxPace = 1;
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 60);
        ctrl.update(world, 1 / 60);
        const was = clock();
        ctrl.setFloat(E, 'left', 3);
        ctrl.update(world, 1 / 60);
        expect(clock()).toBeCloseTo(was + 1 / 60, 4);
    });

    it('and the distance under which it plays on by time', () => {
        const { world, ctrl, clock } = setup();
        const def = (ctrl as any).getController('c');
        def.states[0].distanceFloor = 50;
        ctrl.update(world, 0);
        ctrl.setFloat(E, 'left', 40);
        ctrl.update(world, 0.1);
        expect(clock()).toBeCloseTo(0.1, 5);
    });
});
