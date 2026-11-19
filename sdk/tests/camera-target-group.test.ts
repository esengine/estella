// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  CameraTargetGroup and GroupFraming: a group stands where its members are, and a camera framing it zooms or
 *        dollies so the box about them fills its share of the screen. Pure logic over a mock world.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { World } from '../src/ecs/world';
import { Transform, Camera, ProjectionType } from '../src/ecs/component';
import {
  CameraTargetGroup, GroupFraming, GroupCenter, FramingAdjustment, groupCenter, neededHalfHeight,
  targetGroupUpdate, groupFramingRestore, groupFramingUpdate,
} from '../src/camera/CameraTargetGroup';
import { FollowTarget, followUpdate } from '../src/camera/FollowTarget';
import type { Entity } from '../src/types';
import { createMockModule } from './mocks/wasm';

const at = (x: number, y: number, z: number) => ({ position: { x, y, z }, worldPosition: { x, y, z } });

describe('groupCenter', () => {
  const members = [{ at: { x: 0, y: 0, z: 0 }, weight: 1 }, { at: { x: 100, y: 0, z: 0 }, weight: 3 }, { at: { x: 40, y: 60, z: 0 }, weight: 0.5 }];
  it('stands in the middle of the box about the members, or at their weighted average', () => {
    expect(groupCenter(members, GroupCenter.Bounds)).toEqual({ x: 50, y: 30, z: 0 });
    const avg = groupCenter(members, GroupCenter.Average)!;
    expect(avg.x).toBeCloseTo((0 + 300 + 20) / 4.5, 9);
    expect(avg.y).toBeCloseTo(30 / 4.5, 9);
  });
  it('has nowhere to stand with no members', () => {
    expect(groupCenter([], GroupCenter.Bounds)).toBeNull();
  });
});

describe('neededHalfHeight', () => {
  it('fits the width, the height, or whichever needs more, at the share of the screen asked', () => {
    // 400 wide, 100 tall at aspect 2: the width needs a half height of 100, the height 50.
    expect(neededHalfHeight(200, 50, 2, 0, 1)).toBe(100);
    expect(neededHalfHeight(200, 50, 2, 2, 1)).toBe(50);
    expect(neededHalfHeight(200, 50, 2, 0, 0.5)).toBe(200);
  });
});

describe('a camera framing a group', () => {
  let world: World;
  let a: Entity, b: Entity, group: Entity, cam: Entity;
  beforeEach(() => {
    world = new World();
    const mod = createMockModule();
    world.connectCpp(mod.getRegistry(), mod);
    a = world.spawn('a'); world.insert(a, Transform, at(-300, 0, 0));
    b = world.spawn('b'); world.insert(b, Transform, at(300, 0, 0));
    group = world.spawn('group'); world.insert(group, Transform, at(0, 0, 0));
    world.insert(group, CameraTargetGroup, { members: [a, b], weights: [], radius: 50, center: GroupCenter.Bounds });
    cam = world.spawn('camera');
  });

  it('puts the group between its members, and moves it with them', () => {
    targetGroupUpdate(world);
    expect(world.get(group, Transform).worldPosition.x).toBeCloseTo(0, 9);
    world.insert(b, Transform, at(500, 100, 0));
    targetGroupUpdate(world);
    expect(world.get(group, Transform).worldPosition).toEqual({ x: 100, y: 50, z: 0 });
  });

  it('zooms an orthographic camera so the members, and their size, fill the share of the screen asked', () => {
    world.insert(cam, Transform, at(0, 0, 10));
    world.insert(cam, Camera, { projectionType: ProjectionType.Orthographic, orthoSize: 100, viewport: { x: 0, y: 0, z: 1, w: 1 } });
    world.insert(cam, GroupFraming, { group, framingSize: 0.5, damping: 0 });
    targetGroupUpdate(world);
    groupFramingUpdate(world, 1 / 60, 2);
    // 700 wide with their radius, at aspect 2: a half height of 175, doubled to fill half the screen.
    expect(world.get(cam, Camera).orthoSize).toBeCloseTo(350, 6);
  });

  it('widens a perspective lens to fit them at their near face', () => {
    world.insert(cam, Transform, at(0, 0, 1000));
    world.insert(cam, Camera, { projectionType: ProjectionType.Perspective, fov: 30, viewport: { x: 0, y: 0, z: 1, w: 1 } });
    world.insert(cam, GroupFraming, { group, framingSize: 1, damping: 0, minFov: 1, maxFov: 170 });
    targetGroupUpdate(world);
    groupFramingUpdate(world, 1 / 60, 1);
    // Half width 350 at aspect 1, near face 1000 - 50 away.
    expect(world.get(cam, Camera).fov).toBeCloseTo((2 * Math.atan(350 / 950) * 180) / Math.PI, 4);
  });

  it('dollies a following camera back to fit them, holds it there while the rig places it afresh, and keeps the lens', () => {
    world.insert(cam, Transform, at(0, 0, 1000));
    world.insert(cam, Camera, { projectionType: ProjectionType.Perspective, fov: 60, viewport: { x: 0, y: 0, z: 1, w: 1 } });
    world.insert(cam, FollowTarget, { target: group, offsetZ: 1000, followZ: true, damping: 0 });
    world.insert(cam, GroupFraming, { group, framingSize: 1, damping: 0, adjustment: FramingAdjustment.DollyThenZoom, minDistance: 10, maxDistance: 5000 });
    const frame = () => {
      groupFramingRestore(world);
      targetGroupUpdate(world);
      followUpdate(world, 1 / 60);
      groupFramingUpdate(world, 1 / 60, 1);
    };
    frame();
    const want = 350 / Math.tan(Math.PI / 6) + 50;
    expect(world.get(cam, Transform).worldPosition.z).toBeCloseTo(want, 3);
    frame();
    frame();
    expect(world.get(cam, Transform).worldPosition.z).toBeCloseTo(want, 3);
    expect(world.get(cam, Camera).fov).toBeCloseTo(60, 4);
  });

  it('zooms for what the dolly\'s range leaves', () => {
    world.insert(cam, Transform, at(0, 0, 400));
    world.insert(cam, Camera, { projectionType: ProjectionType.Perspective, fov: 60, viewport: { x: 0, y: 0, z: 1, w: 1 } });
    world.insert(cam, GroupFraming, { group, framingSize: 1, damping: 0, adjustment: FramingAdjustment.DollyThenZoom, minDistance: 10, maxDistance: 500, minFov: 1, maxFov: 170 });
    targetGroupUpdate(world);
    groupFramingUpdate(world, 1 / 60, 1);
    expect(world.get(cam, Transform).worldPosition.z).toBeCloseTo(500, 3);
    expect(world.get(cam, Camera).fov).toBeCloseTo((2 * Math.atan(350 / 450) * 180) / Math.PI, 3);
  });
});
