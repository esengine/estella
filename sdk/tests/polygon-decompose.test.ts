// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file polygon-decompose.test.ts — a concave ring as the shapes it collides as.
 *
 * The properties matter more than the piece count: any partition is correct if
 * every piece is convex, within the solver's cap, and the pieces together cover
 * the ring and nothing outside it. Asserting a count would pin the algorithm
 * rather than the contract, so only the cases with one obvious answer do.
 *
 * Coverage is checked by sampling: points known to be inside the ring must land
 * in some piece, and points in a notch must land in none. That is the property a
 * player actually feels — whether they can walk into the dent.
 */
import { describe, it, expect } from 'vitest';
import { decomposePolygon2D } from '../src/physics/polygonDecompose2D';
import { MAX_POLYGON_VERTICES, MIN_POLYGON_VERTICES } from '../src/physics/polygonHull2D';
import { collider2DOutline, type Collider2DShape } from '../src/physics/ColliderShape2D';

type P = { x: number; y: number };
const p = (x: number, y: number): P => ({ x, y });

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Inside or on the boundary of a convex CCW ring. */
function inPiece(q: P, ring: readonly P[]): boolean {
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (cross(b.x - a.x, b.y - a.y, q.x - a.x, q.y - a.y) < -1e-9) return false;
    }
    return true;
}

const covered = (q: P, pieces: readonly P[][]) => pieces.some((piece) => inPiece(q, piece));

/** Every piece a shape Box2D will take: convex, wound CCW, within the cap. */
function expectWellFormed(pieces: readonly P[][]) {
    expect(pieces.length).toBeGreaterThan(0);
    for (const ring of pieces) {
        expect(ring.length).toBeGreaterThanOrEqual(MIN_POLYGON_VERTICES);
        expect(ring.length).toBeLessThanOrEqual(MAX_POLYGON_VERTICES);
        let area2 = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            area2 += cross(a.x, a.y, b.x, b.y);
            const c = ring[(i + 2) % ring.length];
            expect(cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y)).toBeGreaterThanOrEqual(-1e-9);
        }
        expect(area2).toBeGreaterThan(0); // counter-clockwise, with real area
    }
}

// A dart: three corners with the bottom edge pushed up into the middle.
const DART = [p(-1, -1), p(0, 0), p(1, -1), p(0, 1)];
// An L, the textbook concave case: one inner corner.
const L = [p(0, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(0, 2)];
// A C, which no single split can solve — the mouth is deep.
const C = [
    p(0, 0), p(3, 0), p(3, 1), p(1, 1), p(1, 2), p(3, 2), p(3, 3), p(0, 3),
];

describe('decomposePolygon2D', () => {
    it('leaves a convex ring alone — one piece, the points as drawn', () => {
        const square = [p(-1, -1), p(1, -1), p(1, 1), p(-1, 1)];
        const d = decomposePolygon2D(square);
        expect(d.degenerate).toBe(false);
        expect(d.pieces).toHaveLength(1);
        expect(d.pieces[0]).toEqual(square);
    });

    it('rewinds a clockwise ring rather than refusing it', () => {
        const cw = [p(-1, -1), p(-1, 1), p(1, 1), p(1, -1)];
        const d = decomposePolygon2D(cw);
        expect(d.pieces).toHaveLength(1);
        expectWellFormed(d.pieces);
    });

    it('splits a dart, and the notch is no longer solid', () => {
        const d = decomposePolygon2D(DART);
        expect(d.degenerate).toBe(false);
        expectWellFormed(d.pieces);
        expect(d.pieces.length).toBeGreaterThan(1);
        // Just below the notch vertex is outside the ring: the hull would cover it.
        expect(covered(p(0, -0.5), d.pieces)).toBe(false);
        // ...while the two lobes beside it are still solid.
        expect(covered(p(-0.5, -0.3), d.pieces)).toBe(true);
        expect(covered(p(0.5, -0.3), d.pieces)).toBe(true);
        expect(covered(p(0, 0.5), d.pieces)).toBe(true);
    });

    it('splits an L and leaves the missing quadrant empty', () => {
        const d = decomposePolygon2D(L);
        expectWellFormed(d.pieces);
        expect(covered(p(0.5, 0.5), d.pieces)).toBe(true);
        expect(covered(p(1.5, 0.5), d.pieces)).toBe(true);
        expect(covered(p(0.5, 1.5), d.pieces)).toBe(true);
        expect(covered(p(1.5, 1.5), d.pieces)).toBe(false); // the quadrant the L omits
    });

    it('keeps the mouth of a C open', () => {
        const d = decomposePolygon2D(C);
        expectWellFormed(d.pieces);
        expect(covered(p(2, 1.5), d.pieces)).toBe(false); // inside the mouth
        expect(covered(p(0.5, 1.5), d.pieces)).toBe(true); // the spine behind it
        expect(covered(p(2, 0.5), d.pieces)).toBe(true);   // the lower arm
        expect(covered(p(2, 2.5), d.pieces)).toBe(true);   // the upper arm
    });

    it('takes a ring far past the solver cap, in pieces that each obey it', () => {
        // A 24-point star: twelve reflex vertices, nothing a single polygon can hold.
        const star: P[] = [];
        for (let i = 0; i < 24; i++) {
            const a = (i * 2 * Math.PI) / 24;
            const r = i % 2 === 0 ? 2 : 1;
            star.push(p(r * Math.cos(a), r * Math.sin(a)));
        }
        const d = decomposePolygon2D(star);
        expect(d.degenerate).toBe(false);
        expectWellFormed(d.pieces);
        expect(covered(p(0, 0), d.pieces)).toBe(true);       // the body
        expect(covered(p(1.9, 0), d.pieces)).toBe(true);      // out along a spike
        expect(covered(p(1.35, 1.35), d.pieces)).toBe(false); // the gap between two
    });

    it('is deterministic — the same ring gives the same pieces every time', () => {
        expect(decomposePolygon2D(C).pieces).toEqual(decomposePolygon2D(C).pieces);
    });

    it('falls back to the hull for a ring that crosses itself, and says so', () => {
        const bowtie = [p(-1, -1), p(1, 1), p(1, -1), p(-1, 1)];
        const d = decomposePolygon2D(bowtie);
        expect(d.degenerate).toBe(true);
        expectWellFormed(d.pieces);
        expect(d.pieces).toHaveLength(1);
    });

    it('builds nothing from a ring with no shape in it', () => {
        expect(decomposePolygon2D([p(0, 0), p(1, 0)]).pieces).toEqual([]);
        expect(decomposePolygon2D([]).pieces).toEqual([]);
        // Three points on a line: welded and collinear, so the solver builds none.
        expect(decomposePolygon2D([p(0, 0), p(1, 0), p(2, 0)]).pieces).toEqual([]);
    });

    it('welds a duplicated point rather than tripping over the zero-length edge', () => {
        const d = decomposePolygon2D([p(0, 0), p(0.001, 0), p(2, 0), p(2, 1), p(1, 1), p(1, 2), p(0, 2)]);
        expect(d.degenerate).toBe(false);
        expectWellFormed(d.pieces);
        expect(covered(p(1.5, 1.5), d.pieces)).toBe(false);
    });
});

describe('collider2DOutline draws what collides', () => {
    const outlineOf = (vertices: P[]) =>
        collider2DOutline({ kind: 'polygon', vertices } as Collider2DShape, p(0, 0), 0, 100);

    it('a convex polygon draws once, as authored', () => {
        const o = outlineOf([p(-0.5, -0.5), p(0.5, -0.5), p(0.5, 0.5), p(-0.5, 0.5)]);
        expect(o.declined).toBeUndefined();
        expect(o.polylines[0]).toHaveLength(5); // 4 corners + the closing point
    });

    it('a concave polygon ALSO draws once — the ring is what it collides as', () => {
        const o = outlineOf(DART);
        expect(o.declined).toBeUndefined();
        expect(o.polylines).toHaveLength(1);
        expect(o.polylines[0]).toHaveLength(5); // the authored 4, closed
    });

    it('a ring past the vertex cap draws whole, because it is built whole', () => {
        const o = outlineOf(C);
        expect(o.declined).toBeUndefined();
        expect(o.polylines[0]).toHaveLength(C.length + 1);
    });

    it('a self-crossing ring draws its hull solid and the ring apart', () => {
        const o = outlineOf([p(-1, -1), p(1, 1), p(1, -1), p(-1, 1)]);
        expect(o.declined?.[0]).toHaveLength(5);
        expect(o.polylines.length).toBeGreaterThan(0);
    });

    it('a ring with no area draws no solid outline at all', () => {
        const o = outlineOf([p(0, 0), p(1, 0), p(2, 0)]);
        expect(o.polylines).toEqual([]);
        expect(o.declined?.[0]).toHaveLength(4);
    });
});
