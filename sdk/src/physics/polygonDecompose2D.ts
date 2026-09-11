// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    polygonDecompose2D.ts
 * @brief   The convex pieces a concave collider ring collides as.
 *
 * @details Box2D builds only convex polygons, and only eight vertices of one. A
 *          ring that is neither is not a shape it can take — but it IS a union of
 *          shapes it can take, so the limit belongs to a PIECE rather than to
 *          what an author may draw.
 *
 *          Ear clipping to triangles, then merging neighbours back while the
 *          result stays convex and within the cap. The merge works on vertex
 *          INDICES, so two pieces share an edge exactly rather than within a
 *          tolerance: float comparison at a seam is how a partition develops
 *          gaps nothing can be pushed out of.
 *
 *          Every piece is finally passed through {@link computePolygonHull},
 *          which is what Box2D will do to it. A sliver the solver would refuse
 *          is dropped here instead of silently becoming no shape at run time.
 */
import type { Vec2 } from '../types';
import { computePolygonHull, MAX_POLYGON_VERTICES, MIN_POLYGON_VERTICES } from './polygonHull2D';

/** Points nearer than this are one point, matching the hull's own welding. */
const WELD = 0.02;

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** The turn at `b` walking a → b → c. Positive is a left turn, so convex in CCW. */
function turn(a: Vec2, b: Vec2, c: Vec2): number {
    return cross(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
}

/** Twice the signed area of a ring: positive counter-clockwise. */
function signedArea2(ring: readonly Vec2[]): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        sum += cross(a.x, a.y, b.x, b.y);
    }
    return sum;
}

/** No right turn anywhere. Collinear joints pass: Box2D merges those away itself. */
function isConvex(ring: readonly Vec2[]): boolean {
    for (let i = 0; i < ring.length; i++) {
        const a = ring[(i + ring.length - 1) % ring.length];
        const b = ring[i];
        const c = ring[(i + 1) % ring.length];
        if (turn(a, b, c) < 0) return false;
    }
    return true;
}

/**
 * Whether two segments cross at a point interior to BOTH. Touching — an endpoint
 * on a segment, two collinear runs — is not a crossing: a ring may legitimately
 * fold back onto its own corner, and only a real crossing has no partition.
 */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const d1 = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
    const d2 = cross(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
    const d3 = cross(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
    const d4 = cross(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
    return d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0
        && (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

/**
 * Whether any two non-adjacent edges cross. Asked outright rather than inferred
 * from ear clipping running out of ears: a self-crossing ring often still yields
 * ears, and the triangulation it yields covers the wrong area in silence.
 */
function selfIntersects(ring: readonly Vec2[]): boolean {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue; // adjacent around the wrap
            if (segmentsCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return true;
        }
    }
    return false;
}

/** Strictly inside — a point ON an edge must not block the ear that owns it. */
function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0
        && cross(c.x - b.x, c.y - b.y, p.x - b.x, p.y - b.y) > 0
        && cross(a.x - c.x, a.y - c.y, p.x - c.x, p.y - c.y) > 0;
}

/** The ring with consecutive duplicates removed, wound counter-clockwise. */
function normalize(vertices: readonly Vec2[]): Vec2[] {
    const out: Vec2[] = [];
    for (const v of vertices) {
        const last = out[out.length - 1];
        if (last && Math.hypot(v.x - last.x, v.y - last.y) < WELD) continue;
        out.push({ x: v.x, y: v.y });
    }
    const first = out[0];
    const last = out[out.length - 1];
    if (out.length > 1 && first && last && Math.hypot(first.x - last.x, first.y - last.y) < WELD) out.pop();
    if (out.length >= MIN_POLYGON_VERTICES && signedArea2(out) < 0) out.reverse();
    return out;
}

/**
 * Triangles as index triples, or null when no ear can be found — which a simple
 * ring always has, so failing means this one is not simple: it crosses itself,
 * and no partition of it exists to compute.
 */
function earClip(pts: readonly Vec2[]): number[][] | null {
    const live = pts.map((_, i) => i);
    const out: number[][] = [];
    while (live.length > 3) {
        let clipped = -1;
        for (let i = 0; i < live.length; i++) {
            const a = live[(i + live.length - 1) % live.length];
            const b = live[i];
            const c = live[(i + 1) % live.length];
            if (turn(pts[a], pts[b], pts[c]) <= 0) continue;
            let blocked = false;
            for (const k of live) {
                if (k === a || k === b || k === c) continue;
                if (inTriangle(pts[k], pts[a], pts[b], pts[c])) { blocked = true; break; }
            }
            if (blocked) continue;
            out.push([a, b, c]);
            clipped = i;
            break;
        }
        if (clipped < 0) return null;
        live.splice(clipped, 1);
    }
    out.push([live[0], live[1], live[2]]);
    return out;
}

/** Two pieces joined along the edge they share, with that edge's own endpoints. */
interface Join {
    ring: number[];
    u: number;
    v: number;
}

/** The two pieces joined along the edge they share, or null when they share none. */
function joined(a: readonly number[], b: readonly number[]): Join | null {
    for (let i = 0; i < a.length; i++) {
        const u = a[i];
        const v = a[(i + 1) % a.length];
        for (let j = 0; j < b.length; j++) {
            // A consistently wound partition traverses a shared edge in opposite
            // directions, which is what makes the walk below close.
            if (b[j] !== v || b[(j + 1) % b.length] !== u) continue;
            const ring: number[] = [];
            for (let k = 0; k < a.length - 1; k++) ring.push(a[(i + 1 + k) % a.length]);
            for (let k = 0; k < b.length - 1; k++) ring.push(b[(j + 1 + k) % b.length]);
            return { ring, u, v };
        }
    }
    return null;
}

/**
 * Merge neighbours back while each result stays convex and within the cap,
 * longest shared edge first. The candidate is tested for convexity outright
 * rather than at the two joints the merge creates: on a polygon capped at eight
 * vertices that walk is cheaper than being clever, and cannot mistake a winding.
 */
function mergePieces(pts: readonly Vec2[], pieces: number[][]): number[][] {
    const key = (u: number, v: number): number => u * pts.length + v;
    for (;;) {
        // Who owns each directed edge, so candidates come from adjacency rather
        // than from every pair: a hundred-point ring starts as ninety-eight
        // triangles, and all-pairs-every-round costs milliseconds.
        const owner = new Map<number, number>();
        for (let i = 0; i < pieces.length; i++) {
            const ring = pieces[i];
            for (let k = 0; k < ring.length; k++) owner.set(key(ring[k], ring[(k + 1) % ring.length]), i);
        }

        let best = -1;
        let bestA = -1;
        let bestB = -1;
        let bestRing: number[] | null = null;
        for (let i = 0; i < pieces.length; i++) {
            const ring = pieces[i];
            for (let k = 0; k < ring.length; k++) {
                const j = owner.get(key(ring[(k + 1) % ring.length], ring[k]));
                // `j > i` takes each neighbouring pair once: the shared edge is
                // reachable from both of its sides.
                if (j === undefined || j <= i) continue;
                if (ring.length + pieces[j].length - 2 > MAX_POLYGON_VERTICES) continue;
                const join = joined(ring, pieces[j]);
                if (!join || !isConvex(join.ring.map((n) => pts[n]))) continue;
                // What the merge buys: the shared edge stops being a wall between
                // two shapes. The longest one is the most wall removed.
                const u = pts[join.u];
                const v = pts[join.v];
                const value = (u.x - v.x) ** 2 + (u.y - v.y) ** 2;
                if (value <= best) continue;
                best = value;
                bestA = i;
                bestB = j;
                bestRing = join.ring;
            }
        }
        if (!bestRing) return pieces;
        pieces.splice(bestB, 1);
        pieces[bestA] = bestRing;
    }
}

/** What a collider ring collides as, once Box2D's two constraints are applied.
 *  Shared with every caller that asks about the same ring, so treat it as frozen. */
export interface PolygonDecomposition {
    /** Convex pieces, each counter-clockwise and within the solver's vertex cap. */
    readonly pieces: readonly Vec2[][];
    /** The ring crosses itself, so no partition of it exists: `pieces` is the
     *  convex hull, which is what the solver falls back to. */
    degenerate: boolean;
}

/**
 * One answer per vertex array: the gizmo asks about the same ring every frame,
 * and a hundred-vertex one measures milliseconds to partition. The key is the
 * ARRAY, so an edit writes a new one and misses — while a mutation in place hits
 * a stale entry, as does the solver, whose shapes that same flag rebuilds.
 */
const memo = new WeakMap<object, PolygonDecomposition>();

/**
 * The convex pieces `vertices` collides as. A ring already convex and within the
 * cap is ONE piece and the same points, so the common shape costs nothing and
 * keeps the identity an author drew.
 */
export function decomposePolygon2D(vertices: readonly Vec2[]): PolygonDecomposition {
    const hit = memo.get(vertices);
    if (hit) return hit;
    const out = partition(vertices);
    memo.set(vertices, out);
    return out;
}

function partition(vertices: readonly Vec2[]): PolygonDecomposition {
    const ring = normalize(vertices);
    if (ring.length < MIN_POLYGON_VERTICES) return { pieces: [], degenerate: false };

    // The hull is the solver's own verdict on whether these points are a shape at
    // all — welded down to a line, or to fewer than three. Asking it here keeps
    // the fast path below from handing back a ring Box2D would refuse.
    const hull = computePolygonHull(ring);
    if (hull.length < MIN_POLYGON_VERTICES) return { pieces: [], degenerate: false };

    if (selfIntersects(ring)) return { pieces: [hull], degenerate: true };
    if (ring.length <= MAX_POLYGON_VERTICES && isConvex(ring)) {
        return { pieces: [ring], degenerate: false };
    }

    const triangles = earClip(ring);
    if (!triangles) return { pieces: [hull], degenerate: true };

    // Each piece is finally what Box2D would make of it, so a sliver the solver
    // refuses is dropped where it can be seen rather than at shape creation.
    const pieces = mergePieces(ring, triangles)
        .map((indices) => computePolygonHull(indices.map((k) => ring[k])))
        .filter((piece) => piece.length >= MIN_POLYGON_VERTICES);
    return { pieces, degenerate: false };
}
