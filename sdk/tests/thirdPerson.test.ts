// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: what the player asks for and what the character did are different
 * things, and only the second one reaches the animator or the transform.
 */
import { describe, it, expect } from 'vitest';
import {
    ThirdPersonController, ThirdPersonCamera, requestMotion, observeMotion, updateCameras,
    TPC_SPEED, TPC_GROUNDED, cameraGroundBasis, desiredDirection, approachVelocity,
    facingYaw, turnToward,
    type ThirdPersonControllerData, type ThirdPersonCameraData,
} from '../src/gameplay';
import { CharacterController3D, type CharacterController3DData } from '../src/physics3d/Physics3DComponents';
import { Animator, AnimatorControllerAPI, type AnimatorData } from '../src/animation';
import { Transform, type TransformData } from '../src/ecs/component';

const PLAYER = 1;
const CAMERA = 2;

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

/** A keyboard held down on the named keys, and a pointer that never moves. */
function stubInput(keys: string[] = [], pointer = { x: 0, y: 0 }, dragging = false) {
    const held = new Set(keys);
    return {
        isKeyDown: (k: string) => held.has(k),
        isKeyPressed: (k: string) => held.has(k),
        getMousePosition: () => pointer,
        isMouseButtonDown: () => dragging,
    } as any;
}

const transform = (): TransformData => ({
    position: { x: 0, y: 0, z: 0 },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
} as TransformData);

const character = (over: Partial<CharacterController3DData> = {}): CharacterController3DData => ({
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.3, halfHeight: 0.5, maxSlope: 0.87, layer: 0,
    stepHeight: 0.4, snapDown: 0.5, mass: 70, pushForce: 5000, enabled: true,
    isOnFloor: true, floorNormal: { x: 0, y: 1, z: 0 },
    realVelocity: { x: 0, y: 0, z: 0 },
    ...over,
} as CharacterController3DData);

const controller = (over: Partial<ThirdPersonControllerData> = {}): ThirdPersonControllerData => ({
    moveSpeed: 4, acceleration: 1000, deceleration: 1000, rotationSpeed: 720,
    jumpSpeed: 0, airControl: 0.3, cameraRelative: true, camera: 0 as never,
    idleThreshold: 0.1, enabled: true, ...over,
});

const camera = (over: Partial<ThirdPersonCameraData> = {}): ThirdPersonCameraData => ({
    target: PLAYER as never, distance: 6, yaw: 0, pitch: 0,
    minPitch: -30, maxPitch: 70, sensitivity: 0.2,
    followDamping: 0,
    targetOffset: { x: 0, y: 0, z: 0 },
    obstruction: true, obstructionRadius: 0.2, obstructionLayers: 0, enabled: true,
    ...over,
});

/** A player standing on the floor, with a camera at `yaw` looking at it. */
function scene(yaw = 0, over: Partial<ThirdPersonControllerData> = {}) {
    const world = makeWorld();
    world.insert(PLAYER, Transform, transform());
    world.insert(PLAYER, CharacterController3D, character());
    world.insert(PLAYER, ThirdPersonController, controller(over));
    world.insert(PLAYER, Animator, { controller: 'x', currentState: '', enabled: true } as AnimatorData);
    world.insert(CAMERA, Transform, transform());
    world.insert(CAMERA, ThirdPersonCamera, camera({ yaw }));
    return world;
}

const askedVelocity = (world: any) =>
    (world.get(PLAYER, CharacterController3D) as CharacterController3DData).velocity;

describe('the stick is read in the camera ground plane', () => {
    it('walks along -Z with the camera behind the player', () => {
        const world = scene(0);
        requestMotion(world, stubInput(['KeyW']), 1 / 60);

        const v = askedVelocity(world);
        expect(v.z).toBeCloseTo(-4, 5);
        expect(Math.abs(v.x)).toBeLessThan(1e-6);
    });

    it('walks along -X once the camera has turned a quarter', () => {
        const world = scene(90);
        requestMotion(world, stubInput(['KeyW']), 1 / 60);

        const v = askedVelocity(world);
        expect(v.x).toBeCloseTo(-4, 5);
        expect(Math.abs(v.z)).toBeLessThan(1e-5);
    });

    it('ignores camera pitch, so looking down does not walk into the floor', () => {
        // The basis is built from yaw alone; a steep pitch must not tilt it.
        const level = cameraGroundBasis(0);
        const direction = desiredDirection({ x: 0, y: 1 }, level);
        expect(direction.y).toBe(0);
        expect(direction.z).toBeCloseTo(-1, 6);
    });
});

describe('the animator hears what happened, not what was asked', () => {
    it('reports the speed the character reached', () => {
        const world = scene(0);
        const animator = new AnimatorControllerAPI();
        requestMotion(world, stubInput(['KeyW']), 1 / 60);
        // The physics step's answer: it moved at 3, not the 4 it asked for.
        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.z = -3;
        });
        observeMotion(world, animator, 1 / 60);

        expect(animator.getFloat(PLAYER, TPC_SPEED)).toBeCloseTo(3, 5);
    });

    it('says standing still when a wall takes the motion away', () => {
        const world = scene(0);
        const animator = new AnimatorControllerAPI();
        requestMotion(world, stubInput(['KeyW']), 1 / 60);

        // The stick is full: the character ASKED to move.
        expect(Math.hypot(askedVelocity(world).x, askedVelocity(world).z)).toBeCloseTo(4, 5);
        // And the world gave it nothing, which is what a wall does.
        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.x = 0; c.realVelocity.z = 0;
        });
        observeMotion(world, animator, 1 / 60);

        expect(animator.getFloat(PLAYER, TPC_SPEED)).toBe(0);
    });

    it('passes the floor contact through as it stands', () => {
        const world = scene(0);
        const animator = new AnimatorControllerAPI();
        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.isOnFloor = false;
        });
        observeMotion(world, animator, 1 / 60);
        expect(animator.getBool(PLAYER, TPC_GROUNDED)).toBe(false);
    });
});

describe('movement goes through the character controller', () => {
    it('asks for a velocity and moves no transform itself', () => {
        const world = scene(0);
        const before = { ...(world.get(PLAYER, Transform) as TransformData).position };
        requestMotion(world, stubInput(['KeyW']), 1 / 60);
        const after = (world.get(PLAYER, Transform) as TransformData).position;

        expect(after).toEqual(before);
        expect(askedVelocity(world).z).toBeCloseTo(-4, 5);
    });

    it('leaves the vertical alone so the controller keeps carrying it', () => {
        const world = scene(0);
        requestMotion(world, stubInput(['KeyW']), 1 / 60);
        expect(askedVelocity(world).y).toBe(0);
    });

    it('starts a jump only from the floor', () => {
        const world = scene(0, { jumpSpeed: 5 });
        requestMotion(world, stubInput(['Space']), 1 / 60);
        expect(askedVelocity(world).y).toBeCloseTo(5, 5);

        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.isOnFloor = false;
        });
        requestMotion(world, stubInput(['Space']), 1 / 60);
        expect(askedVelocity(world).y).toBe(0);
    });
});

describe('a centred stick stops the character', () => {
    it('decelerates to nothing', () => {
        const world = scene(0, { deceleration: 50 });
        requestMotion(world, stubInput(['KeyW']), 1 / 60);
        expect(Math.hypot(askedVelocity(world).x, askedVelocity(world).z)).toBeGreaterThan(0);

        for (let i = 0; i < 60; i++) requestMotion(world, stubInput([]), 1 / 60);
        expect(Math.hypot(askedVelocity(world).x, askedVelocity(world).z)).toBeCloseTo(0, 6);
    });

    it('keeps the heading it stopped at rather than snapping to world forward', () => {
        const world = scene(0);
        const animator = new AnimatorControllerAPI();
        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.x = -3;
        });
        observeMotion(world, animator, 1);
        const facing = { ...(world.get(PLAYER, Transform) as TransformData).rotation };

        world.update(PLAYER, CharacterController3D, (c: CharacterController3DData) => {
            c.realVelocity.x = 0;
        });
        observeMotion(world, animator, 1);
        expect((world.get(PLAYER, Transform) as TransformData).rotation).toEqual(facing);
    });
});

describe('the camera keeps out of walls', () => {
    const noWall = { sphereCast: () => null } as any;
    /** A wall halfway along whatever the camera sweeps. */
    const wallAtHalf = { sphereCast: () => ({ entity: 9, fraction: 0.5, x: 0, y: 0, z: 0,
                                              normalX: 0, normalY: 0, normalZ: 1 }) } as any;

    const cameraDistance = (world: any): number => {
        const p = (world.get(CAMERA, Transform) as TransformData).position;
        const t = (world.get(PLAYER, Transform) as TransformData).position;
        return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z);
    };

    it('sits at its full distance with nothing in the way', () => {
        const world = scene(0);
        updateCameras(world, stubInput(), noWall, 1 / 60);
        expect(cameraDistance(world)).toBeCloseTo(6, 4);
    });

    it('pulls in when something stands between', () => {
        const world = scene(0);
        updateCameras(world, stubInput(), wallAtHalf, 1 / 60);
        expect(cameraDistance(world)).toBeCloseTo(3, 4);
    });

    it('goes back out once the way is clear', () => {
        const world = scene(0);
        updateCameras(world, stubInput(), wallAtHalf, 1 / 60);
        expect(cameraDistance(world)).toBeCloseTo(3, 4);
        updateCameras(world, stubInput(), noWall, 1 / 60);
        expect(cameraDistance(world)).toBeCloseTo(6, 4);
    });

    it('moves the camera and never the character', () => {
        const world = scene(0);
        const before = { ...(world.get(PLAYER, Transform) as TransformData).position };
        updateCameras(world, stubInput(), wallAtHalf, 1 / 60);
        expect((world.get(PLAYER, Transform) as TransformData).position).toEqual(before);
    });
});

describe('the pure decisions', () => {
    it('accelerates and decelerates at their own rates', () => {
        const up = approachVelocity({ x: 0, z: 0 }, { x: 10, z: 0 }, 10, 1000, 0.1);
        expect(up.x).toBeCloseTo(1, 6);
        const down = approachVelocity({ x: 10, z: 0 }, { x: 0, z: 0 }, 10, 100, 0.1);
        expect(down.x).toBeCloseTo(0, 6);
    });

    it('faces along -Z at zero yaw', () => {
        expect(facingYaw({ x: 0, y: 0, z: -1 })).toBeCloseTo(0, 6);
        expect(facingYaw({ x: -1, y: 0, z: 0 })).toBeCloseTo(90, 6);
    });

    it('turns the short way across the seam', () => {
        expect(turnToward(170, -170, 3600, 1 / 60)).toBeCloseTo(-170, 6);
        expect(turnToward(170, -170, 60, 0.1)).toBeCloseTo(176, 6);
    });
});
