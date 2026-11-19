// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The camera pipeline: a camera's aim holds its target where the shot puts it, the brain blends into a camera
 *        that becomes live, and the stages run position before rotation. Pure logic, WASM-free.
 */
import { describe, it, expect, vi } from 'vitest';
import { aimStep, screenPointOf, yawPitchOf, aimLens, type LookAtTargetData } from '../src/camera/LookAtTarget';
import { BlendCurve, createDirectorState, resolveMainPOV, setViewTarget } from '../src/camera/CameraDirector';
import type { CameraPOV } from '../src/camera/CameraPlugin';
import { ProjectionType, ClearFlags } from '../src/ecs/component';

const LENS = aimLens(60, 16 / 9);
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const aim = (over: Partial<LookAtTargetData> = {}): LookAtTargetData => ({
  target: 1, offsetX: 0, offsetY: 0, offsetZ: 0, screenX: 0.5, screenY: 0.5, deadzoneWidth: 0, deadzoneHeight: 0, damping: 0, ...over,
});
const seen = (eye: { x: number; y: number; z: number }, q: typeof IDENTITY, point: { x: number; y: number; z: number }) => {
  const { yaw, pitch } = yawPitchOf(q);
  return screenPointOf(eye, yaw, pitch, point, LENS)!;
};

describe('LookAtTarget: where the target sits on screen', () => {
  const eye = { x: 0, y: 2, z: 10 };

  it('puts the target at the centre, from anywhere around it', () => {
    for (const point of [{ x: 0, y: 0, z: 0 }, { x: 30, y: -4, z: 5 }, { x: -6, y: 12, z: 40 }, { x: 3, y: 2, z: 10.5 }]) {
      const q = aimStep(eye, IDENTITY, point, LENS, aim(), 1 / 60)!;
      const at = seen(eye, q, point);
      expect(at.x).toBeCloseTo(0.5, 4);
      expect(at.y).toBeCloseTo(0.5, 4);
    }
  });

  it('holds it off centre where the shot asks, on both axes at once', () => {
    const point = { x: 5, y: 1, z: -20 };
    const q = aimStep(eye, IDENTITY, point, LENS, aim({ screenX: 0.3, screenY: 0.7 }), 1 / 60)!;
    const at = seen(eye, q, point);
    expect(at.x).toBeCloseTo(0.3, 3);
    expect(at.y).toBeCloseTo(0.7, 3);
  });

  it('never rolls: the turned camera keeps its right on the ground plane', () => {
    const q = aimStep(eye, IDENTITY, { x: 20, y: 15, z: -8 }, LENS, aim({ screenX: 0.2, screenY: 0.8 }), 1 / 60)!;
    const rightY = 2 * (q.x * q.y + q.w * q.z);
    expect(rightY).toBeCloseTo(0, 6);
  });

  it('leaves the camera alone while the target moves inside the dead zone, and turns it only back to the zone edge', () => {
    const point = { x: 0, y: 2, z: 0 };
    const centred = aimStep(eye, IDENTITY, point, LENS, aim(), 1 / 60)!;
    const zone = aim({ deadzoneWidth: 0.2, deadzoneHeight: 0.2 });
    const inside = { x: 0.8, y: 2, z: 0 };
    expect(seen(eye, centred, inside).x).toBeLessThan(0.6);
    expect(aimStep(eye, centred, inside, LENS, zone, 1 / 60)).toBe(centred);
    const outside = { x: 4, y: 2, z: 0 };
    const turned = aimStep(eye, centred, outside, LENS, zone, 1 / 60)!;
    expect(seen(eye, turned, outside).x).toBeCloseTo(0.6, 3);
  });

  it('catches up over its damping time, the same at any frame rate', () => {
    const point = { x: 10, y: 2, z: 0 };
    const slow = aim({ damping: 0.5 });
    const turnAfter = (steps: number) => {
      let q = IDENTITY;
      for (let i = 0; i < steps; i++) q = aimStep(eye, q, point, LENS, slow, 0.5 / steps)!;
      return yawPitchOf(q).yaw;
    };
    const full = yawPitchOf(aimStep(eye, IDENTITY, point, LENS, aim(), 1)!).yaw;
    // After one damping time it has turned 1 - 1/e of the way, whether in one step or thirty.
    expect(turnAfter(1) / full).toBeCloseTo(1 - Math.exp(-1), 3);
    expect(turnAfter(30) / full).toBeCloseTo(1 - Math.exp(-1), 2);
  });

  it('turns to a target behind it the short way, and has nothing to aim at from inside the point', () => {
    const behind = { x: 0, y: 2, z: 30 };
    const q = aimStep(eye, IDENTITY, behind, LENS, aim(), 1 / 60)!;
    expect(seen(eye, q, behind).x).toBeCloseTo(0.5, 4);
    expect(aimStep(eye, IDENTITY, eye, LENS, aim(), 1 / 60)).toBeNull();
  });
});

const mkPOV = (entity: number, over: Partial<CameraPOV> = {}): CameraPOV => ({
  entity, isActive: false, x: entity * 100, y: 0, z: 0, rotation: 0,
  projection: ProjectionType.Perspective, orthoSize: 100, fov: 60, near: 1, far: 1000,
  viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: ClearFlags.ColorAndDepth, priority: 0, ...over,
}) as CameraPOV;

describe('CameraBrain: changing the live camera', () => {
  const low = mkPOV(1, { priority: 1 });
  const high = mkPOV(2, { priority: 5 });

  it('cuts when the scene has no brain, as before', () => {
    const d = createDirectorState();
    expect(resolveMainPOV(d, [low], 0, true)!.x).toBe(100);
    expect(resolveMainPOV(d, [low, high], 0.1, true)!.x).toBe(200);
  });

  it('blends into a camera that becomes live by priority, over the default blend', () => {
    const d = createDirectorState();
    d.defaultBlend = 1;
    d.defaultCurve = BlendCurve.Linear;
    resolveMainPOV(d, [low], 0, true);
    resolveMainPOV(d, [low, high], 1, true);
    expect(resolveMainPOV(d, [low, high], 1.5, true)!.x).toBeCloseTo(150, 6);
    expect(resolveMainPOV(d, [low, high], 2, true)!.x).toBe(200);
  });

  it('blends from where the view is when the live camera changes again mid-blend, and does not jump', () => {
    const d = createDirectorState();
    d.defaultBlend = 1;
    d.defaultCurve = BlendCurve.Linear;
    resolveMainPOV(d, [low], 0, true);
    resolveMainPOV(d, [low, high], 1, true);
    const mid = resolveMainPOV(d, [low, high], 1.5, true)!.x;
    const back = resolveMainPOV(d, [low, { ...high, priority: 0 }], 1.5, true)!.x;
    expect(back).toBeCloseTo(mid, 6);
    expect(resolveMainPOV(d, [low, { ...high, priority: 0 }], 2.5, true)!.x).toBe(100);
  });

  it('lets a setViewTarget keep its own blend', () => {
    const d = createDirectorState();
    d.defaultBlend = 5;
    d.defaultCurve = BlendCurve.Linear;
    resolveMainPOV(d, [low, high], 0, true);
    setViewTarget(d, 1, { time: 1, curve: BlendCurve.Linear });
    resolveMainPOV(d, [low, high], 1, true);
    expect(resolveMainPOV(d, [low, high], 1.5, true)!.x).toBeCloseTo(150, 6);
    expect(resolveMainPOV(d, [low, high], 2, true)!.x).toBe(100);
  });
});

describe('a camera aim and follow authored in a scene', () => {
  it('reach the entity the target loads as, and read a -1 from an older scene as none', async () => {
    const { remapEntityFields } = await import('../src/scene/scene');
    await import('../src/camera/LookAtTarget');
    await import('../src/camera/FollowTarget');
    const map = new Map<number, number>([[7, 4242]]);
    const aimed = { type: 'LookAtTarget', data: { target: 7 } };
    const followed = { type: 'FollowTarget', data: { target: 7 } };
    const older = { type: 'FollowTarget', data: { target: -1 } };
    remapEntityFields(aimed as never, map as never);
    remapEntityFields(followed as never, map as never);
    remapEntityFields(older as never, map as never);
    expect(aimed.data.target).toBe(4242);
    expect(followed.data.target).toBe(4242);
    expect(older.data.target).toBe(0);
  });
});

describe('lookAtUpdate on a world', () => {
  const setup = async (rotation: { x: number; y: number; z: number; w: number }) => {
    const { World } = await import('../src/ecs/world');
    const { Transform, Camera } = await import('../src/ecs/component');
    const { LookAtTarget, lookAtUpdate } = await import('../src/camera/LookAtTarget');
    const { createMockModule } = await import('./mocks/wasm');
    const world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    const target = world.spawn('target');
    world.insert(target, Transform, { position: { x: 300, y: 120, z: -600 }, worldPosition: { x: 300, y: 120, z: -600 } });
    const cam = world.spawn('camera');
    world.insert(cam, Transform, { rotation, worldRotation: rotation });
    world.insert(cam, Camera, { projectionType: ProjectionType.Perspective, fov: 60, isActive: true });
    world.insert(cam, LookAtTarget, { target, damping: 0 });
    return { world, cam, Transform, step: () => lookAtUpdate(world, 1 / 60, 1) };
  };
  const length = (q: { x: number; y: number; z: number; w: number }) => Math.hypot(q.x, q.y, q.z, q.w);

  it('keeps the rotation a unit one over many frames when what is stored is a float off it', async () => {
    // A 32-bit store leaves a quaternion a hair off unit length; read back as parent * local, the hair was squared each
    // frame until the view was a rotation of length 1e29 and nothing was drawn.
    const { world, cam, Transform, step } = await setup({ x: 0, y: 0, z: 0, w: 1.0001 });
    for (let i = 0; i < 300; i++) step();
    const q = world.get(cam, Transform).rotation;
    expect(length(q)).toBeCloseTo(1, 4);
    expect(Number.isFinite(q.w)).toBe(true);
  });

  it('writes the Transform once the camera is aimed, and not again every frame', async () => {
    const { world, step } = await setup({ x: 0, y: 0, z: 0, w: 1 });
    step();
    const writes = vi.spyOn(world, 'set');
    step();
    step();
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('CameraBrain custom blends by name', () => {
  it('turns camera names into entities, an empty name into any, and drops a blend naming no entity', async () => {
    const { World } = await import('../src/ecs/world');
    const { Name } = await import('../src/ecs/component');
    const { resolveCustomBlends } = await import('../src/camera/CameraRig');
    const { createMockModule } = await import('./mocks/wasm');
    const world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    const wide = world.spawn('wide'); world.insert(wide, Name, { value: 'Wide' });
    const close = world.spawn('close'); world.insert(close, Name, { value: 'Close' });
    const blends = [
      { from: 'Wide', to: 'Close', time: 2, curve: 0 },
      { from: '', to: 'Wide', time: 0.5, curve: 3 },
      { from: 'Nobody', to: 'Close', time: 9, curve: 0 },
    ];
    expect(resolveCustomBlends(world, blends)).toEqual([
      { from: wide, to: close, time: 2, curve: 0 },
      { from: -1, to: wide, time: 0.5, curve: 3 },
    ]);
    // A camera that takes the missing name later is found then.
    const late = world.spawn('late'); world.insert(late, Name, { value: 'Nobody' });
    expect(resolveCustomBlends(world, blends)).toContainEqual({ from: late, to: close, time: 9, curve: 0 });
    // Renamed: looked up again, not answered from what it was.
    world.insert(wide, Name, { value: 'Far' });
    expect(resolveCustomBlends(world, blends).some((b) => b.from === wide || b.to === wide)).toBe(false);
  });
});
