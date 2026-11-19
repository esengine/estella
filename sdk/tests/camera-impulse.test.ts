// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera impulses: a jolt fired at a place shakes the listening cameras by how near they are, on the channels they
 *        share, after it has travelled to them, and dies away. Pure logic over a mock world.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, ProjectionType, ClearFlags } from '../src/ecs/component';
import {
  CameraImpulseSource, CameraImpulseListener, fireImpulse, impulseSourceUpdate, applyCameraImpulses,
  impulseEnvelope, impulseAttenuation,
} from '../src/camera/CameraImpulse';
import type { CameraPOV } from '../src/camera/CameraPlugin';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

const pov = (entity: number, x: number): CameraPOV => ({
  entity, isActive: true, x, y: 0, z: 10, rotation: 0, projection: ProjectionType.Orthographic, orthoSize: 100, fov: 0,
  near: 0, far: 1000, viewport: { x: 0, y: 0, z: 1, w: 1 }, clearFlags: ClearFlags.ColorAndDepth, priority: 0,
});
const moved = (a: CameraPOV, b: CameraPOV) => Math.hypot(a.x - b.x, a.y - b.y);

describe('impulse shape', () => {
  it('rises through the attack, holds, and dies away through the decay', () => {
    expect(impulseEnvelope(-0.1, 0.1, 0.2, 0.5)).toBe(0);
    expect(impulseEnvelope(0.05, 0.1, 0.2, 0.5)).toBeCloseTo(0.5, 9);
    expect(impulseEnvelope(0.2, 0.1, 0.2, 0.5)).toBe(1);
    expect(impulseEnvelope(0.55, 0.1, 0.2, 0.5)).toBeCloseTo(0.25, 9);
    expect(impulseEnvelope(0.8, 0.1, 0.2, 0.5)).toBe(0);
  });
  it('is whole within the radius and fades to nothing across the dissipation', () => {
    expect(impulseAttenuation(50, 100, 200)).toBe(1);
    expect(impulseAttenuation(200, 100, 200)).toBeCloseTo(0.5, 9);
    expect(impulseAttenuation(300, 100, 200)).toBe(0);
  });
});

describe('fired impulses', () => {
  let world: World;
  let bomb: Entity, near: Entity, far: Entity, deaf: Entity;
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    bomb = world.spawn('bomb');
    world.insert(bomb, Transform, { position: { x: 0, y: 0, z: 0 }, worldPosition: { x: 0, y: 0, z: 0 } });
    world.insert(bomb, CameraImpulseSource, { amplitude: 30, rotation: 0, frequency: 6, attack: 0, sustain: 0.5, decay: 0.5, radius: 100, dissipation: 1000, channels: 1 });
    near = world.spawn('near'); world.insert(near, CameraImpulseListener, { channels: 1, gain: 1, use2DDistance: true });
    far = world.spawn('far'); world.insert(far, CameraImpulseListener, { channels: 1, gain: 1, use2DDistance: true });
    deaf = world.spawn('deaf'); world.insert(deaf, CameraImpulseListener, { channels: 2, gain: 1, use2DDistance: true });
  });

  /** The views of the three cameras at `t` seconds after the first draw, against where they stand. */
  const shaken = (t: number) => {
    const still = [pov(near, 50), pov(far, 900), pov(deaf, 50)];
    const views = still.map((p) => ({ ...p }));
    applyCameraImpulses(world, views, t);
    return still.map((p, i) => moved(p, views[i]!));
  };

  it('shakes a near camera hard, a far one a little, and one on another channel not at all', () => {
    expect(fireImpulse(world, bomb, 1)).toBe(true);
    shaken(0);
    let nearMost = 0, farMost = 0, deafMost = 0;
    for (let t = 0.02; t < 0.5; t += 0.02) {
      const [n, f, d] = shaken(t);
      nearMost = Math.max(nearMost, n!); farMost = Math.max(farMost, f!); deafMost = Math.max(deafMost, d!);
    }
    expect(nearMost).toBeGreaterThan(10);
    expect(farMost).toBeGreaterThan(0);
    expect(farMost).toBeLessThan(nearMost / 5);
    expect(deafMost).toBe(0);
  });

  it('is felt only once it has travelled to the camera', () => {
    world.insert(bomb, CameraImpulseSource, { ...world.get(bomb, CameraImpulseSource), propagationSpeed: 1000 });
    fireImpulse(world, bomb);
    shaken(0);
    // The far camera is 900 away: nothing before 0.9 s.
    let early = 0;
    for (let t = 0.02; t < 0.85; t += 0.02) early = Math.max(early, shaken(t)[1]!);
    expect(early).toBe(0);
    let later = 0;
    for (let t = 0.92; t < 1.3; t += 0.02) later = Math.max(later, shaken(t)[1]!);
    expect(later).toBeGreaterThan(0);
  });

  it('dies away and is forgotten, so a later frame is still', () => {
    fireImpulse(world, bomb);
    shaken(0);
    expect(shaken(5)).toEqual([0, 0, 0]);
  });

  it('fires from a source whose flag is set, and clears the flag', () => {
    world.insert(bomb, CameraImpulseSource, { ...world.get(bomb, CameraImpulseSource), fire: true });
    impulseSourceUpdate(world);
    expect(world.get(bomb, CameraImpulseSource).fire).toBe(false);
    shaken(0);
    expect(shaken(0.1)[0]).toBeGreaterThan(0);
  });

  it('answers false for an entity with no source', () => {
    expect(fireImpulse(world, near)).toBe(false);
  });
});
