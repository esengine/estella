// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The camera pipeline's dolly and noise: a camera rides its track where its mode puts it, through its parent, and its
 *        noise drifts the drawn view smoothly without touching its Transform.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Camera, Parent, ProjectionType, ClearFlags } from '../src/ecs/component';
import { Spline } from '../src/spline/splineComponent';
import { CameraDolly, DollyMode, dollyStep, dollyUpdate } from '../src/camera/CameraDolly';
import { CameraNoise, applyCameraNoise, cameraNoiseAt, noisyPOV, type CameraNoiseData } from '../src/camera/CameraNoise';
import { FollowTarget, followUpdate } from '../src/camera/FollowTarget';
import type { CameraPOV } from '../src/camera/CameraPlugin';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

const ORIGIN = { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } };

describe('dollyStep', () => {
  it('goes the short way round a closed track across its seam', () => {
    expect(dollyStep(95, 5, 100, true, 0, 1)).toBe(5);
    expect(dollyStep(95, 5, 100, true, 1, 1)).toBeCloseTo((95 + 10 * (1 - Math.exp(-1))) % 100, 9);
    // And backwards: from 5 to 95 is ten back across the seam, not ninety forward.
    expect(dollyStep(5, 95, 100, true, 1, 1)).toBeCloseTo(100 + 5 - 10 * (1 - Math.exp(-1)), 9);
  });

  it('stops at the ends of an open track', () => {
    expect(dollyStep(50, 140, 100, false, 0, 1)).toBe(100);
    expect(dollyStep(50, -10, 100, false, 0, 1)).toBe(0);
  });
});

describe('dollyUpdate', () => {
  let world: World;
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
  });

  /** A straight track along x from -500 to 500, 600 units in front of the origin, and a camera on it. */
  const rig = (dolly: Partial<typeof CameraDolly._default>, closed = false) => {
    const track = world.spawn('track');
    world.insert(track, Transform, { ...ORIGIN, worldScale: { x: 1, y: 1, z: 1 } });
    world.insert(track, Spline, {
      points: closed
        ? [{ x: -500, y: 0, z: 0, width: 1 }, { x: 500, y: 0, z: 0, width: 1 }, { x: 500, y: 0, z: 400, width: 1 }, { x: -500, y: 0, z: 400, width: 1 }]
        : [{ x: -500, y: 0, z: 0, width: 1 }, { x: 0, y: 0, z: 0, width: 1 }, { x: 500, y: 0, z: 0, width: 1 }],
      closed,
    });
    const cam = world.spawn('camera');
    world.insert(cam, Transform, { ...ORIGIN });
    world.insert(cam, CameraDolly, { spline: track, damping: 0, ...dolly });
    return { track, cam };
  };
  const at = (e: Entity) => world.get(e, Transform);

  it('stands at its position along the track, in world units from the start', () => {
    const { cam } = rig({ mode: DollyMode.Fixed, position: 250 });
    dollyUpdate(world, 1 / 60);
    expect(at(cam).position.x).toBeCloseTo(-250, 3);
  });

  it('keeps level with a target, moved along by its offset, and says where it is', () => {
    const runner = world.spawn('runner');
    world.insert(runner, Transform, { position: { x: 120, y: 0, z: -600 }, worldPosition: { x: 120, y: 0, z: -600 } });
    const { cam } = rig({ mode: DollyMode.TrackTarget, target: runner, offset: 30 });
    dollyUpdate(world, 1 / 60);
    expect(at(cam).position.x).toBeCloseTo(150, 2);
    // Written beside the local value, so the rotation stage reads where the camera is this frame.
    expect(at(cam).worldPosition.x).toBeCloseTo(150, 2);
    expect(world.get(cam, CameraDolly).position).toBeCloseTo(650, 2);
  });

  it('runs round a closed track at its speed and comes back to the start', () => {
    const { cam } = rig({ mode: DollyMode.Speed, speed: 100 }, true);
    for (let i = 0; i < 10; i++) dollyUpdate(world, 1);
    const length = 1000 + 400 * 2 + 1000;
    const place = world.get(cam, CameraDolly).position;
    expect(place).toBeGreaterThan(0);
    expect(place).toBeLessThan(length);
    for (let i = 0; i < 100; i++) dollyUpdate(world, 1);
    expect(world.get(cam, CameraDolly).position).toBeLessThan(length);
  });

  it('puts a camera under a parent where the track is in the world', () => {
    const { cam } = rig({ mode: DollyMode.Fixed, position: 500 });
    const holder = world.spawn('holder');
    world.insert(holder, Transform, { position: { x: 100, y: 20, z: 0 }, worldPosition: { x: 100, y: 20, z: 0 } });
    world.insert(cam, Parent, { entity: holder });
    dollyUpdate(world, 1 / 60);
    expect(at(cam).worldPosition.x).toBeCloseTo(0, 3);
    expect(at(cam).position.x).toBeCloseTo(-100, 3);
    expect(at(cam).position.y).toBeCloseTo(-20, 3);
  });

  it('applies a FollowTarget offset in the world under a parent too', () => {
    const player = world.spawn('player');
    world.insert(player, Transform, { position: { x: 300, y: 0, z: 0 }, worldPosition: { x: 300, y: 0, z: 0 } });
    const holder = world.spawn('holder');
    world.insert(holder, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 }, worldScale: { x: 2, y: 2, z: 2 } });
    const cam = world.spawn('camera');
    world.insert(cam, Transform, { ...ORIGIN });
    world.insert(cam, Parent, { entity: holder });
    world.insert(cam, FollowTarget, { target: player, offsetX: 40, damping: 0 });
    followUpdate(world, 1 / 60);
    expect(at(cam).worldPosition.x).toBeCloseTo(340, 6);
    // Halved into the parent's space, which is scaled by two.
    expect(at(cam).position.x).toBeCloseTo(170, 6);
  });
});

describe('cameraNoiseAt', () => {
  it('stays within [-1, 1], moves smoothly, and is the same for the same input', () => {
    let previous = cameraNoiseAt(3, 0, 0, 0.5);
    let largest = 0;
    for (let i = 1; i <= 4000; i++) {
      const t = i / 120;
      const v = cameraNoiseAt(3, 0, t, 0.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      largest = Math.max(largest, Math.abs(v - previous));
      previous = v;
    }
    // A step of 1/120 s at 0.5 Hz moves the value a little, never a jump.
    expect(largest).toBeLessThan(0.05);
    expect(cameraNoiseAt(3, 2, 7.25, 0.5)).toBe(cameraNoiseAt(3, 2, 7.25, 0.5));
  });

  it('gives each channel and each seed its own drift, and drifts across most of its range', () => {
    const series = (seed: number, channel: number) => Array.from({ length: 600 }, (_, i) => cameraNoiseAt(seed, channel, i / 10, 0.5));
    const a = series(1, 0), b = series(2, 0), c = series(1, 1);
    const differs = (x: number[], y: number[]) => x.some((v, i) => Math.abs(v - y[i]!) > 0.1);
    expect(differs(a, b)).toBe(true);
    expect(differs(a, c)).toBe(true);
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.8);
  });
});

const mkPOV = (over: Partial<CameraPOV>): CameraPOV => ({
  entity: 7, isActive: true, x: 10, y: 20, z: 30, rotation: 0,
  projection: ProjectionType.Perspective, orthoSize: 100, fov: 60, near: 1, far: 1000,
  viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: ClearFlags.ColorAndDepth, priority: 0, ...over,
}) as CameraPOV;
const noise = (over: Partial<CameraNoiseData>): CameraNoiseData => ({ amplitude: 0, rotation: 0, frequency: 0.5, seed: 0, ...over });

describe('noisyPOV', () => {
  it('leaves a camera with no amplitude where it is', () => {
    const pov = mkPOV({});
    expect(noisyPOV(pov, noise({}), 7, 3.3)).toBe(pov);
  });

  it('drifts a turned camera in its own frame: the offset turns with the camera', () => {
    const facingX = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
    const straight = noisyPOV(mkPOV({}), noise({ amplitude: 10 }), 7, 3.3);
    const turned = noisyPOV(mkPOV({ tilt: facingX }), noise({ amplitude: 10 }), 7, 3.3);
    // The same drift, seen from a camera turned a quarter about up: its along-the-view z became world -x.
    expect(turned.x - 10).toBeCloseTo(straight.z - 30, 6);
    expect(turned.y - 20).toBeCloseTo(straight.y - 20, 6);
  });

  it('turns the view by about its rotation and no more', () => {
    for (let i = 0; i < 50; i++) {
      const q = noisyPOV(mkPOV({}), noise({ rotation: 2 }), 7, i * 0.37).tilt!;
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      expect(angle).toBeLessThanOrEqual((2 * Math.sqrt(3) * Math.PI) / 180 + 1e-9);
    }
  });

  it('drifts a 2D camera across the screen and rolls it, and gives it no tilt', () => {
    const flat = noisyPOV(mkPOV({ projection: ProjectionType.Orthographic }), noise({ amplitude: 10, rotation: 2 }), 7, 3.3);
    expect(flat.tilt).toBeUndefined();
    expect(flat.z).toBe(30);
    expect(Math.abs(flat.x - 10) + Math.abs(flat.y - 20)).toBeGreaterThan(0);
  });
});

describe('applyCameraNoise', () => {
  it('moves the view a camera gives and never its Transform', () => {
    const world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    const cam = world.spawn('camera');
    world.insert(cam, Transform, { position: { x: 10, y: 20, z: 30 }, worldPosition: { x: 10, y: 20, z: 30 } });
    world.insert(cam, Camera, { projectionType: ProjectionType.Perspective, isActive: true });
    world.insert(cam, CameraNoise, { amplitude: 10, rotation: 1, frequency: 0.5 });
    const povs = [mkPOV({ entity: cam })];
    applyCameraNoise(world, povs, 3.3);
    expect(povs[0]!.x !== 10 || povs[0]!.y !== 20 || povs[0]!.z !== 30).toBe(true);
    expect(world.get(cam, Transform).position).toEqual({ x: 10, y: 20, z: 30 });
  });
});
