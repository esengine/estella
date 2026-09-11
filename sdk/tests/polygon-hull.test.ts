// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file polygon-hull.test.ts — the TS hull against the one Box2D builds.
 *
 * Every expectation here was MEASURED by calling `b2ComputeHull` itself, not
 * derived from reading it: a probe linking third_party/box2d/src/hull.c, core.c
 * and math_functions.c was fed these exact rings and its output pasted in. A
 * port whose only job is agreement has to be checked against the thing it agrees
 * with, so re-measure the same way if Box2D moves under us.
 *
 * Stitch ORDER is asserted too, not just the point set. The decagon's is the one
 * that would catch a hull rewritten as a monotone chain: quickhull leaves it in
 * an order no angular sweep produces, and a shape drawn in another order is a
 * different shape.
 */
import { describe, it, expect } from 'vitest';
import {
    computePolygonHull, polygonHullDiff, MAX_POLYGON_VERTICES,
} from '../src/physics/polygonHull2D';
import { collider2DOutline, type Collider2DShape } from '../src/physics/ColliderShape2D';

type P = { x: number; y: number };
const p = (x: number, y: number): P => ({ x, y });

const expectRing = (got: readonly P[], want: readonly [number, number][]) => {
    expect(got).toHaveLength(want.length);
    want.forEach(([x, y], i) => {
        expect(got[i].x).toBeCloseTo(x, 5);
        expect(got[i].y).toBeCloseTo(y, 5);
    });
};

describe('computePolygonHull — measured against b2ComputeHull', () => {
    it('keeps a convex ring whole, in the order it was given', () => {
        expectRing(
            computePolygonHull([p(-0.5, -0.5), p(0.5, -0.5), p(0.5, 0.5), p(-0.5, 0.5)]),
            [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]],
        );
    });

    it('fills in a concave notch — the dart loses the vertex pointing inward', () => {
        expectRing(
            computePolygonHull([p(-1, -1), p(0, 0), p(1, -1), p(0, 1)]),
            [[-1, -1], [1, -1], [0, 1]],
        );
    });

    it('fills in an L — the inner corner is not a hull vertex', () => {
        expectRing(
            computePolygonHull([p(0, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(0, 2)]),
            [[0, 0], [2, 0], [2, 1], [1, 2], [0, 2]],
        );
    });

    it('drops a vertex sitting on the edge its neighbours already span', () => {
        expectRing(
            computePolygonHull([p(0, 0), p(1, 0), p(2, 0), p(2, 2), p(0, 2)]),
            [[0, 0], [2, 0], [2, 2], [0, 2]],
        );
    });

    it('welds a vertex dragged onto its neighbour rather than narrowing the shape', () => {
        expectRing(
            computePolygonHull([p(0, 0), p(0.001, 0), p(1, 0), p(1, 1)]),
            [[0, 0], [1, 0], [1, 1]],
        );
    });

    it('builds NO shape from a ring with no area, or from fewer than three points', () => {
        expect(computePolygonHull([p(0, 0), p(1, 0), p(2, 0)])).toEqual([]);
        expect(computePolygonHull([p(0, 0), p(1, 0)])).toEqual([]);
        expect(computePolygonHull([])).toEqual([]);
    });

    it('takes a star down to the four points that enclose it', () => {
        expectRing(
            computePolygonHull([
                p(0, 1), p(0.2, 0.2), p(1, 0), p(0.2, -0.2),
                p(0, -1), p(-0.2, -0.2), p(-1, 0), p(-0.2, 0.2),
            ]),
            [[0, 1], [-1, 0], [0, -1], [1, 0]],
        );
    });

    it('stitches in quickhull order, which no angular sweep would produce', () => {
        const ring = Array.from({ length: MAX_POLYGON_VERTICES }, (_, i) => {
            const a = (i * 6.2831853) / 10;
            return p(Math.fround(Math.cos(a)), Math.fround(Math.sin(a)));
        });
        expectRing(computePolygonHull(ring), [
            [0.309017, 0.951057], [-0.309017, 0.951057], [-0.809017, 0.587785], [-1, 0],
            [-0.809017, -0.587785], [-0.309017, -0.951057], [1, 0], [0.809017, 0.587785],
        ]);
    });

    it('never offers the solver more vertices than it stores', () => {
        const ring = Array.from({ length: 12 }, (_, i) => {
            const a = (i * 2 * Math.PI) / 12;
            return p(Math.cos(a), Math.sin(a));
        });
        expect(computePolygonHull(ring).length).toBeLessThanOrEqual(MAX_POLYGON_VERTICES);
        expect(polygonHullDiff(ring).overflow).toBe(12 - MAX_POLYGON_VERTICES);
    });
});

describe('polygonHullDiff', () => {
    it('counts nothing lost when the ring is already convex', () => {
        const d = polygonHullDiff([p(-0.5, -0.5), p(0.5, -0.5), p(0.5, 0.5), p(-0.5, 0.5)]);
        expect(d.overflow).toBe(0);
        expect(d.declined).toBe(0);
    });

    it('counts the notch the hull declines', () => {
        expect(polygonHullDiff([p(-1, -1), p(0, 0), p(1, -1), p(0, 1)]).declined).toBe(1);
    });

    it('reports an empty hull as no shape, not as a hull short of vertices', () => {
        const d = polygonHullDiff([p(0, 0), p(1, 0), p(2, 0)]);
        expect(d.hull).toEqual([]);
        expect(d.declined).toBe(0);
    });
});

describe('collider2DOutline draws what collides', () => {
    const outlineOf = (vertices: P[]) =>
        collider2DOutline({ kind: 'polygon', vertices } as Collider2DShape, p(0, 0), 0, 100);

    it('a convex polygon draws once — nothing was declined', () => {
        const o = outlineOf([p(-0.5, -0.5), p(0.5, -0.5), p(0.5, 0.5), p(-0.5, 0.5)]);
        expect(o.declined).toBeUndefined();
        expect(o.polylines[0]).toHaveLength(5); // 4 corners + the closing point
    });

    it('a concave polygon draws the hull solid and the authored ring apart', () => {
        const o = outlineOf([p(-1, -1), p(0, 0), p(1, -1), p(0, 1)]);
        expect(o.polylines[0]).toHaveLength(4);  // 3 hull corners + closing
        expect(o.declined?.[0]).toHaveLength(5); // 4 authored corners + closing
    });

    it('a ring that builds no shape draws no solid outline at all', () => {
        const o = outlineOf([p(0, 0), p(1, 0), p(2, 0)]);
        expect(o.polylines).toEqual([]);
        expect(o.declined?.[0]).toHaveLength(4);
    });
});
