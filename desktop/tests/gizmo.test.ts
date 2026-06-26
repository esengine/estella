// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure gizmo geometry — handle hit-testing per tool, axis constraint, group
 *        pivot/rotate/scale. The unit-testable core of the interactive gizmo.
 */
import { describe, it, expect } from 'vitest';
import {
  GIZMO,
  hitTestGizmo,
  constrainWorldDelta,
  groupPivot,
  rotateAround,
  scaleAround,
  distToSegment,
} from '@/tools/gizmo';

const pivot = { x: 100, y: 100 };

describe('hitTestGizmo — move', () => {
  it('center hits the XY plane', () => {
    expect(hitTestGizmo('move', pivot, pivot)?.id).toBe('move.xy');
  });
  it('along +X hits the X axis (screen right)', () => {
    const h = hitTestGizmo('move', pivot, { x: pivot.x + GIZMO.axisLen - 6, y: pivot.y });
    expect(h?.id).toBe('move.x');
    expect(h?.axis).toBe('x');
  });
  it('along −screenY (up) hits the Y axis', () => {
    const h = hitTestGizmo('move', pivot, { x: pivot.x, y: pivot.y - GIZMO.axisLen + 6 });
    expect(h?.id).toBe('move.y');
    expect(h?.axis).toBe('y');
  });
  it('empty space misses', () => {
    expect(hitTestGizmo('move', pivot, { x: pivot.x + 200, y: pivot.y + 200 })).toBeNull();
  });
});

describe('hitTestGizmo — scale', () => {
  it('center hits the uniform box', () => {
    expect(hitTestGizmo('scale', pivot, pivot)?.id).toBe('scale.xy');
  });
  it('the X end box hits scale.x', () => {
    expect(hitTestGizmo('scale', pivot, { x: pivot.x + GIZMO.axisLen, y: pivot.y })?.id).toBe('scale.x');
  });
});

describe('hitTestGizmo — rotate', () => {
  it('a point on the ring hits the ring', () => {
    expect(hitTestGizmo('rotate', pivot, { x: pivot.x + GIZMO.ringRadius, y: pivot.y })?.id).toBe('rotate.ring');
  });
  it('inside the ring misses', () => {
    expect(hitTestGizmo('rotate', pivot, pivot)).toBeNull();
  });
});

describe('constrainWorldDelta', () => {
  it('x axis keeps only dx', () => expect(constrainWorldDelta('x', 5, 9)).toEqual([5, 0]));
  it('y axis keeps only dy', () => expect(constrainWorldDelta('y', 5, 9)).toEqual([0, 9]));
  it('xy keeps both', () => expect(constrainWorldDelta('xy', 5, 9)).toEqual([5, 9]));
});

describe('groupPivot', () => {
  it('is the centroid', () => {
    expect(groupPivot([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }])).toEqual({ x: 5, y: 3 });
  });
  it('empty is the origin', () => expect(groupPivot([])).toEqual({ x: 0, y: 0 }));
});

describe('rotateAround / scaleAround', () => {
  it('rotates a point 90° about a pivot', () => {
    const r = rotateAround({ x: 10, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 6);
    expect(r.y).toBeCloseTo(10, 6);
  });
  it('scales a point away from a pivot per axis', () => {
    expect(scaleAround({ x: 4, y: 4 }, { x: 0, y: 0 }, 2, 0.5)).toEqual({ x: 8, y: 2 });
  });
});

describe('distToSegment', () => {
  it('is the perpendicular distance to a segment interior', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 6);
  });
  it('clamps to an endpoint past the segment', () => {
    expect(distToSegment({ x: 13, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 6);
  });
});
