// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Pure gizmo geometry — handle hit-testing per tool, axis constraint, group
 *        pivot/rotate/scale. The unit-testable core of the interactive gizmo.
 */
import { describe, it, expect } from 'vitest';
import {
  GIZMO,
  colliderHandleClass,
  hitTestGizmo,
  constrainWorldDelta,
  groupPivot,
  rotateAround,
  scaleAround,
  rotateRings,
  ringPoint,
  ringAngleAt,
  hitTestRings,
  axisQuat,
  quatMul,
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

/**
 * Collider overlays are drawn for every collider in the scene, and the offset
 * handle sits exactly where Move/Scale keep their centre grab. Ungated, dragging
 * the middle of a platform to move it writes BoxCollider.offset instead.
 */
describe('colliderHandleClass', () => {
  it('leaves an unselected entity\'s handles inert under every tool', () => {
    for (const mode of ['select', 'move', 'rotate', 'scale'] as const) {
      expect(colliderHandleClass(false, mode)).not.toContain('is-live');
    }
  });

  it('arms the selected entity\'s handles', () => {
    expect(colliderHandleClass(true, 'select')).toContain('is-live');
  });

  it('yields the centre to every transform gizmo, and only to those', () => {
    expect(colliderHandleClass(true, 'move')).toContain('gizmo-owns-centre');
    expect(colliderHandleClass(true, 'scale')).toContain('gizmo-owns-centre');
    expect(colliderHandleClass(true, 'rotate')).toContain('gizmo-owns-centre');
    expect(colliderHandleClass(true, 'select')).not.toContain('gizmo-owns-centre');
  });

  it('keeps the collider offset reachable: selected + Select tool arms it outright', () => {
    const cls = colliderHandleClass(true, 'select');
    expect(cls).toContain('is-live');
    expect(cls).not.toContain('gizmo-owns-centre');
  });
});

describe('the rotate gizmo\'s rings', () => {
    // Head-on: +X right, +Y up (screen y is down), +Z straight at the eye.
    const HEAD_ON = { x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -1 }, z: { dx: 0, dy: 0 } };
    // Orbited 35/22, from the view basis — the same numbers editorViewAxes gives.
    const TURNED = {
        x: { dx: 0.8189, dy: 0.2148 },
        y: { dx: 0, dy: -0.9266 },
        z: { dx: -0.5733, dy: 0.3068 },
    };

    it('leaves a head-on gizmo the single Z ring it always had', () => {
        // The other two are edge-on there — a line, where a cursor names no angle.
        // So turning three rings on cannot change what a 2D user aims at.
        expect(rotateRings(HEAD_ON).map((r) => r.axis)).toEqual(['z']);
    });

    it('offers all three once the eye has turned', () => {
        expect(rotateRings(TURNED).map((r) => r.axis).sort()).toEqual(['x', 'y', 'z']);
    });

    it('reads a cursor on a ring back as the parameter that put it there', () => {
        const ring = rotateRings(TURNED).find((r) => r.axis === 'x')!;
        for (const t of [0, 0.9, -2.4, 3.0]) {
            const p = ringPoint(ring, t, GIZMO.ringRadius);
            expect(ringAngleAt(ring, p, GIZMO.ringRadius)).toBeCloseTo(t, 6);
        }
    });

    it('picks the ring the cursor is on, and nothing off them', () => {
        const rings = rotateRings(TURNED);
        for (const want of ['x', 'y', 'z'] as const) {
            const ring = rings.find((r) => r.axis === want)!;
            const on = ringPoint(ring, 0.6, GIZMO.ringRadius);
            expect(hitTestRings(rings, { x: 0, y: 0 }, on)?.axis).toBe(want);
        }
        expect(hitTestRings(rings, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
    });

    it('turns positively from u toward v, so the ring names its own sign', () => {
        // A quarter turn about +X takes +Y to +Z, which is what the ring's own
        // parameter runs through — the reason no per-axis sign table exists.
        const q = axisQuat('x', Math.PI / 2);
        const rotated = quatMul(quatMul(q, { x: 0, y: 1, z: 0, w: 0 }),
                                { x: -q.x, y: -q.y, z: -q.z, w: q.w });
        expect(rotated.x).toBeCloseTo(0, 6);
        expect(rotated.y).toBeCloseTo(0, 6);
        expect(rotated.z).toBeCloseTo(1, 6);
    });

    it('composes a world turn on the LEFT of the pose it is applied to', () => {
        const pose = axisQuat('z', 0.4);
        const turned = quatMul(axisQuat('z', 0.3), pose);
        expect(2 * Math.atan2(turned.z, turned.w)).toBeCloseTo(0.7, 6);
    });
});
