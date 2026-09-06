// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a character off the ground stops looking like one standing on it.
 * Through the SHIPPED graph and clip — a fixture pair proves nothing about them.
 *
 * Two cases here pass alone and fail in a full-suite run, and have since before
 * the Streaming Delivery work. See "Known debt" in `sdk/tests/README.md`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
    ThirdPersonController, requestMotion, observeMotion,
    TPC_SPEED, TPC_GROUNDED, TPC_JUMP,
    type ThirdPersonControllerData,
} from '../src/gameplay';
import { CharacterController3D, type CharacterController3DData } from '../src/physics3d/Physics3DComponents';
import {
    Animator, AnimatorControllerAPI,
    type AnimatorData, type AnimatorControllerDef,
} from '../src/animation';
import { createTimelineMotionDriver, TIMELINE_MOTION, parseTimelineAsset } from '../src/timeline';
import { TimelineAPI } from '../src/timeline/TimelineControl';
import { Transform, Children, Name, type TransformData } from '../src/ecs/component';

const PLAYER = 1;
const BONE1 = 2;
const MODELS = path.resolve(__dirname, '../../examples/third-person-3d/assets/models');

const asset = (name: string) =>
    parseTimelineAsset(JSON.parse(readFileSync(path.join(MODELS, name), 'utf8')));
const GRAPH: AnimatorControllerDef =
    JSON.parse(readFileSync(path.join(MODELS, 'locomotion.esanimator'), 'utf8'));

function makeWorld() {
    const store = new Map<unknown, Map<number, unknown>>();
    const children = new Map<number, Record<string, number>>();
    const mapOf = (c: unknown) => {
        let m = store.get(c);
        if (!m) { m = new Map(); store.set(c, m); }
        return m;
    };
    return {
        childOf: children,
        insert(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        get(e: number, c: unknown) { return mapOf(c).get(e); },
        has(e: number, c: unknown) { return mapOf(c).has(e); },
        set(e: number, c: unknown, d: unknown) { mapOf(c).set(e, d); },
        tryGet(e: number, c: unknown) { return mapOf(c).get(e) ?? null; },
        valid() { return true; },
        ensureTransformsComposed() { /* nothing is parented in this harness */ },
        update(e: number, c: unknown, edit: (d: any) => void) {
            const d = mapOf(c).get(e);
            if (d === undefined) throw new Error('update: entity does not carry it');
            edit(d); mapOf(c).set(e, d);
        },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter((e) => rest.every((c) => mapOf(c).has(e)));
        },
        findEntityByName(name: string) { return name === 'Bone1' ? BONE1 : null; },
    } as any;
}

const character = (over: Partial<CharacterController3DData> = {}): CharacterController3DData => ({
    velocity: { x: 0, y: 0, z: 0 },
    radius: 30, halfHeight: 30, maxSlope: 0.87, layer: 0,
    stepHeight: 40, snapDown: 50, mass: 70, pushForce: 5000, enabled: true,
    isOnFloor: true, floorNormal: { x: 0, y: 1, z: 0 },
    realVelocity: { x: 0, y: 0, z: 0 },
    ...over,
} as CharacterController3DData);

const controller = (over: Partial<ThirdPersonControllerData> = {}): ThirdPersonControllerData => ({
    moveSpeed: 320, acceleration: 2400, deceleration: 3200, rotationSpeed: 720,
    jumpSpeed: 520, airControl: 0.3, cameraRelative: false, camera: 0 as never,
    idleThreshold: 8, enabled: true, ...over,
});

const transform = (): TransformData => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
} as TransformData);

/** Keys the controller reads, as the input resource it expects. */
const keys = (down: string[] = [], pressed: string[] = []) => ({
    isKeyDown: (k: string) => down.includes(k),
    isKeyPressed: (k: string) => pressed.includes(k),
    getMousePosition: () => ({ x: 0, y: 0 }),
    isMouseButtonDown: () => false,
}) as any;

function rig() {
    const world = makeWorld();
    world.insert(PLAYER, Transform, transform());
    world.insert(PLAYER, CharacterController3D, character());
    world.insert(PLAYER, ThirdPersonController, controller());
    world.insert(PLAYER, Animator,
                 { controller: 'loco', currentState: '', enabled: true } as AnimatorData);
    // The joint the clips pose, reached the way the sampler reaches it: a
    // `childPath` is walked through Children and Name, so a harness that only
    // holds a Transform is one the clip writes nothing into.
    world.insert(PLAYER, Children, { entities: [BONE1] } as any);
    world.insert(BONE1, Name, { value: 'Bone1' } as any);
    world.insert(BONE1, Transform, transform());

    const timeline = new TimelineAPI();
    for (const name of ['skinned-fade_Flat', 'skinned-fade_Bent', 'airborne', 'dodge', 'attack']) {
        timeline.registerAsset(`${name}.estimeline`, asset(`${name}.estimeline`));
    }
    const ctrl = new AnimatorControllerAPI();
    ctrl.registerMotionDriver(TIMELINE_MOTION, createTimelineMotionDriver(timeline));
    ctrl.registerController('loco', GRAPH);
    return { world, ctrl };
}

/** The clip the SHIPPED graph's Airborne state actually plays. Read from the
 *  graph, not named here: a pose claim that hard-codes the file it wants stays
 *  green when the state is repointed at a ground clip. */
const AIRBORNE_CLIP =
    (GRAPH.states.find((s) => s.name === 'Airborne')?.motion as any)?.clip as string;

const stateOf = (world: any) => (world.get(PLAYER, Animator) as AnimatorData).currentState;

/** One frame: ask, let the world answer, observe, then pose. */
function frame(
    world: any, ctrl: AnimatorControllerAPI,
    { down = [], pressed = [], onFloor, moved = { x: 0, z: 0 } }:
    { down?: string[]; pressed?: string[]; onFloor: boolean; moved?: { x: number; z: number } },
) {
    const dt = 1 / 60;
    requestMotion(world, keys(down, pressed), dt, ctrl);
    world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
        c.isOnFloor = onFloor;
        c.realVelocity.x = moved.x; c.realVelocity.z = moved.z;
    });
    observeMotion(world, ctrl, dt);
    ctrl.update(world, dt);
}

describe('the shipped graph answers leaving the ground', () => {
    it('declares an Airborne state over its own clip', () => {
        const airborne = GRAPH.states.find((s) => s.name === 'Airborne');
        expect(airborne, 'the shipped graph has no Airborne state').toBeDefined();
        expect((airborne!.motion as any).clip).toBe('airborne.estimeline');
        // The character controller owns the vertical; a clip that also moved it
        // would be a second author of the same number.
        expect(airborne!.rootMotion).toBe(false);
    });

    it('its clip states a pose and no placement', () => {
        // The flag above is half of it: with rootMotion off a root track lands
        // in the character's Transform, which the controller owns and discards
        // silently — a clip that moves the character, and no frame that shows it.
        const clip = JSON.parse(readFileSync(path.join(MODELS, AIRBORNE_CLIP), 'utf8'));
        const placement = clip.tracks.flatMap((t: any) => (t.channels ?? [])
            .filter((c: any) => /^position\./.test(c.property))
            .map((c: any) => `${t.name}.${c.property}`));
        expect(placement, 'the airborne clip places the character').toEqual([]);
    });

    it('stands in a ground state while it is on the floor', () => {
        const { world, ctrl } = rig();
        for (let i = 0; i < 6; i++) frame(world, ctrl, { onFloor: true });
        expect(stateOf(world)).toBe('Idle');
    });

    it('an accepted jump reaches Airborne', () => {
        const { world, ctrl } = rig();
        frame(world, ctrl, { onFloor: true });
        frame(world, ctrl, { pressed: ['Space'], onFloor: true });
        expect(stateOf(world)).toBe('Airborne');
    });

    it('stays Airborne while it is off the floor', () => {
        const { world, ctrl } = rig();
        frame(world, ctrl, { pressed: ['Space'], onFloor: true });
        for (let i = 0; i < 20; i++) frame(world, ctrl, { onFloor: false });
        expect(stateOf(world)).toBe('Airborne');
    });

    it('walking off a ledge is airborne too, with no jump to announce it', () => {
        const { world, ctrl } = rig();
        const seen: string[] = [];
        const spy = new Proxy(ctrl, {
            get(t: any, k) {
                if (k === 'setTrigger') {
                    return (e: number, n: string) => { seen.push(n); return t.setTrigger(e, n); };
                }
                const v = t[k];
                return typeof v === 'function' ? v.bind(t) : v;
            },
        }) as AnimatorControllerAPI;
        for (let i = 0; i < 3; i++) frame(world, spy, { onFloor: true });
        for (let i = 0; i < 6; i++) frame(world, spy, { onFloor: false });
        expect(seen).not.toContain(TPC_JUMP);
        expect(ctrl.getBool(PLAYER, TPC_GROUNDED)).toBe(false);
        expect(stateOf(world)).toBe('Airborne');
    });

    it('landing still returns to Idle', () => {
        const { world, ctrl } = rig();
        frame(world, ctrl, { pressed: ['Space'], onFloor: true });
        for (let i = 0; i < 6; i++) frame(world, ctrl, { onFloor: false });
        for (let i = 0; i < 6; i++) frame(world, ctrl, { onFloor: true });
        expect(stateOf(world)).toBe('Idle');
    });

    it('landing at speed returns to Locomotion', () => {
        const { world, ctrl } = rig();
        frame(world, ctrl, { pressed: ['Space'], onFloor: true });
        for (let i = 0; i < 6; i++) frame(world, ctrl, { onFloor: false });
        for (let i = 0; i < 6; i++) {
            frame(world, ctrl, { down: ['KeyW'], onFloor: true, moved: { x: 0, z: -300 } });
        }
        expect(ctrl.getFloat(PLAYER, TPC_SPEED)).toBeGreaterThan(8);
        expect(stateOf(world)).toBe('Locomotion');
    });
});

describe('the airborne pose is one a grounded pose cannot be mistaken for', () => {
    /** What the shipped clip writes into the joint at `t`, as the sampler sees it. */
    function poseAt(clip: string, t: number) {
        const { world, ctrl } = rig();
        const timeline = new TimelineAPI();
        timeline.registerAsset(clip, asset(clip));
        const driver = createTimelineMotionDriver(timeline);
        const solo = new AnimatorControllerAPI();
        solo.registerMotionDriver(TIMELINE_MOTION, driver);
        solo.registerController('one', {
            parameters: [], initialState: 'S',
            states: [{ name: 'S', motion: { kind: TIMELINE_MOTION, clip, loop: true }, transitions: [] }],
        });
        world.update(PLAYER, Animator, (a: AnimatorData) => { a.controller = 'one'; a.currentState = ''; });
        solo.update(world, 0);
        solo.update(world, t);
        return { ...(world.get(BONE1, Transform) as TransformData).rotation };
    }

    it('tilts about X, which every ground clip leaves alone', () => {
        const air = poseAt(AIRBORNE_CLIP, 0.5);
        expect(Math.abs(air.x)).toBeGreaterThan(0.4);
        for (const ground of ['skinned-fade_Flat.estimeline', 'skinned-fade_Bent.estimeline']) {
            expect(Math.abs(poseAt(ground, 0.5).x)).toBeLessThan(0.05);
        }
    });

    it('is far enough from every other shipped pose to be told apart', () => {
        const air = poseAt(AIRBORNE_CLIP, 0.5);
        const others = ['skinned-fade_Flat.estimeline', 'skinned-fade_Bent.estimeline',
                        'dodge.estimeline', 'attack.estimeline'].filter((n) => n !== AIRBORNE_CLIP);
        for (const name of others) {
            const p = poseAt(name, 0.25);
            // Quaternion dot: 1 is the same orientation. Anything this graph can
            // reach must be visibly apart, or a screenshot proves nothing.
            const dot = Math.abs(air.x * p.x + air.y * p.y + air.z * p.z + air.w * p.w);
            expect(dot, `${name} is indistinguishable from airborne`).toBeLessThan(0.95);
        }
    });
});
