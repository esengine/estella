// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FollowTarget.ts
 * @brief   Per-camera follow behaviour — the procedural half of the camera
 *          modifier layer. A camera with a FollowTarget
 *          component damps its Transform toward a target each frame, with a dead
 *          zone (the target can roam within it without the camera moving) and
 *          frame-rate-independent damping. State lives in the camera's Transform
 *          (the ECS-native place), so the director simply blends already-followed
 *          POVs. Runs in play mode only.
 */
import { defineComponent, Transform } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity, type Vec3 } from '../types';
import { placeCamera } from './cameraPlace';

export interface FollowTargetData {
  /** Entity to follow (0 = none; a negative id, which older scenes hold, is none too). */
  target: number;
  /** World-space offset added to the target position. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  /**
   * Follow the target's DEPTH as well. Off for a flat scene, where the camera's z
   * is how far back it stands and following it would walk it into the content
   * plane. Its own switch rather than "offsetZ ≠ 0": standing level with the
   * target is a legal 3D offset.
   */
  followZ: boolean;
  /** The target may move within this radius (world units) without the camera following. */
  deadzone: number;
  /** Damping time-constant in seconds (larger = smoother/slower; 0 = snap). */
  damping: number;
}

export const FollowTarget = defineComponent<FollowTargetData>('FollowTarget', {
  target: INVALID_ENTITY,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  followZ: false,
  deadzone: 0,
  damping: 0.25,
}, {
  // Named so a scene's reference to the followed entity is carried to the entity it loads as; before, only a target a
  // script set at run time was followed.
  entityFields: ['target'],
  fields: {
    target: { tooltip: 'The transform this camera follows.' },
    deadzone: { min: 0, tooltip: 'How far the target may move, in world units, before the camera follows.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to catch up most of the way; 0 follows at once.' },
  },
});

/**
 * One damped follow step. Pure: given the camera position, the desired position
 * (target + offset), the dead zone, the damping time-constant, and dt, returns
 * the camera's next position. Moves the camera only by the part of the gap that
 * exceeds the dead zone, eased by a frame-rate-independent damping factor.
 *
 * Three-dimensional, and the dead zone with it: a sphere, so a target circling a
 * 3D camera at the dead-zone radius stays inside it the whole way round. A flat
 * scene hands in equal z on both sides and gets exactly what it always did.
 */
export function followStep(
  cam: Vec3,
  desired: Vec3,
  deadzone: number,
  damping: number,
  dt: number,
): Vec3 {
  const dx = desired.x - cam.x;
  const dy = desired.y - cam.y;
  const dz = desired.z - cam.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist === 0 || dist <= deadzone) return { x: cam.x, y: cam.y, z: cam.z };
  const beyond = 1 - deadzone / dist; // fraction of the gap past the dead zone
  const k = damping > 0 ? 1 - Math.exp(-dt / damping) : 1; // frame-rate-independent
  return { x: cam.x + dx * beyond * k, y: cam.y + dy * beyond * k, z: cam.z + dz * beyond * k };
}

/** Advance every FollowTarget camera by one damped step (called by the follow system). */
export function followUpdate(world: World, dt: number): void {
  const entities = world.getEntitiesWithComponents([FollowTarget, Transform]);
  for (const e of entities) {
    const ft = world.get(e, FollowTarget);
    const target = ft.target as Entity;
    if (ft.target <= 0 || !world.valid(target) || !world.has(target, Transform)) continue;
    const camT = world.get(e, Transform);
    const tgtT = world.get(target, Transform);
    // In the world, where the offset is said to be: under a parent the camera's own position is in the parent's space, and an
    // offset added there was turned and scaled with it. A camera that does not follow depth is asked for the depth it already
    // has, so the step's own arithmetic leaves it there — no second code path.
    const now = camT.worldPosition;
    const desiredZ = ft.followZ ? tgtT.worldPosition.z + ft.offsetZ : now.z;
    const next = followStep(
      now,
      { x: tgtT.worldPosition.x + ft.offsetX, y: tgtT.worldPosition.y + ft.offsetY, z: desiredZ },
      ft.deadzone,
      ft.damping,
      dt,
    );
    if (next.x !== now.x || next.y !== now.y || next.z !== now.z) placeCamera(world, e, camT, next);
  }
}
