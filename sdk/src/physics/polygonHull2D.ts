// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    polygonHull2D.ts
 * @brief   The polygon Box2D actually builds from one set of points.
 *
 * @details Handing `b2CreatePolygonShape` a ring is not handing it that ring: it
 *          takes the CONVEX HULL, welding points within slop, dropping ones its
 *          neighbours already span, and refusing the lot when fewer than three
 *          survive. A caller that does not know this draws shapes nobody can hit.
 *
 *          A port of `b2ComputeHull` (third_party/box2d/src/hull.c), kept faithful
 *          to its welding and collinear slop because its whole job is AGREEMENT.
 *          Concavity is answered a level up, in {@link decomposePolygon2D}, which
 *          uses this to know what the solver will make of each piece it proposes.
 *
 *          Units are physics metres — the slop below is metres, so a hull
 *          computed in pixels would weld at a thousand times the real tolerance.
 */
import type { Vec2 } from '../types';

/**
 * The most vertices Box2D stores in ONE polygon (`B2_MAX_POLYGON_VERTICES`). It
 * caps a convex piece, not what an author may draw: a ring past it is divided
 * into pieces that each fit.
 */
export const MAX_POLYGON_VERTICES = 8;

/** Fewer than a triangle is not a polygon: Box2D builds no shape from it. */
export const MIN_POLYGON_VERTICES = 3;

/** `B2_LINEAR_SLOP`, at the engine's length unit of one metre per metre. */
const LINEAR_SLOP = 0.005;

const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

function normalize(v: Vec2): Vec2 {
    const len = Math.hypot(v.x, v.y);
    return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
}

/** Quickhull's recursion: the hull of `ps` strictly right of the edge p1→p2. */
function recurseHull(p1: Vec2, p2: Vec2, ps: readonly Vec2[]): Vec2[] {
    if (ps.length === 0) return [];
    const e = normalize(sub(p2, p1));

    const right: Vec2[] = [];
    let best = 0;
    let bestDistance = cross(sub(ps[0], p1), e);
    if (bestDistance > 0) right.push(ps[0]);
    for (let i = 1; i < ps.length; i++) {
        const d = cross(sub(ps[i], p1), e);
        if (d > bestDistance) {
            best = i;
            bestDistance = d;
        }
        if (d > 0) right.push(ps[i]);
    }
    if (bestDistance < 2 * LINEAR_SLOP) return [];

    const apex = ps[best];
    return [...recurseHull(p1, apex, right), apex, ...recurseHull(apex, p2, right)];
}

/**
 * The convex hull Box2D builds from `vertices`, counter-clockwise, in metres.
 * Empty when Box2D builds no shape: fewer than three vertices survive welding,
 * or every surviving one is collinear.
 */
export function computePolygonHull(vertices: readonly Vec2[]): Vec2[] {
    if (vertices.length < MIN_POLYGON_VERTICES) return [];
    const points = vertices.slice(0, MAX_POLYGON_VERTICES);

    // Aggressive welding, first point winning, exactly as the solver does it: a
    // vertex dragged onto its neighbour vanishes from the shape rather than
    // narrowing it.
    const tolSq = 16 * LINEAR_SLOP * LINEAR_SLOP;
    let lower = { x: Infinity, y: Infinity };
    let upper = { x: -Infinity, y: -Infinity };
    const ps: Vec2[] = [];
    for (const v of points) {
        lower = { x: Math.min(lower.x, v.x), y: Math.min(lower.y, v.y) };
        upper = { x: Math.max(upper.x, v.x), y: Math.max(upper.y, v.y) };
        if (!ps.some((q) => distSq(v, q) < tolSq)) ps.push(v);
    }
    if (ps.length < MIN_POLYGON_VERTICES) return [];

    // The two seeds: the point furthest from the AABB centre, then the point
    // furthest from that one. Each leaves the working set by swapping in its last
    // member, which is what fixes the order the rest is split in.
    const centre = { x: (lower.x + upper.x) / 2, y: (lower.y + upper.y) / 2 };
    let f = 0;
    for (let i = 1; i < ps.length; i++) if (distSq(centre, ps[i]) > distSq(centre, ps[f])) f = i;
    const p1 = ps[f];
    ps[f] = ps[ps.length - 1];
    ps.pop();

    f = 0;
    for (let i = 1; i < ps.length; i++) if (distSq(p1, ps[i]) > distSq(p1, ps[f])) f = i;
    const p2 = ps[f];
    ps[f] = ps[ps.length - 1];
    ps.pop();

    const e = normalize(sub(p2, p1));
    const right: Vec2[] = [];
    const left: Vec2[] = [];
    for (const v of ps) {
        const d = cross(sub(v, p1), e);
        if (d >= 2 * LINEAR_SLOP) right.push(v);
        else if (d <= -2 * LINEAR_SLOP) left.push(v);
    }

    const above = recurseHull(p1, p2, right);
    const below = recurseHull(p2, p1, left);
    if (above.length === 0 && below.length === 0) return [];

    const hull = [p1, ...above, p2, ...below];
    return mergeCollinear(hull);
}

/** Drop every vertex its two neighbours already span, until none is left. */
function mergeCollinear(hull: Vec2[]): Vec2[] {
    for (let searching = true; searching && hull.length > 2;) {
        searching = false;
        for (let i = 0; i < hull.length; i++) {
            const s1 = hull[i];
            const s2 = hull[(i + 1) % hull.length];
            const s3 = hull[(i + 2) % hull.length];
            if (cross(sub(s2, s1), normalize(sub(s3, s1))) <= 2 * LINEAR_SLOP) {
                hull.splice((i + 1) % hull.length, 1);
                searching = true;
                break;
            }
        }
    }
    return hull;
}
