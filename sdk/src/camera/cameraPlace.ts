// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cameraPlace.ts
 * @brief   Where a camera pipeline stage puts a camera, said in the world and written through its parent.
 *
 * @details Every stage of CameraRig.ts decides in world space (a target is where it is in the world) and a camera under a parent
 *          holds its own transform in the parent's. These turn the one into the other, and write the world value beside it, so the
 *          stage after reads where this frame put the camera rather than where the transform system last left it.
 */
import { Parent, Transform, type TransformData } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

const rotate = (q: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
};

/** The parent's world transform, or null for a camera at the top of the hierarchy. */
function parentOf(world: World, e: Entity): TransformData | null {
  const parent = world.tryGet(e, Parent);
  if (!parent || parent.entity <= 0 || !world.valid(parent.entity) || !world.has(parent.entity, Transform)) return null;
  return world.get(parent.entity, Transform);
}

/** Puts camera `e` at the world point `p`: its own position through its parent's, and its world position beside it. */
export function placeCamera(world: World, e: Entity, camT: TransformData, p: Vec3): void {
  const parent = parentOf(world, e);
  let local = p;
  if (parent) {
    const q = parent.worldRotation, s = parent.worldScale;
    const r = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, {
      x: p.x - parent.worldPosition.x, y: p.y - parent.worldPosition.y, z: p.z - parent.worldPosition.z,
    });
    local = { x: r.x / (s.x || 1), y: r.y / (s.y || 1), z: r.z / (s.z || 1) };
  }
  const same = local.x === camT.position.x && local.y === camT.position.y && local.z === camT.position.z;
  if (same) return;
  world.set(e, Transform, { ...camT, position: { ...local }, worldPosition: { ...p } });
}
