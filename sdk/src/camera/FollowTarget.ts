// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
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
import { defineComponent, Transform } from '../component';
import type { World } from '../world';
import type { Entity } from '../types';

export interface FollowTargetData {
  /** Entity to follow (-1 = none). */
  target: number;
  /** World-space offset added to the target position. */
  offsetX: number;
  offsetY: number;
  /** The target may move within this radius (world units) without the camera following. */
  deadzone: number;
  /** Damping time-constant in seconds (larger = smoother/slower; 0 = snap). */
  damping: number;
}

export const FollowTarget = defineComponent<FollowTargetData>('FollowTarget', {
  target: -1,
  offsetX: 0,
  offsetY: 0,
  deadzone: 0,
  damping: 0.25,
});

/**
 * One damped follow step. Pure: given the camera position, the desired position
 * (target + offset), the dead zone, the damping time-constant, and dt, returns
 * the camera's next position. Moves the camera only by the part of the gap that
 * exceeds the dead zone, eased by a frame-rate-independent damping factor.
 */
export function followStep(
  camX: number,
  camY: number,
  desiredX: number,
  desiredY: number,
  deadzone: number,
  damping: number,
  dt: number,
): { x: number; y: number } {
  const dx = desiredX - camX;
  const dy = desiredY - camY;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist <= deadzone) return { x: camX, y: camY };
  const beyond = 1 - deadzone / dist; // fraction of the gap past the dead zone
  const k = damping > 0 ? 1 - Math.exp(-dt / damping) : 1; // frame-rate-independent
  return { x: camX + dx * beyond * k, y: camY + dy * beyond * k };
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
    const next = followStep(
      camT.position.x,
      camT.position.y,
      tgtT.position.x + ft.offsetX,
      tgtT.position.y + ft.offsetY,
      ft.deadzone,
      ft.damping,
      dt,
    );
    if (next.x !== camT.position.x || next.y !== camT.position.y) {
      world.set(e, Transform, {
        ...camT,
        position: { ...camT.position, x: next.x, y: next.y },
      });
    }
  }
}
