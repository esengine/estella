// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  CameraDeoccluder: a wall between a camera and what it frames draws the camera in, along the line to the target,
 *        and the camera comes back out to where its rig wants it once the wall is gone. Pure logic over a mock world, with
 *        a probe that stands in for physics.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform } from '../src/ecs/component';
import { CameraDeoccluder, deoccluderRestore, deoccluderUpdate, type CameraCollisionProbe } from '../src/camera/CameraDeoccluder';
import { FollowTarget, followUpdate } from '../src/camera/FollowTarget';
import { LookAtTarget } from '../src/camera/LookAtTarget';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

const at = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });

/** A wall across z = `z` (from x = -1000 to 1000), as a sweep from the target would meet it. */
const wallAt = (z: number | null): CameraCollisionProbe => ({
  sweep: (o, radius, d) => {
    if (z === null || d.z === 0) return null;
    const share = (z - radius - o.z) / d.z;
    return share >= 0 && share <= 1 ? share : null;
  },
});

describe('CameraDeoccluder', () => {
  let world: World;
  let hero: Entity;
  let cam: Entity;
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    hero = world.spawn('hero');
    world.insert(hero, Transform, at(0, 0, 0));
    cam = world.spawn('camera');
    world.insert(cam, Transform, at(0, 0, 600));
  });
  const where = () => world.get(cam, Transform).worldPosition;
  /** One frame of the stages the deoccluder takes part in, in the rig's order. */
  const frame = (probe: CameraCollisionProbe, dt = 1 / 60) => {
    deoccluderRestore(world);
    followUpdate(world, dt);
    deoccluderUpdate(world, dt, probe);
  };

  it('draws the camera in to just short of a wall between it and its target, along the line to it', () => {
    world.insert(cam, Transform, at(300, 0, 600));
    world.insert(cam, CameraDeoccluder, { target: hero, radius: 10, minimumDistance: 0, dampingWhenOccluded: 0 });
    frame(wallAt(200));
    const p = where();
    expect(p.z).toBeCloseTo(190, 4);
    // On the line from the target to where the rig put the camera: the target stays where the shot held it.
    expect(p.x / p.z).toBeCloseTo(300 / 600, 6);
  });

  it('leaves the camera where its rig put it when nothing is in the way, or no physics answers', () => {
    world.insert(cam, CameraDeoccluder, { target: hero });
    frame(wallAt(null));
    expect(where().z).toBe(600);
    deoccluderUpdate(world, 1 / 60, null);
    expect(where().z).toBe(600);
  });

  it('never draws the camera closer than its minimum distance', () => {
    world.insert(cam, CameraDeoccluder, { target: hero, radius: 0, minimumDistance: 80, dampingWhenOccluded: 0 });
    frame(wallAt(20));
    expect(where().z).toBeCloseTo(80, 6);
  });

  it('comes back out to where the rig wants it once the wall is gone, eased by its damping', () => {
    world.insert(cam, FollowTarget, { target: hero, offsetZ: 600, followZ: true, damping: 0 });
    world.insert(cam, CameraDeoccluder, { target: hero, radius: 0, minimumDistance: 0, dampingWhenOccluded: 0, damping: 0.5 });
    frame(wallAt(200));
    expect(where().z).toBeCloseTo(200, 4);
    // The follow stage works from the rig's place, not the pulled one: the camera is not walked in a frame at a time.
    frame(wallAt(200));
    expect(where().z).toBeCloseTo(200, 4);
    frame(wallAt(null), 0.5);
    const z = where().z;
    expect(z).toBeGreaterThan(200 + 400 * 0.6);
    expect(z).toBeLessThan(600);
    for (let i = 0; i < 20; i++) frame(wallAt(null), 0.5);
    expect(where().z).toBeCloseTo(600, 1);
  });

  it('keeps the place a script gives the camera instead of putting it back', () => {
    world.insert(cam, CameraDeoccluder, { target: hero, radius: 0, minimumDistance: 0 });
    frame(wallAt(200));
    world.insert(cam, Transform, at(0, 0, 400));
    deoccluderRestore(world);
    expect(where().z).toBe(400);
  });

  it('keeps the LookAtTarget\'s target, with its offset, in sight when it names none of its own', () => {
    world.insert(cam, LookAtTarget, { target: hero, offsetY: 100 });
    world.insert(cam, CameraDeoccluder, { radius: 0, minimumDistance: 0, dampingWhenOccluded: 0 });
    frame(wallAt(300));
    const p = where();
    expect(p.z).toBeCloseTo(300, 4);
    expect(p.y).toBeCloseTo(100 - 100 * (300 / 600), 4);
  });
});
