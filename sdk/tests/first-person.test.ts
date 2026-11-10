// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { World } from '../src/ecs/world';
import { Camera, Children, Transform, Parent } from '../src/ecs/component';
import type { CppRegistry, ESEngineModule } from '../src/wasm';
import { CharacterController3D } from '../src/physics3d/Physics3DComponents';
import {
    FirstPersonController, FirstPersonViewModel, lookAfter, walkDirection, crouchAfter, yawRotation, pitchRotation,
    type FirstPersonControllerData,
} from '../src/gameplay/FirstPersonController';
import { look, move, installViewModels, TouchLook } from '../src/gameplay/firstPersonSystems';
import { HAS_WASM, loadWasmModule } from './helpers/loadWasm';

describe('looking', () => {
    it('turns right and up as the pointer goes right and up, and keeps the yaw in a turn', () => {
        // The pointer going right is a positive dx, and up a negative dy.
        const a = lookAfter(0, 0, 100, -50, 0.1, -85, 85);
        expect(a.yaw).toBeCloseTo(-10);
        expect(a.pitch).toBeCloseTo(5);
        const wrapped = lookAfter(175, 0, -100, 0, 0.1, -85, 85);
        expect(wrapped.yaw).toBeCloseTo(-175);
    });

    it('stops at the limits of looking up and down', () => {
        expect(lookAfter(0, 80, 0, -1000, 0.1, -85, 85).pitch).toBe(85);
        expect(lookAfter(0, -80, 0, 1000, 0.1, -85, 85).pitch).toBe(-85);
    });

    it('turns a quaternion that looks where the angles say', () => {
        // Forward is -z; a quarter turn to the left is -x, and a tilt up is +y.
        const rotate = (q: { w: number; x: number; y: number; z: number }, v: [number, number, number]) => {
            const [x, y, z] = v, tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
            return [x + q.w * tx + (q.y * tz - q.z * ty), y + q.w * ty + (q.z * tx - q.x * tz), z + q.w * tz + (q.x * ty - q.y * tx)];
        };
        const left = rotate(yawRotation(90), [0, 0, -1]);
        expect(left[0]).toBeCloseTo(-1);
        const up = rotate(pitchRotation(90), [0, 0, -1]);
        expect(up[1]).toBeCloseTo(1);
    });
});

describe('walking', () => {
    it('goes the way it faces, and strafes to its right', () => {
        const forward = walkDirection({ x: 0, y: 1 }, 0);
        expect(forward.z).toBeCloseTo(-1);
        const right = walkDirection({ x: 1, y: 0 }, 0);
        expect(right.x).toBeCloseTo(1);
        // Turned a quarter to the left, forward is -x and right is -z... that is, +z reversed: right of -x is -z.
        const turned = walkDirection({ x: 0, y: 1 }, 90);
        expect(turned.x).toBeCloseTo(-1);
        expect(turned.z).toBeCloseTo(0, 6);
        expect(walkDirection({ x: 1, y: 0 }, 90).z).toBeCloseTo(-1);
    });

    it('is still when nothing is asked, and a unit when it is', () => {
        expect(walkDirection({ x: 0, y: 0 }, 33)).toEqual({ x: 0, z: 0 });
        const d = walkDirection({ x: 1, y: 1 }, 40);
        expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
    });
});

describe('crouching', () => {
    it('is crouched when asked, and kept down where there is no room to stand', () => {
        expect(crouchAfter(false, true, true)).toBe(true);
        expect(crouchAfter(true, false, true)).toBe(false);
        expect(crouchAfter(true, false, false)).toBe(true);
        expect(crouchAfter(false, false, false)).toBe(false);
    });
});

/** An input that holds the keys it is told to, and a pointer that has moved by what it is told. */
function fakeInput(keys: string[] = [], mouse = { x: 0, y: 0 }, pressedKeys: string[] = []) {
    const down = new Set(keys);
    const pressed = new Set(pressedKeys);
    return {
        isKeyDown: (k: string) => down.has(k),
        isKeyPressed: (k: string) => pressed.has(k),
        isMouseButtonDown: (b: number) => b === 0,
        isMouseButtonPressed: () => false,
        getMouseDelta: () => mouse,
        getTouches: () => [], getTouchesStarted: () => [], getTouchesEnded: () => [],
        down,
    } as never;
}

describe.skipIf(!HAS_WASM)('a first-person player in the engine world', () => {
    let engine: ESEngineModule, registry: CppRegistry, world: World;
    beforeAll(async () => { engine = await loadWasmModule(); });
    beforeEach(() => { registry = new engine.Registry(); world = new World(); world.connectCpp(registry, engine); });
    afterEach(() => { for (const e of world.getAllEntities()) world.despawn(e); world.disconnectCpp(); registry.delete(); });

    /** A body with a character controller and a camera under it. */
    function player(over: Partial<FirstPersonControllerData> = {}) {
        const body = world.spawn();
        world.insert(body, Transform);
        world.insert(body, CharacterController3D, { radius: 30, halfHeight: 90, enabled: true });
        const cam = world.spawn();
        world.insert(cam, Transform);
        world.insert(cam, Camera, {});
        world.insert(cam, Parent, { entity: body });
        world.insert(body, FirstPersonController, { pointerLock: false, touchLook: false, ...over });
        return { body, cam };
    }

    it('turns its body with the yaw and tilts its camera with the pitch, at the height of its eye', () => {
        const { body, cam } = player();
        // The pointer moves 100 right and 100 up, at 0.12 degrees a pixel.
        look(world, fakeInput([], { x: 100, y: -100 }), 1 / 60, new TouchLook());
        const d = world.get(body, FirstPersonController) as FirstPersonControllerData;
        expect(d.yaw).toBeCloseTo(-12);
        expect(d.pitch).toBeCloseTo(12);
        const turn = world.get(body, Transform).rotation;
        expect(turn.y).toBeCloseTo(Math.sin((-12 * Math.PI / 180) / 2), 4);
        const eye = world.get(cam, Transform);
        expect(eye.rotation.x).toBeCloseTo(Math.sin((12 * Math.PI / 180) / 2), 4);
        expect(eye.position.y).toBeCloseTo(70);
    });

    it('asks the character for a walk the way it faces, faster with sprint and slower crouched', () => {
        const { body } = player();
        move(world, fakeInput(['KeyW']), null, 1);
        const walk = world.get(body, CharacterController3D).velocity;
        expect(walk.z).toBeLessThan(0);
        expect(Math.abs(walk.z)).toBeLessThanOrEqual(320 + 1e-6);
        move(world, fakeInput(['KeyW', 'ShiftLeft']), null, 1);
        const run = world.get(body, CharacterController3D).velocity;
        expect(Math.abs(run.z)).toBeGreaterThan(Math.abs(walk.z));
    });

    it('crouches by making the capsule again at the new height with the feet where they were', () => {
        const { body } = player();
        world.update(body, Transform, (t: { position: { y: number } }) => { t.position.y = 100; });
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        let c = world.get(body, CharacterController3D);
        let d = world.get(body, FirstPersonController) as FirstPersonControllerData;
        expect(d.crouching).toBe(true);
        expect(c.halfHeight).toBe(45);
        // Let go for one step, and the centre is 45 lower: the feet (centre minus half height) are where they were.
        expect(c.enabled).toBe(false);
        expect(d.rebuild).toBe(1);
        expect(world.get(body, Transform).position.y).toBeCloseTo(55);
        // The next step makes it again.
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        c = world.get(body, CharacterController3D);
        d = world.get(body, FirstPersonController) as FirstPersonControllerData;
        expect(c.enabled).toBe(true);
        expect(d.rebuild).toBe(0);
    });

    it('stands up again when the key is let go, if there is room', () => {
        const { body } = player();
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        move(world, fakeInput([]), null, 1 / 60);
        expect((world.get(body, FirstPersonController) as FirstPersonControllerData).crouching).toBe(false);
        expect(world.get(body, CharacterController3D).halfHeight).toBe(90);
    });

    it('stays down under a low ceiling', () => {
        const { body } = player();
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        move(world, fakeInput(['ControlLeft']), null, 1 / 60);
        const blocked = { raycast: () => ({ distance: 1 }) } as never;
        move(world, fakeInput([]), blocked, 1 / 60);
        expect((world.get(body, FirstPersonController) as FirstPersonControllerData).crouching).toBe(true);
    });

    // The original's feel (Saltline: coyote 0.12 s, buffer 0.13 s, a player falling at 21 m/s² in a 9.81 world).
    const airborne = (body: number, over: Partial<FirstPersonControllerData>) => {
        world.update(body, CharacterController3D, (c: { isOnFloor: boolean; realVelocity: { x: number; y: number; z: number } }) => { c.isOnFloor = false; c.realVelocity = { x: 0, y: 0, z: 0 }; });
        world.update(body, FirstPersonController, (c: FirstPersonControllerData) => Object.assign(c, over));
    };
    const vy = (body: number) => (world.get(body, CharacterController3D) as { velocity: { y: number } }).velocity.y;

    it('still jumps just after walking off an edge, and not once the coyote time is gone', () => {
        const { body } = player({ coyoteTime: 0.1 });
        airborne(body, { airTime: 0.05, jumped: false });
        move(world, fakeInput(['Space'], undefined, ['Space']), null, 1 / 60);
        expect(vy(body)).toBe(420);
        airborne(body, { airTime: 0.3, jumped: false, jumpHeld: 0 });
        move(world, fakeInput(['Space'], undefined, ['Space']), null, 1 / 60);
        expect(vy(body)).toBe(0);
    });

    it('keeps a jump pressed just before landing and takes off as it lands', () => {
        const { body } = player({ jumpBuffer: 0.12 });
        airborne(body, { airTime: 1, jumped: true });
        move(world, fakeInput([], undefined, ['Space']), null, 1 / 60);
        expect(vy(body)).toBe(0);
        world.update(body, CharacterController3D, (c: { isOnFloor: boolean }) => { c.isOnFloor = true; });
        move(world, fakeInput(), null, 1 / 60);
        expect(vy(body)).toBe(420);
    });

    it("falls by its own gravity when it has one: twice the world's, from what it really moved at", () => {
        const { body } = player({ gravityScale: 2 });
        airborne(body, { airTime: 0.5, jumped: true });
        world.update(body, CharacterController3D, (c: { realVelocity: { y: number } }) => { c.realVelocity.y = -100; });
        move(world, fakeInput(), null, 0.5, -981);
        expect(vy(body)).toBeCloseTo(-100 - 981 * 2 * 0.5);
        const { body: plain } = player();
        airborne(plain, { airTime: 0.5, jumped: true });
        move(world, fakeInput(), null, 0.5, -981);
        expect(vy(plain)).toBe(0);   // scale 1: the solver carries the fall, as it always did
    });

    it('draws what is held by a second camera over the world\'s, and keeps the world\'s from drawing it', () => {
        const systems: Array<{ _fn: () => void }> = [];
        installViewModels({ world, addSystemToSchedule: (_s: unknown, def: { _fn: () => void }) => { systems.push(def); } } as never);
        const { cam } = player();
        world.insert(cam, FirstPersonViewModel, { layer: 20, fov: 55, nearPlane: 2, farPlane: 800 });
        for (const s of systems) s._fn();
        const mask = (1 << 20) >>> 0;
        const kids = (world.get(cam, Children) as { entities: number[] }).entities;
        const held = kids.find((k) => world.has(k as never, Camera) && (world.get(k as never, Camera) as { cullingMask: number }).cullingMask === mask)!;
        expect(held).toBeDefined();
        const own = world.get(held as never, Camera) as { projectionType: number; fov: number; nearPlane: number; priority: number; clearFlags: number };
        // Perspective, whatever a new camera starts as.
        expect(own.projectionType).toBe(0);
        expect(own.fov).toBeCloseTo(55);
        expect(own.nearPlane).toBeCloseTo(2);
        expect(own.priority).toBe((world.get(cam, Camera) as { priority: number }).priority + 1);
        // Depth only, so the world stays under it.
        expect(own.clearFlags).toBe(2);
        expect(((world.get(cam, Camera) as { cullingMask: number }).cullingMask & mask) >>> 0).toBe(0);
    });
});
