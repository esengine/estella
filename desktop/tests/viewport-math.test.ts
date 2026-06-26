// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure viewport geometry — OBB hit-testing (rotation-aware), rect overlap,
 *        quat→angle, and snapping. These back picking / marquee / gizmo math, so
 *        they're the unit-testable core of the viewport interaction layer.
 */
import { describe, it, expect } from 'vitest';
import {
  type OBB,
  quatAngleZ,
  obbCorners,
  pointInOBB,
  rectsIntersect,
  screenAABB,
  snapTo,
  clamp,
} from '@/engine/viewportMath';

const box = (cx: number, cy: number, hw: number, hh: number, rot = 0): OBB => ({ cx, cy, hw, hh, rot });

describe('quatAngleZ', () => {
  it('reads the Z angle of a pure-Z quaternion', () => {
    const a = Math.PI / 3;
    const q = { w: Math.cos(a / 2), x: 0, y: 0, z: Math.sin(a / 2) };
    expect(quatAngleZ(q)).toBeCloseTo(a, 6);
  });
  it('identity quat is zero', () => {
    expect(quatAngleZ({ w: 1, x: 0, y: 0, z: 0 })).toBeCloseTo(0, 6);
  });
});

describe('pointInOBB', () => {
  it('hits inside an axis-aligned box and misses outside', () => {
    const b = box(0, 0, 10, 5);
    expect(pointInOBB(0, 0, b)).toBe(true);
    expect(pointInOBB(9, 4, b)).toBe(true);
    expect(pointInOBB(11, 0, b)).toBe(false);
    expect(pointInOBB(0, 6, b)).toBe(false);
  });

  it('respects rotation — a 45° box rejects a point the AABB would accept', () => {
    const b = box(0, 0, 10, 10, Math.PI / 4);
    // The unrotated corner (10,10) is outside the rotated box (its corners reach ±14.1 on the axes).
    expect(pointInOBB(10, 10, b)).toBe(false);
    // A point along the rotated local-x axis at distance 10 is on the edge → inside.
    const c = Math.cos(Math.PI / 4);
    expect(pointInOBB(10 * c, 10 * c, b)).toBe(true);
  });
});

describe('obbCorners', () => {
  it('gives the four corners of an axis-aligned box', () => {
    const cs = obbCorners(box(5, 5, 2, 1));
    expect(cs).toEqual([
      [3, 4],
      [7, 4],
      [7, 6],
      [3, 6],
    ]);
  });
});

describe('rectsIntersect', () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  it('overlapping rects intersect', () => {
    expect(rectsIntersect(r, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });
  it('disjoint rects do not', () => {
    expect(rectsIntersect(r, { x: 20, y: 0, w: 5, h: 5 })).toBe(false);
  });
  it('edge-touching counts as intersecting', () => {
    expect(rectsIntersect(r, { x: 10, y: 0, w: 5, h: 5 })).toBe(true);
  });
});

describe('screenAABB', () => {
  it('bounds a set of points', () => {
    expect(screenAABB([{ x: 1, y: 2 }, { x: 5, y: 1 }, { x: 3, y: 7 }])).toEqual({ x: 1, y: 1, w: 4, h: 6 });
  });
  it('returns null if any point failed to project', () => {
    expect(screenAABB([{ x: 1, y: 2 }, null])).toBeNull();
  });
});

describe('snapTo / clamp', () => {
  it('snaps to the nearest multiple', () => {
    expect(snapTo(17, 8)).toBe(16);
    expect(snapTo(20, 8)).toBe(24);
    expect(snapTo(13.4, 0)).toBe(13.4); // step <= 0 is a no-op
  });
  it('clamps to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});
