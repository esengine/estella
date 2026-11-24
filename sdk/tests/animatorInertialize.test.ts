// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a transition by inertia starts exactly where the last frame left the skeleton, plays only the motion
 * entered, and has arrived at it by the end of its duration; the curve it rides has no speed left at its end.
 */
import { describe, it, expect } from 'vitest';
import { Animator, AnimatorControllerAPI, inertiaCurve, type AnimatorData, type AnimatorControllerDef } from '../src/animation';
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

/** A clip holding the entity at height `y`. */
const holdAt = (y: number): TimelineAsset => ({
    version: '1.2', type: 'timeline', duration: 1, wrapMode: WrapMode.Loop,
    tracks: [{
        type: TrackType.Property, component: 'Transform', childPath: '', name: 't',
        channels: [{ property: 'position.y', keyframes: [key(0, y), key(1, y)] }],
    }],
} as TimelineAsset);

function setup(blend?: 'inertialize' | 'crossfade') {
    const timeline = new TimelineAPI();
    timeline.registerAsset('low', holdAt(0));
    timeline.registerAsset('high', holdAt(10));
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    const def: AnimatorControllerDef = {
        parameters: [{ name: 'go', type: 'bool', default: false }],
        initialState: 'Low',
        ...(blend ? { transitionBlend: blend } : {}),
        states: [
            { name: 'Low', motion: { kind: TIMELINE_MOTION, clip: 'low', loop: true },
              transitions: [{ to: 'High', conditions: [{ param: 'go', op: 'true' }], duration: 0.5 }] },
            { name: 'High', motion: { kind: TIMELINE_MOTION, clip: 'high', loop: true }, transitions: [] },
        ],
    };
    ctrl.registerController('c', def);
    const world = makeWorld();
    world.insert(E, Animator, { controller: 'c', currentState: '', enabled: true } as AnimatorData);
    world.insert(E, Transform, { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } as unknown as TransformData);
    return { world, ctrl };
}

const height = (world: any) => (world.get(E, Transform) as TransformData).position.y;

describe('the curve', () => {
    it('starts at the offset and is gone by the end', () => {
        expect(inertiaCurve(10, 0, 0.5, 0)).toBeCloseTo(10, 6);
        expect(inertiaCurve(10, 0, 0.5, 0.5)).toBe(0);
    });

    it('arrives with no speed left', () => {
        const t = 0.5 - 1e-4;
        const slope = (inertiaCurve(10, 0, 0.5, t) - inertiaCurve(10, 0, 0.5, t - 1e-4)) / 1e-4;
        expect(Math.abs(slope)).toBeLessThan(1e-2);
    });

    it('keeps the speed it starts with when that heads home', () => {
        const slope = (inertiaCurve(10, -20, 0.5, 1e-5) - inertiaCurve(10, -20, 0.5, 0)) / 1e-5;
        expect(slope).toBeCloseTo(-20, 1);
    });
});

describe('a transition by inertia', () => {
    it('starts from where the last frame left the skeleton, and has arrived by the end', () => {
        const { world, ctrl } = setup('inertialize');
        ctrl.update(world, 1 / 60);
        ctrl.update(world, 1 / 60);
        expect(height(world)).toBeCloseTo(0, 6);
        ctrl.setBool(E, 'go', true);
        ctrl.update(world, 1 / 60);
        expect(height(world)).toBeCloseTo(0, 4);
        for (let i = 0; i < 15; i++) ctrl.update(world, 1 / 60);
        const midway = height(world);
        expect(midway).toBeGreaterThan(0);
        expect(midway).toBeLessThan(10);
        for (let i = 0; i < 30; i++) ctrl.update(world, 1 / 60);
        expect(height(world)).toBeCloseTo(10, 6);
    });

    it('is left as a crossfade where nothing asks for it', () => {
        const { world, ctrl } = setup();
        ctrl.update(world, 1 / 60);
        ctrl.setBool(E, 'go', true);
        ctrl.update(world, 1 / 60);
        for (let i = 0; i < 15; i++) ctrl.update(world, 1 / 60);
        // A crossfade a little over half way: half of each, near enough.
        expect(height(world)).toBeGreaterThan(4);
        expect(height(world)).toBeLessThan(7);
    });
});
