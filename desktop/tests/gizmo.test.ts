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
  HEAD_ON,
  hitTestGizmo,
  constrainDelta,
  axisHandles,
  faceOnPlane,
  dragPlane,
  planeNormal,
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

// A quarter turn about world Y: X now points into the screen and Z out of it.
const TURNED = {
  x: { dx: 0, dy: 0 }, y: { dx: 0, dy: -1 }, z: { dx: 1, dy: 0 },
};

describe('hitTestGizmo — move', () => {
  it('center hits the plane facing the eye, which head-on is XY', () => {
    expect(hitTestGizmo('move', HEAD_ON, pivot, pivot)?.id).toBe('move.xy');
  });
  it('along +X hits the X axis (screen right)', () => {
    const h = hitTestGizmo('move', HEAD_ON, pivot, { x: pivot.x + GIZMO.axisLen - 6, y: pivot.y });
    expect(h?.id).toBe('move.x');
    expect(h?.axis).toBe('x');
  });
  it('along −screenY (up) hits the Y axis', () => {
    const h = hitTestGizmo('move', HEAD_ON, pivot, { x: pivot.x, y: pivot.y - GIZMO.axisLen + 6 });
    expect(h?.id).toBe('move.y');
    expect(h?.axis).toBe('y');
  });
  it('empty space misses', () => {
    expect(hitTestGizmo('move', HEAD_ON, pivot, { x: pivot.x + 200, y: pivot.y + 200 })).toBeNull();
  });
  // The defect the basis fixes: the arrow pointing screen-right is whichever axis
  // the eye puts there, not always X.
  it('aims at the axis the VIEW puts under the cursor, not at a fixed direction', () => {
    const right = { x: pivot.x + GIZMO.axisLen - 6, y: pivot.y };
    expect(hitTestGizmo('move', HEAD_ON, pivot, right)?.axis).toBe('x');
    expect(hitTestGizmo('move', TURNED, pivot, right)?.axis).toBe('z');
  });
});

describe('hitTestGizmo — scale', () => {
  it('center hits the uniform box', () => {
    expect(hitTestGizmo('scale', HEAD_ON, pivot, pivot)?.id).toBe('scale.xy');
  });
  it('the X end box hits scale.x', () => {
    expect(hitTestGizmo('scale', HEAD_ON, pivot, { x: pivot.x + GIZMO.axisLen, y: pivot.y })?.id).toBe('scale.x');
  });
});

describe('axisHandles', () => {
  // The same rule that leaves a head-on rotate gizmo one ring: an axis pointing at
  // the eye projects to nothing, and a dot names no drag.
  it('drops the axis pointing at the eye, so a head-on gizmo keeps its two arrows', () => {
    expect(axisHandles(HEAD_ON).map((h) => h.axis)).toEqual(['x', 'y']);
  });
  it('offers all three once the eye is off-axis', () => {
    const axes = { x: { dx: 0.7, dy: 0.3 }, y: { dx: 0, dy: -1 }, z: { dx: -0.7, dy: 0.3 } };
    expect(axisHandles(axes).map((h) => h.axis)).toEqual(['x', 'y', 'z']);
  });
  // Local space is a rotation of the axes, not an angle applied to the screen —
  // which is the only form that can express a turn about X or Y.
  it('turns the arrows into the entity frame', () => {
    const quarterZ = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
    const x = axisHandles(HEAD_ON, quarterZ).find((h) => h.axis === 'x')!;
    expect(x.dir.x).toBeCloseTo(0, 6);
    expect(x.dir.y).toBeCloseTo(-1, 6); // world +Y is screen up
  });
});

describe('constrainDelta', () => {
  const d = { x: 5, y: 9, z: 4 };
  it('x axis keeps only dx', () => expect(constrainDelta('x', d)).toEqual({ x: 5, y: 0, z: 0 }));
  it('y axis keeps only dy', () => expect(constrainDelta('y', d)).toEqual({ x: 0, y: 9, z: 0 }));
  it('z axis keeps only dz', () => expect(constrainDelta('z', d)).toEqual({ x: 0, y: 0, z: 4 }));
  // A plane handle measured the delta ON its plane, so there is nothing to project.
  it('a plane handle keeps the delta it was given', () => expect(constrainDelta('xy', d)).toEqual(d));
});

describe('the plane a drag is measured on', () => {
  // Head-on, an X or Y drag happens on the z plane it always did.
  it('is the z plane for X and Y head-on', () => {
    expect(dragPlane('x', HEAD_ON)).toBe('xy');
    expect(dragPlane('y', HEAD_ON)).toBe('xy');
    expect(planeNormal('xy')).toEqual({ x: 0, y: 0, z: 1 });
  });
  // And never an edge-on one, where a pixel of cursor travel is an unbounded
  // world distance. Turned about Y, the XY plane is edge-on for a Z drag.
  it('avoids the plane the eye sees edge-on', () => {
    expect(dragPlane('z', TURNED)).toBe('yz');
  });
  it('is the plane itself for a plane handle', () => {
    expect(dragPlane('yz', HEAD_ON)).toBe('yz');
  });
  it('faces the eye for the centre handle', () => {
    expect(faceOnPlane(HEAD_ON)).toBe('xy');
    expect(faceOnPlane(TURNED)).toBe('yz');
  });
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
