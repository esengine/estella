// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraDeoccluder.ts
 * @brief   Keeps what a camera frames in sight: when something solid comes between them, the camera moves up to it.
 *
 * @details A deoccluder that pulls the camera forward past what blocks it. A sphere is swept from the
 *          point the camera looks at back to where the rig put the camera; when it meets something, the camera is drawn
 *          in along that line to just short of it, so the wall is behind the camera and the target in front. Along that
 *          line the target stays where the composition held it.
 *
 *          The correction is the stage's own and is taken back before the next frame's stages run, an offset kept
 *          apart from the camera's state: the position stages work from where the rig wants the
 *          camera, not from where the wall pushed it, so the camera comes back out when the wall is gone. It is eased:
 *          in at `dampingWhenOccluded` (0, at once, so the wall is never seen through) and back out at `damping`.
 *
 *          Physics is asked through {@link CameraCollision}, a probe the 3D physics plugin installs; the camera module
 *          knows nothing of physics. Without it, the stage does nothing.
 */
import { defineComponent, Transform } from '../ecs/component';
import { defineResource } from '../ecs/resource';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { placeCamera } from './cameraPlace';
import { FollowTarget } from './FollowTarget';
import { LookAtTarget } from './LookAtTarget';

type Vec3 = { x: number; y: number; z: number };

export interface CameraDeoccluderData {
  /** What must stay in sight. 0 takes the LookAtTarget's target (with its offset), else the FollowTarget's. */
  target: number;
  /** Radius of the swept sphere: how far short of a wall the camera stops, so the near plane does not cut into it. */
  radius: number;
  /** Physics layers that hide the target; 0 = every layer. */
  layers: number;
  /** The camera is never drawn closer to the target than this. */
  minimumDistance: number;
  /** Seconds to move most of the way in when something hides the target; 0 is at once. */
  dampingWhenOccluded: number;
  /** Seconds to move most of the way back out once nothing does. */
  damping: number;
}

export const CameraDeoccluder = defineComponent<CameraDeoccluderData>('CameraDeoccluder', {
  target: INVALID_ENTITY,
  radius: 15,
  layers: 0,
  minimumDistance: 30,
  dampingWhenOccluded: 0,
  damping: 0.4,
}, {
  entityFields: ['target'],
  worldUnitFields: ['radius', 'minimumDistance'],
  fields: {
    target: { tooltip: 'What must stay in sight. Empty takes the LookAtTarget\'s target, else the FollowTarget\'s.' },
    radius: { min: 0, tooltip: 'How far short of a wall the camera stops, so the near plane does not cut into it.' },
    layers: { min: 0, max: 15, step: 1, advanced: true, tooltip: 'Physics layers that hide the target; 0 is every layer.' },
    minimumDistance: { min: 0, tooltip: 'The camera is never drawn closer to the target than this.' },
    dampingWhenOccluded: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to move in when something hides the target; 0 is at once, so the wall is never seen through.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to move back out once nothing hides the target.' },
  },
});

/**
 * A sweep of a sphere of `radius` from `origin` along `delta` (its length is the sweep's): the share of the way it gets
 * before meeting something on `layers`, 0 to 1, or null when nothing is in the way.
 */
export interface CameraCollisionProbe {
  sweep(origin: Vec3, radius: number, delta: Vec3, layers: number): number | null;
}

/** The probe the deoccluder asks. The 3D physics plugin installs it; null leaves cameras where their rigs put them. */
export const CameraCollision = defineResource<CameraCollisionProbe | null>(null, 'CameraCollision');

/** Per camera: where the rig wanted it, where this stage put it, and how far from the target it is now held. */
interface Held {
  raw: Vec3;
  written: Vec3;
  distance: number;
}

const held = new WeakMap<World, Map<Entity, Held>>();

const same = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;

/**
 * Takes last frame's corrections back, before the position stages run: a camera this stage moved, and that nothing has
 * moved since, goes back to where its rig wanted it. One its rig or a script has moved keeps that place.
 */
export function deoccluderRestore(world: World): void {
  const cams = held.get(world);
  if (!cams) return;
  for (const [e, h] of cams) {
    if (!world.valid(e) || !world.has(e, CameraDeoccluder) || !world.has(e, Transform)) {
      cams.delete(e);
      continue;
    }
    const t = world.get(e, Transform);
    if (same(t.worldPosition, h.written) && !same(h.raw, h.written)) placeCamera(world, e, t, h.raw);
  }
}

/** The point the camera must keep in sight, or null when it has none. */
function sightOf(world: World, e: Entity, data: CameraDeoccluderData): Vec3 | null {
  const at = (target: number, off: Vec3): Vec3 | null => {
    const t = target as Entity;
    if (target <= 0 || !world.valid(t) || !world.has(t, Transform)) return null;
    const p = world.get(t, Transform).worldPosition;
    return { x: p.x + off.x, y: p.y + off.y, z: p.z + off.z };
  };
  if (data.target > 0) return at(data.target, { x: 0, y: 0, z: 0 });
  if (world.has(e, LookAtTarget)) {
    const aim = world.get(e, LookAtTarget);
    const p = at(aim.target, { x: aim.offsetX, y: aim.offsetY, z: aim.offsetZ });
    if (p) return p;
  }
  if (world.has(e, FollowTarget)) return at(world.get(e, FollowTarget).target, { x: 0, y: 0, z: 0 });
  return null;
}

/** One frame of every deoccluded camera: the finalize stage, after the camera has been placed and aimed. */
export function deoccluderUpdate(world: World, dt: number, probe: CameraCollisionProbe | null): void {
  const entities = world.getEntitiesWithComponents([CameraDeoccluder, Transform]);
  if (entities.length === 0) return;
  let cams = held.get(world);
  if (!cams) held.set(world, (cams = new Map()));
  for (const e of entities) {
    const data = world.get(e, CameraDeoccluder);
    const t = world.get(e, Transform);
    const raw = { ...t.worldPosition };
    const sight = sightOf(world, e, data);
    if (!sight) {
      cams.delete(e);
      continue;
    }
    const delta = { x: raw.x - sight.x, y: raw.y - sight.y, z: raw.z - sight.z };
    const full = Math.hypot(delta.x, delta.y, delta.z);
    if (full < 1e-6) continue;
    const share = probe ? probe.sweep(sight, Math.max(0, data.radius), delta, data.layers) : null;
    const wanted = share === null ? full : Math.min(full, Math.max(data.minimumDistance, share * full));
    const was = cams.get(e)?.distance ?? full;
    const tau = wanted < was ? data.dampingWhenOccluded : data.damping;
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    const distance = Math.min(full, was + (wanted - was) * k);
    const s = distance / full;
    const p = { x: sight.x + delta.x * s, y: sight.y + delta.y * s, z: sight.z + delta.z * s };
    placeCamera(world, e, t, p);
    cams.set(e, { raw, written: p, distance });
  }
}
