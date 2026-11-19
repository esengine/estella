// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraDolly.ts
 * @brief   Per-camera dolly: the camera stands on a Spline, at a place it is given, that tracks a target, or that runs at a speed.
 *
 * @details A position stage of the camera pipeline (CameraRig.ts), as FollowTarget is, and a camera uses one of the two: Unity
 *          Cinemachine's Spline Dolly, a track laid in the scene the camera rides. Where it looks is the rotation stage's
 *          (LookAtTarget), so a dolly that tracks a runner and looks at it is two components. The place on the track is written
 *          back to `position`, in world units from the start, so the inspector shows where the camera is and a script can read it.
 */
import { defineComponent, Transform } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { placedSpline, splineNearest, splinePoint } from '../spline/placedSpline';
import { placeCamera } from './cameraPlace';

/** How a dolly picks its place on the track. */
export const DollyMode = {
  /** At `position`, where a script or an animation puts it. */
  Fixed: 0,
  /** At the point of the track nearest `target`, moved along by `offset`: a camera that runs beside what it films. */
  TrackTarget: 1,
  /** Moving at `speed`: round and round a closed track, to the end of an open one. */
  Speed: 2,
} as const;
export type DollyMode = (typeof DollyMode)[keyof typeof DollyMode];

export interface CameraDollyData {
  /** The entity whose Spline is the track (0 = none). */
  spline: number;
  /** How the place on the track is chosen (DollyMode). */
  mode: number;
  /** Where on the track the camera is, in world units from its start. Written back each frame in every mode. */
  position: number;
  /** The entity a TrackTarget dolly keeps level with (0 = none). */
  target: number;
  /** World units ahead (positive) or behind the point nearest the target, along the track. */
  offset: number;
  /** World units a second along the track, for Speed. Negative runs backwards. */
  speed: number;
  /** Damping time in seconds for reaching the place a TrackTarget dolly wants (0 = at once). */
  damping: number;
}

export const CameraDolly = defineComponent<CameraDollyData>('CameraDolly', {
  spline: INVALID_ENTITY,
  mode: DollyMode.Fixed,
  position: 0,
  target: INVALID_ENTITY,
  offset: 0,
  speed: 0,
  damping: 0.3,
}, {
  entityFields: ['spline', 'target'],
  fields: {
    spline: { tooltip: 'The entity whose Spline the camera rides.' },
    mode: {
      enum: [{ label: 'Fixed', value: DollyMode.Fixed }, { label: 'Track Target', value: DollyMode.TrackTarget }, { label: 'Speed', value: DollyMode.Speed }],
      tooltip: 'Fixed: where Position says. Track Target: level with the target. Speed: moving along at Speed.',
    },
    position: { tooltip: 'Where on the track the camera is, in world units from its start.' },
    target: { tooltip: 'What a Track Target dolly keeps level with.' },
    offset: { tooltip: 'World units ahead of (or, negative, behind) the point nearest the target.' },
    speed: { tooltip: 'World units a second along the track; negative runs backwards.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to catch up most of the way to the target\'s place; 0 is at once.' },
  },
});

/**
 * The place on a track of `length` a dolly moves to from `now`, wanting `want`: damped, and on a closed track the short way round, so a
 * camera at the seam does not run the whole loop back. Pure.
 */
export function dollyStep(now: number, want: number, length: number, closed: boolean, damping: number, dt: number): number {
  let gap = want - now;
  if (closed && length > 0) {
    gap = ((gap % length) + length) % length;
    if (gap > length / 2) gap -= length;
  }
  const keep = damping > 0 ? Math.exp(-dt / damping) : 0;
  return wrapOrClamp(now + gap * (1 - keep), length, closed);
}

function wrapOrClamp(s: number, length: number, closed: boolean): number {
  if (length <= 0) return 0;
  return closed ? ((s % length) + length) % length : Math.min(Math.max(s, 0), length);
}

/** Places every camera with a CameraDolly on its track, through its parent (cameraPlace.ts), and writes back the dolly's place. */
export function dollyUpdate(world: World, dt: number): void {
  for (const e of world.getEntitiesWithComponents([CameraDolly, Transform])) {
    const dolly = world.get(e, CameraDolly);
    const track = placedSpline(world, dolly.spline);
    if (!track) continue;
    const closed = track.curve.closed;
    let place: number;
    if (dolly.mode === DollyMode.Speed) {
      place = wrapOrClamp(dolly.position + dolly.speed * dt, track.length, closed);
    } else if (dolly.mode === DollyMode.TrackTarget) {
      const target = dolly.target as Entity;
      if (dolly.target <= 0 || !world.valid(target) || !world.has(target, Transform)) continue;
      const p = world.get(target, Transform).worldPosition;
      const want = wrapOrClamp(splineNearest(track, p.x, p.y, p.z) + dolly.offset, track.length, closed);
      place = dollyStep(dolly.position, want, track.length, closed, dolly.damping, dt);
    } else {
      place = wrapOrClamp(dolly.position, track.length, closed);
    }
    const at = splinePoint(track, place);
    placeCamera(world, e, world.get(e, Transform), { x: at[0], y: at[1], z: at[2] });
    if (place !== dolly.position) world.set(e, CameraDolly, { ...dolly, position: place });
  }
}
