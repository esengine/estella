// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera follow — the damped, dead-zoned follow step (the procedural
 *        per-camera behaviour). Pure math, deterministic.
 *
 * Three-dimensional: a 3D scene's target walks in depth, and a step that drops
 * z leaves the camera behind on exactly the axis the game moved along. The flat
 * cases below are the same function with equal z, which is what says the 2D
 * behaviour is unchanged rather than re-implemented.
 */
import { describe, it, expect } from 'vitest';
import { followStep } from '../src/camera/FollowTarget';
import type { Vec3 } from '../src/types';

const at = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });

describe('followStep', () => {
  it('snaps to the desired position with no damping and no dead zone', () => {
    expect(followStep(at(0, 0), at(100, 0), 0, 0, 0.016)).toEqual(at(100, 0));
  });

  it('keeps the target at the dead-zone boundary (snap)', () => {
    const p = followStep(at(0, 0), at(100, 0), 30, 0, 0.016); // dead zone 30
    expect(p.x).toBeCloseTo(70); // target now sits 30 units from the camera
    expect(p.y).toBeCloseTo(0);
  });

  it('does not move while the target is within the dead zone', () => {
    expect(followStep(at(0, 0), at(20, 0), 30, 0.25, 0.016)).toEqual(at(0, 0));
  });

  it('damps partially toward the target', () => {
    const p = followStep(at(0, 0), at(100, 0), 0, 0.25, 0.016);
    expect(p.x).toBeCloseTo(100 * (1 - Math.exp(-0.016 / 0.25)));
  });

  it('is frame-rate independent (two dt/2 steps == one dt step)', () => {
    const a1 = followStep(at(0, 0), at(100, 0), 0, 0.25, 0.016);
    const a2 = followStep(a1, at(100, 0), 0, 0.25, 0.016);
    const b = followStep(at(0, 0), at(100, 0), 0, 0.25, 0.032);
    expect(a2.x).toBeCloseTo(b.x, 5);
  });

  it('follows depth the same way it follows width', () => {
    expect(followStep(at(0, 0, 0), at(0, 0, 100), 0, 0, 0.016)).toEqual(at(0, 0, 100));
  });

  // The dead zone is a sphere, not a cylinder: a target circling the camera at
  // the dead-zone radius must stay inside it whichever plane it circles in.
  it('measures the dead zone in all three axes', () => {
    expect(followStep(at(0, 0, 0), at(0, 0, 20), 30, 0.25, 0.016)).toEqual(at(0, 0, 0));
    const p = followStep(at(0, 0, 0), at(0, 0, 100), 30, 0, 0.016);
    expect(p.z).toBeCloseTo(70);
  });

  // A gap spread over three axes is one distance, so the dead zone bites on the
  // diagonal exactly as it does on an axis — 3-4-12 is 13 away, not 5.
  it('takes the diagonal of all three axes as the distance', () => {
    expect(followStep(at(0, 0, 0), at(3, 4, 12), 13, 0.25, 0.016)).toEqual(at(0, 0, 0));
    expect(followStep(at(0, 0, 0), at(3, 4, 12), 12.9, 0, 0.016).x).toBeGreaterThan(0);
  });

  it('leaves a flat scene exactly where it was', () => {
    const p = followStep(at(10, 20, 7), at(110, 20, 7), 0, 0, 0.016);
    expect(p).toEqual(at(110, 20, 7)); // z is handed in equal and comes back equal
  });
});
