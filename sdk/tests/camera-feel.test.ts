/**
 * @file  The third-person view a fight is played through: over the shoulder and off the wall beside it, in at once and
 *        back out eased, locked onto a foe and turning to keep it ahead, wider while sprinting, swinging round behind a
 *        character left to run, and thrown by a blow.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    ThirdPersonController, ThirdPersonCamera, updateCameras, observeMotion, requestMotion, pickLockTarget,
    Health, Damage, GameplayPlugin, LOCK_KEY, DODGE_KEY,
    type ThirdPersonControllerData, type ThirdPersonCameraData, type DamagePayload,
} from '../src/gameplay';
import { CharacterController3D, type CharacterController3DData } from '../src/physics3d/Physics3DComponents';
import { Transform, Camera, type TransformData } from '../src/ecs/component';
import { App } from '../src/app/app';
import { defineSystem, Schedule } from '../src/ecs/system';
import { EventWriter, type EventWriterInstance } from '../src/ecs/event';
import { CameraDirector, createDirectorState } from '../src/camera/CameraDirector';
import { yawOfQuaternion } from '../src/gameplay';
import type { Entity } from '../src/types';

const PLAYER = 1, CAMERA = 2, FOE = 3;
const DT = 1 / 60;

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
        valid(e: number) { return e > 0; },
        update(e: number, c: unknown, edit: (d: any) => void) { edit(mapOf(c).get(e)); },
        getEntitiesWithComponents(comps: unknown[]) {
            const [first, ...rest] = comps;
            return [...mapOf(first).keys()].filter(e => rest.every(c => mapOf(c).has(e)));
        },
    } as any;
}

function keys(held: string[] = [], pressed: string[] = [], pointer = { x: 0, y: 0 }, dragging = false) {
    const down = new Set(held), edge = new Set(pressed);
    return {
        isKeyDown: (k: string) => down.has(k),
        isKeyPressed: (k: string) => edge.has(k),
        getMousePosition: () => pointer,
        isMouseButtonDown: () => dragging,
    } as any;
}

const at = (x: number, y: number, z: number): TransformData => ({
    position: { x, y, z }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
} as TransformData);

function scene(over: Partial<ThirdPersonCameraData> = {}) {
    const world = makeWorld();
    world.insert(PLAYER, Transform, at(0, 0, 0));
    world.insert(PLAYER, CharacterController3D, {
        velocity: { x: 0, y: 0, z: 0 }, realVelocity: { x: 0, y: 0, z: 0 }, isOnFloor: true, floorNormal: { x: 0, y: 1, z: 0 }, enabled: true,
    } as unknown as CharacterController3DData);
    world.insert(PLAYER, ThirdPersonController, {
        moveSpeed: 4, acceleration: 1e6, deceleration: 1e6, rotationSpeed: 1e6, jumpSpeed: 0, airControl: 1,
        cameraRelative: true, camera: CAMERA as Entity, idleThreshold: 0.1, enabled: true, sprintSpeed: 8,
    } as ThirdPersonControllerData);
    world.insert(CAMERA, Transform, at(0, 0, 0));
    world.insert(CAMERA, ThirdPersonCamera, {
        target: PLAYER as Entity, distance: 6, yaw: 0, pitch: 0, minPitch: -30, maxPitch: 70, sensitivity: 0.2,
        followDamping: 0, targetOffset: { x: 0, y: 0, z: 0 }, obstruction: true, obstructionRadius: 0.2, obstructionLayers: 0,
        enabled: true, ...over,
    } as ThirdPersonCameraData);
    return world;
}

const eye = (world: any) => (world.get(CAMERA, Transform) as TransformData).position;
const view = (world: any) => world.get(CAMERA, ThirdPersonCamera) as ThirdPersonCameraData;
const noWall = { sphereCast: () => null } as any;
/** A wall halfway along every sweep that goes sideways (no y, across z), and nothing behind. */
const wallBeside = { sphereCast: (_o: unknown, _r: number, d: { x: number; y: number; z: number }) =>
    Math.abs(d.x) > Math.abs(d.z) ? { entity: 9, fraction: 0.5, x: 0, y: 0, z: 0, normalX: -1, normalY: 0, normalZ: 0 } : null } as any;
const wallBehind = { sphereCast: (_o: unknown, _r: number, d: { x: number; y: number; z: number }) =>
    Math.abs(d.z) > Math.abs(d.x) ? { entity: 9, fraction: 0.5, x: 0, y: 0, z: 0, normalX: 0, normalY: 0, normalZ: -1 } : null } as any;

describe('over the shoulder', () => {
    it('sits aside of the target by its shoulder', () => {
        const world = scene({ shoulder: 0.6 });
        updateCameras(world, keys(), noWall, DT);
        expect(eye(world).x).toBeCloseTo(0.6, 5);
        expect(eye(world).z).toBeCloseTo(6, 5);
    });

    it('draws in when a wall stands beside it', () => {
        const world = scene({ shoulder: 0.6 });
        updateCameras(world, keys(), wallBeside, DT);
        expect(eye(world).x).toBeCloseTo(0.3, 5);
    });
});

describe('in at once, out eased', () => {
    it('pulls in the frame something stands between, and goes back out over time', () => {
        const world = scene({ recoverDamping: 4 });
        updateCameras(world, keys(), wallBehind, DT);
        expect(eye(world).z).toBeCloseTo(3, 5);
        updateCameras(world, keys(), noWall, DT);
        expect(eye(world).z).toBeGreaterThan(3);
        expect(eye(world).z).toBeLessThan(3.5);
        for (let i = 0; i < 120; i++) updateCameras(world, keys(), noWall, DT);
        expect(eye(world).z).toBeCloseTo(6, 1);
    });
});

describe('locked onto a foe', () => {
    const withFoe = (x: number, z: number, over: Partial<ThirdPersonCameraData> = {}) => {
        const world = scene({ lockRange: 10, lockTurnRate: 4.5, ...over });
        world.insert(FOE, Transform, at(x, 0, z));
        world.insert(FOE, Health, { current: 50, max: 50 });
        return world;
    };

    it('locks onto the foe ahead with the lock key, and not onto one behind', () => {
        expect(pickLockTarget(withFoe(0, -5), PLAYER as Entity, 0, 10)).toBe(FOE);
        expect(pickLockTarget(withFoe(0, 5), PLAYER as Entity, 0, 10)).toBeNull();
        const world = withFoe(1, -5);
        updateCameras(world, keys([LOCK_KEY], [LOCK_KEY]), noWall, DT);
        expect(view(world).lockTarget).toBe(FOE);
    });

    it('turns the view to keep the foe ahead, and the character to face it', () => {
        const world = withFoe(5, 0, { lockTarget: FOE as Entity });
        for (let i = 0; i < 180; i++) updateCameras(world, keys(), noWall, DT);
        // The view looks along +X: its eye stands at -X of the character.
        expect(eye(world).x).toBeCloseTo(-6, 1);
        observeMotion(world, null, DT);
        const facing = yawOfQuaternion((world.get(PLAYER, Transform) as TransformData).rotation);
        expect(facing).toBeCloseTo(-90, 0);
    });

    it('lets go when the foe goes down, and when the key is pressed again', () => {
        const world = withFoe(0, -5, { lockTarget: FOE as Entity });
        (world.get(FOE, Health) as { current: number }).current = 0;
        updateCameras(world, keys(), noWall, DT);
        expect(view(world).lockTarget).toBe(0);
        const again = withFoe(0, -5, { lockTarget: FOE as Entity });
        updateCameras(again, keys([LOCK_KEY], [LOCK_KEY]), noWall, DT);
        expect(view(again).lockTarget).toBe(0);
    });
});

describe('the field of view', () => {
    it('widens while the character sprints and narrows back, keeping the one the game set', () => {
        const world = scene({ sprintFov: 7, fovDamping: 5 });
        world.insert(CAMERA, Camera, { fov: 60 });
        for (let i = 0; i < 120; i++) {
            requestMotion(world, keys([DODGE_KEY, 'KeyW']), DT);
            updateCameras(world, keys(), noWall, DT);
        }
        expect((world.get(CAMERA, Camera) as { fov: number }).fov).toBeCloseTo(67, 1);
        for (let i = 0; i < 240; i++) {
            requestMotion(world, keys(['KeyW']), DT);
            updateCameras(world, keys(), noWall, DT);
        }
        expect((world.get(CAMERA, Camera) as { fov: number }).fov).toBeCloseTo(60, 3);
    });
});

describe('left alone', () => {
    it('swings round behind a character that is going somewhere, after its delay', () => {
        const world = scene({ recenterDelay: 0.5 });
        (world.get(PLAYER, CharacterController3D) as CharacterController3DData).realVelocity = { x: 4, y: 0, z: 0 };
        for (let i = 0; i < 20; i++) updateCameras(world, keys(), noWall, DT);
        expect(view(world).yaw).toBe(0);
        for (let i = 0; i < 400; i++) updateCameras(world, keys(), noWall, DT);
        expect(view(world).yaw).toBeCloseTo(-90, 0);
    });
});

describe('a blow throws the view', () => {
    const apps: App[] = [];
    afterEach(() => { for (const app of apps.splice(0)) app.quit(); });

    it('shakes the camera on whoever took it', async () => {
        const app = App.new();
        apps.push(app);
        app.insertResource(CameraDirector, createDirectorState());
        app.addPlugin(new GameplayPlugin());
        const player = app.world.spawn();
        app.world.insert(player, Health, { current: 100, max: 100 });
        const camera = app.world.spawn();
        app.world.insert(camera, ThirdPersonCamera, { ...(ThirdPersonCamera as any)._default, target: player, hitShake: 8 });
        let sent = false;
        app.addSystemToSchedule(Schedule.Update, defineSystem([EventWriter(Damage)], (w: EventWriterInstance<DamagePayload>) => {
            if (sent) return;
            sent = true;
            w.send({ target: player, source: 0 as Entity, amount: 10, x: 0, y: 0, z: 0 });
        }, { name: 'TestBlow' }));
        await app.tick(DT);
        await app.tick(DT);
        expect(app.getResource(CameraDirector).shakes.length).toBe(1);
        expect(app.getResource(CameraDirector).shakes[0]!.amplitude).toBe(8);
    });
});
