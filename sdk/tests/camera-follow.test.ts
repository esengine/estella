// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera follow — the damped, dead-zoned follow step (the procedural
 *        per-camera behaviour). Pure math, deterministic.
 */
import { describe, it, expect } from 'vitest';
import { followStep } from '../src/camera/FollowTarget';

describe('followStep', () => {
  it('snaps to the desired position with no damping and no dead zone', () => {
    expect(followStep(0, 0, 100, 0, 0, 0, 0.016)).toEqual({ x: 100, y: 0 });
  });

  it('keeps the target at the dead-zone boundary (snap)', () => {
    const p = followStep(0, 0, 100, 0, 30, 0, 0.016); // dead zone 30
    expect(p.x).toBeCloseTo(70); // target now sits 30 units from the camera
    expect(p.y).toBeCloseTo(0);
  });

  it('does not move while the target is within the dead zone', () => {
    expect(followStep(0, 0, 20, 0, 30, 0.25, 0.016)).toEqual({ x: 0, y: 0 });
  });

  it('damps partially toward the target', () => {
    const p = followStep(0, 0, 100, 0, 0, 0.25, 0.016);
    expect(p.x).toBeCloseTo(100 * (1 - Math.exp(-0.016 / 0.25)));
  });

  it('is frame-rate independent (two dt/2 steps == one dt step)', () => {
    const a1 = followStep(0, 0, 100, 0, 0, 0.25, 0.016);
    const a2 = followStep(a1.x, a1.y, 100, 0, 0, 0.25, 0.016);
    const b = followStep(0, 0, 100, 0, 0, 0.25, 0.032);
    expect(a2.x).toBeCloseTo(b.x, 5);
  });
});
