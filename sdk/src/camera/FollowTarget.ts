// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FollowTarget.ts
 * @brief   Per-camera follow behaviour — the procedural half of the camera
 *          modifier layer (Cinemachine's vcam Body). A camera with a FollowTarget
 *          component damps its Transform toward a target each frame, with a dead
 *          zone (the target can roam within it without the camera moving) and
 *          frame-rate-independent damping. State lives in the camera's Transform
 *          (the ECS-native place), so the director simply blends already-followed
 *          POVs. Runs in play mode only.
 */
import { defineComponent, Transform } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity, Vec3 } from '../types';

export interface FollowTargetData {
  /** Entity to follow (-1 = none). */
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
  target: -1,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  followZ: false,
  deadzone: 0,
  damping: 0.25,
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
    if (ft.target < 0 || !world.valid(target) || !world.has(target, Transform)) continue;
    const camT = world.get(e, Transform);
    const tgtT = world.get(target, Transform);
    // A camera that does not follow depth is asked for the depth it already has,
    // so the step's own arithmetic leaves it there — no second code path.
    const desiredZ = ft.followZ ? tgtT.position.z + ft.offsetZ : camT.position.z;
    const next = followStep(
      camT.position,
      { x: tgtT.position.x + ft.offsetX, y: tgtT.position.y + ft.offsetY, z: desiredZ },
      ft.deadzone,
      ft.damping,
      dt,
    );
    if (next.x !== camT.position.x || next.y !== camT.position.y || next.z !== camT.position.z) {
      world.set(e, Transform, { ...camT, position: next });
    }
  }
}
