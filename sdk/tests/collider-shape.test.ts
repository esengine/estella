// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Golden geometry for the shared collider-shape projection. The outlines must match the
 * pre-refactor PhysicsDebugDraw math exactly (this is the Phase-0 parity proof) so both
 * the runtime debug draw and the editor gizmo can render from one source.
 */
import { describe, it, expect } from 'vitest';
import {
    shapeCenter, colliderShapeOutline, CAPSULE_ARC_SEGMENTS,
    type ColliderShape,
} from '../src/physics/ColliderShape';

const near = (a: { x: number; y: number }, x: number, y: number) => {
    expect(a.x).toBeCloseTo(x, 6);
    expect(a.y).toBeCloseTo(y, 6);
};

describe('shapeCenter', () => {
    it('adds the collider offset (metres × ppu), unrotated', () => {
        const box: ColliderShape = { kind: 'box', halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 1, y: 0 } };
        near(shapeCenter(box, { x: 10, y: 20 }, 0, 100), 110, 20);
    });
    it('rotates the offset by the entity angle', () => {
        const box: ColliderShape = { kind: 'box', halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 1, y: 0 } };
        near(shapeCenter(box, { x: 10, y: 20 }, Math.PI / 2, 100), 10, 120); // (100,0) rotated 90° → (0,100)
    });
    it('is the entity position for offsetless shapes (segment/polygon/chain)', () => {
        const seg: ColliderShape = { kind: 'segment', point1: { x: -0.5, y: 0 }, point2: { x: 0.5, y: 0 } };
        near(shapeCenter(seg, { x: 7, y: 9 }, 1.234, 100), 7, 9);
    });
});

describe('colliderShapeOutline', () => {
    it('box → a closed 4-corner loop, ppu-scaled', () => {
        const box: ColliderShape = { kind: 'box', halfExtents: { x: 0.5, y: 0.5 }, offset: { x: 0, y: 0 } };
        const o = colliderShapeOutline(box, { x: 0, y: 0 }, 0, 100);
        expect(o.circles).toEqual([]);
        expect(o.polylines).toHaveLength(1);
        const p = o.polylines[0];
        expect(p).toHaveLength(5); // 4 corners + closing point
        near(p[0], -50, -50); near(p[1], 50, -50); near(p[2], 50, 50); near(p[3], -50, 50);
        near(p[4], p[0].x, p[0].y);
    });

    it('box corners match the legacy drawRotatedBox math under rotation', () => {
        const hx = 40, hy = 20, angle = 0.7, cx = 12, cy = -3;
        const box: ColliderShape = { kind: 'box', halfExtents: { x: hx / 100, y: hy / 100 }, offset: { x: 0, y: 0 } };
        const p = colliderShapeOutline(box, { x: cx, y: cy }, angle, 100).polylines[0];
        // Reference: the exact transform the old drawRotatedBox used.
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const corners = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] as const;
        corners.forEach(([lx, ly], i) => near(p[i], cx + lx * cos - ly * sin, cy + lx * sin + ly * cos));
    });

    it('circle → a single {c,r}, no polylines', () => {
        const c: ColliderShape = { kind: 'circle', radius: 0.5, offset: { x: 0, y: 0 } };
        const o = colliderShapeOutline(c, { x: 5, y: 5 }, 0, 100);
        expect(o.polylines).toEqual([]);
        expect(o.circles).toHaveLength(1);
        near(o.circles[0].c, 5, 5);
        expect(o.circles[0].r).toBeCloseTo(50, 6);
    });

    it('capsule → one closed loop with the same segment count the legacy draw emitted', () => {
        const cap: ColliderShape = { kind: 'capsule', radius: 0.25, halfHeight: 0.5, offset: { x: 0, y: 0 } };
        const o = colliderShapeOutline(cap, { x: 0, y: 0 }, 0, 100);
        expect(o.circles).toEqual([]);
        // legacy: 2 side lines + 2 arcs (16 segs each) = 2 + 32 = 34 segments = 35 points.
        const pts = o.polylines[0];
        expect(pts).toHaveLength(2 + 2 * CAPSULE_ARC_SEGMENTS + 1);
        expect(pts.length - 1).toBe(2 + 2 * CAPSULE_ARC_SEGMENTS); // 34 segments
        near(pts[0], -25, -50);  // bottomLeft
        near(pts[1], -25, 50);   // topLeft
        near(pts[pts.length - 1], -25, -50); // closes back to bottomLeft
    });

    it('segment → one open two-point polyline', () => {
        const seg: ColliderShape = { kind: 'segment', point1: { x: -0.5, y: 0 }, point2: { x: 0.5, y: 0 } };
        const o = colliderShapeOutline(seg, { x: 0, y: 0 }, 0, 100);
        expect(o.polylines).toHaveLength(1);
        expect(o.polylines[0]).toHaveLength(2);
        near(o.polylines[0][0], -50, 0); near(o.polylines[0][1], 50, 0);
    });

    it('polygon → a closed loop of n+1 points', () => {
        const poly: ColliderShape = { kind: 'polygon', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
        const p = colliderShapeOutline(poly, { x: 0, y: 0 }, 0, 100).polylines[0];
        expect(p).toHaveLength(4);
        near(p[0], 0, 0); near(p[1], 100, 0); near(p[2], 0, 100); near(p[3], 0, 0);
    });

    it('chain → open by default, closed when isLoop', () => {
        const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }];
        const open = colliderShapeOutline({ kind: 'chain', points: pts, isLoop: false }, { x: 0, y: 0 }, 0, 100);
        expect(open.polylines[0]).toHaveLength(3); // 2 segments
        const loop = colliderShapeOutline({ kind: 'chain', points: pts, isLoop: true }, { x: 0, y: 0 }, 0, 100);
        expect(loop.polylines[0]).toHaveLength(4); // 3 segments (closed)
    });

    it('degenerate chain (<2 points) draws nothing', () => {
        const o = colliderShapeOutline({ kind: 'chain', points: [{ x: 0, y: 0 }], isLoop: false }, { x: 0, y: 0 }, 0, 100);
        expect(o.polylines).toEqual([]);
    });
});
