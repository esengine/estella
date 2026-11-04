// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  vectorPath.ts
 * @brief Polygons, polylines and strokes as geometry a MeshRenderer draws.
 *
 * A path is a list of points. {@link buildPathGeometry} turns it into the triangles of its fill (ear clipping, holes allowed) and of its
 * stroke (a width, a join at every corner, a cap at each end), with an optional feathered edge standing in for anti-aliasing where the
 * quality level draws without multisampling. The result is a {@link MeshRendererGeometry}: a MeshRenderer draws it, sorts it with every other
 * renderable, batches it, and a scene saves it the way it saves any mesh geometry, so a path costs no renderer of its own.
 *
 * Pure: no engine, no DOM. Curves are flattened here ({@link cubicBezier}, {@link quadraticBezier}, {@link circlePoints}) into the points a
 * stroke and a fill take.
 */
import type { MeshRendererGeometry } from '../ecs/component';
import type { Vec2 } from '../types';

/** Red, green, blue and alpha, each 0 to 1. */
export type PathColor = readonly [number, number, number, number];

/** How two stroked segments meet at a corner. */
export type LineJoin = 'miter' | 'round' | 'bevel';
/** How an open stroke ends. */
export type LineCap = 'butt' | 'round' | 'square';

/** @experimental */
export interface PathFill {
    color: PathColor;
    /** Rings cut out of the fill. Each is a list of points inside the outline. */
    holes?: readonly (readonly Vec2[])[];
}

/** @experimental */
export interface PathStroke {
    color: PathColor;
    /** The full width of the line, in the units of the points. */
    width: number;
    join?: LineJoin;
    cap?: LineCap;
    /** How far a miter may reach, as a multiple of half the width, before the corner is bevelled instead. Default 4. */
    miterLimit?: number;
}

/** @experimental */
export interface PathStyle {
    fill?: PathFill;
    stroke?: PathStroke;
    /** The outline joins its last point back to its first: a stroke has no caps, a fill needs it either way. Default false. */
    closed?: boolean;
    /** Width of a fade to transparent along every outer edge, in the units of the points: anti-aliasing for a surface drawn without multisampling. 0 (default) draws hard edges. */
    feather?: number;
    /** How finely a round join or cap is cut, as the angle one slice may turn through, in radians. Default 0.25. */
    arcStep?: number;
}

const EPS = 1e-6;

interface Builder {
    positions: number[];
    colors: number[];
    indices: number[];
}

const newBuilder = (): Builder => ({ positions: [], colors: [], indices: [] });

function vertex(b: Builder, x: number, y: number, c: PathColor, alpha = 1): number {
    b.positions.push(x, y);
    b.colors.push(c[0], c[1], c[2], c[3] * alpha);
    return b.positions.length / 2 - 1;
}

const tri = (b: Builder, a: number, c: number, d: number): void => { b.indices.push(a, c, d); };

/** Consecutive points nearer than this are one point. */
function dedupe(points: readonly Vec2[], closed: boolean): Vec2[] {
    const out: Vec2[] = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) out.push({ x: p.x, y: p.y });
    }
    if (closed && out.length > 1) {
        const first = out[0]!;
        const last = out[out.length - 1]!;
        if (Math.hypot(first.x - last.x, first.y - last.y) <= EPS) out.pop();
    }
    return out;
}

const signedArea = (ring: readonly Vec2[]): number => {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
};

// ---------------------------------------------------------------------------------------------------------------------
// Fill
// ---------------------------------------------------------------------------------------------------------------------

const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
    const d1 = cross2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
    const d2 = cross2(b.x - a.x, b.y - a.y, d.x - a.x, d.y - a.y);
    const d3 = cross2(d.x - c.x, d.y - c.y, a.x - c.x, a.y - c.y);
    const d4 = cross2(d.x - c.x, d.y - c.y, b.x - c.x, b.y - c.y);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/**
 * Joins each hole to the outline by a bridge (the shortest segment from a hole's point to the ring that crosses no edge), so the ring and its
 * holes are one ring that visits the bridge twice. Both are made counter-clockwise (outline) and clockwise (holes) first.
 */
function bridgeHoles(outline: Vec2[], holes: readonly (readonly Vec2[])[]): Vec2[] {
    let ring = outline.slice();
    const rings = holes
        .map((h) => dedupe(h, true))
        .filter((h) => h.length >= 3)
        .map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h))
        // The hole furthest right first: it cannot be hidden behind another that is joined already.
        .sort((a, b) => Math.max(...b.map((p) => p.x)) - Math.max(...a.map((p) => p.x)));
    for (const hole of rings) {
        let best: { r: number; h: number; d: number } | null = null;
        for (let h = 0; h < hole.length; h++) {
            for (let r = 0; r < ring.length; r++) {
                const d = Math.hypot(hole[h]!.x - ring[r]!.x, hole[h]!.y - ring[r]!.y);
                if (best && d >= best.d) continue;
                if (blocked(ring, rings, hole[h]!, ring[r]!)) continue;
                best = { r, h, d };
            }
        }
        if (!best) continue;
        const spliced: Vec2[] = [];
        for (let i = 0; i <= best.r; i++) spliced.push(ring[i]!);
        for (let k = 0; k <= hole.length; k++) spliced.push(hole[(best.h + k) % hole.length]!);
        spliced.push(ring[best.r]!);
        for (let i = best.r + 1; i < ring.length; i++) spliced.push(ring[i]!);
        ring = spliced;
    }
    return ring;
}

function blocked(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[], a: Vec2, b: Vec2): boolean {
    const crossesRing = (pts: readonly Vec2[]): boolean => {
        for (let i = 0; i < pts.length; i++) if (segmentsCross(a, b, pts[i]!, pts[(i + 1) % pts.length]!)) return true;
        return false;
    };
    if (crossesRing(ring)) return true;
    for (const h of holes) if (crossesRing(h)) return true;
    return false;
}

function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
    const d1 = cross2(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
    const d2 = cross2(c.x - b.x, c.y - b.y, p.x - b.x, p.y - b.y);
    const d3 = cross2(a.x - c.x, a.y - c.y, p.x - c.x, p.y - c.y);
    return d1 >= -EPS && d2 >= -EPS && d3 >= -EPS;
}

/** Triangles (as indices into `ring`) covering a counter-clockwise ring, which may visit a point twice (a bridge). */
function earClip(ring: readonly Vec2[]): number[] {
    const n = ring.length;
    const next: number[] = [];
    const prev: number[] = [];
    for (let i = 0; i < n; i++) { next.push((i + 1) % n); prev.push((i + n - 1) % n); }
    const out: number[] = [];
    let remaining = n;
    let i = 0;
    let guard = 0;
    const same = (p: Vec2, q: Vec2): boolean => Math.abs(p.x - q.x) <= EPS && Math.abs(p.y - q.y) <= EPS;
    while (remaining > 3 && guard++ < n * n) {
        const a = prev[i]!;
        const c = next[i]!;
        const pa = ring[a]!, pb = ring[i]!, pc = ring[c]!;
        let ear = cross2(pb.x - pa.x, pb.y - pa.y, pc.x - pb.x, pc.y - pb.y) > EPS;
        if (ear) {
            for (let k = next[c]!; k !== a; k = next[k]!) {
                const q = ring[k]!;
                // A point shared with the triangle is a bridge's other end, not something in the way.
                if (same(q, pa) || same(q, pb) || same(q, pc)) continue;
                if (pointInTriangle(q, pa, pb, pc)) { ear = false; break; }
            }
        }
        if (ear) {
            out.push(a, i, c);
            next[a] = c;
            prev[c] = a;
            --remaining;
            i = c;
            guard = 0;
        } else {
            i = next[i]!;
        }
    }
    if (remaining === 3) {
        const a = prev[i]!;
        out.push(a, i, next[i]!);
    } else if (remaining > 3) {
        // No ear was found (a ring that crosses itself): fan what is left rather than lose the shape.
        for (let k = next[i]!; next[k]! !== i; k = next[k]!) out.push(i, k, next[k]!);
    }
    return out;
}

function emitFill(b: Builder, outline: readonly Vec2[], fill: PathFill, feather: number): void {
    let ring = dedupe(outline, true);
    if (ring.length < 3) return;
    if (signedArea(ring) < 0) ring = ring.slice().reverse();
    const holes = (fill.holes ?? []).map((h) => dedupe(h, true)).filter((h) => h.length >= 3);
    const joined = holes.length ? bridgeHoles(ring, holes) : ring;
    const base = b.positions.length / 2;
    for (const p of joined) vertex(b, p.x, p.y, fill.color);
    for (const i of earClip(joined)) b.indices.push(base + i);
    if (feather <= 0) return;
    // A fade outward from the outline and inward from each hole: the edge of the fill is where the colour is a half.
    fringe(b, ring, fill.color, feather, 1);
    for (const h of holes) fringe(b, signedArea(h) > 0 ? h.slice().reverse() : h, fill.color, feather, -1);
}

/** A band of transparent-to-opaque quads along a counter-clockwise ring, `side` 1 outside it and -1 inside. */
function fringe(b: Builder, ring: readonly Vec2[], color: PathColor, width: number, side: 1 | -1): void {
    const n = ring.length;
    const inner: number[] = [];
    const outer: number[] = [];
    for (let i = 0; i < n; i++) {
        const p = ring[i]!, a = ring[(i + n - 1) % n]!, c = ring[(i + 1) % n]!;
        // Outward normals of the two edges at this point (counter-clockwise: outward is to the right of travel).
        const e0x = p.x - a.x, e0y = p.y - a.y, e1x = c.x - p.x, e1y = c.y - p.y;
        const l0 = Math.hypot(e0x, e0y) || 1, l1 = Math.hypot(e1x, e1y) || 1;
        let nx = e0y / l0 + e1y / l1;
        let ny = -(e0x / l0) - e1x / l1;
        const nl = Math.hypot(nx, ny);
        if (nl < EPS) { nx = e0y / l0; ny = -e0x / l0; } else { nx /= nl; ny /= nl; }
        // Where the two edges bend sharply the offset along the bisector grows by 1 / cos(half the turn); bounded so a spike stays a spike.
        const cosHalf = Math.max(nx * (e0y / l0) + ny * (-e0x / l0), 0.3);
        const d = (width / cosHalf) * side;
        inner.push(vertex(b, p.x, p.y, color));
        outer.push(vertex(b, p.x + nx * d, p.y + ny * d, color, 0));
    }
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(b, inner[i]!, outer[i]!, outer[j]!);
        tri(b, inner[i]!, outer[j]!, inner[j]!);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stroke
// ---------------------------------------------------------------------------------------------------------------------

/** One point of a stroke's outline with the direction that points away from the line there, for the feathered edge. */
interface Edge { index: number; x: number; y: number; ox: number; oy: number }

function emitStroke(b: Builder, input: readonly Vec2[], stroke: PathStroke, closed: boolean, feather: number, arcStep: number): void {
    const pts = dedupe(input, closed);
    const half = stroke.width / 2;
    if (pts.length < 2 || half <= 0) return;
    const n = pts.length;
    const join = stroke.join ?? 'miter';
    const cap = stroke.cap ?? 'butt';
    const limit = Math.max(stroke.miterLimit ?? 4, 1);
    const color = stroke.color;
    const segs = closed ? n : n - 1;

    // Direction and left normal of each segment.
    const dx: number[] = [], dy: number[] = [], len: number[] = [];
    for (let i = 0; i < segs; i++) {
        const a = pts[i]!, c = pts[(i + 1) % n]!;
        const l = Math.hypot(c.x - a.x, c.y - a.y);
        len.push(l);
        dx.push((c.x - a.x) / l);
        dy.push((c.y - a.y) / l);
    }

    // Per point: the point on the inside of the turn, and what the outside needs. `left`/`right` chains run along the line, in order, and hold
    // each outline point with its outward direction (the feathered edge is made from them).
    const leftIn: number[] = new Array(n).fill(-1), leftOut: number[] = new Array(n).fill(-1);
    const rightIn: number[] = new Array(n).fill(-1), rightOut: number[] = new Array(n).fill(-1);
    const left: Edge[] = [];
    const right: Edge[] = [];

    const push = (chain: Edge[], x: number, y: number, ox: number, oy: number): number => {
        const index = vertex(b, x, y, color);
        chain.push({ index, x, y, ox, oy });
        return index;
    };

    for (let i = 0; i < n; i++) {
        const p = pts[i]!;
        const hasPrev = closed || i > 0;
        const hasNext = closed || i < n - 1;
        const s0 = hasPrev ? (i + segs - 1) % segs : -1;
        const s1 = hasNext ? i % segs : -1;
        if (!hasPrev || !hasNext) {
            // An end: the normal of the one segment, set back by a square cap and fanned by a round one in {@link emitCap}.
            const s = hasNext ? s1 : s0;
            const ndx = dx[s]!, ndy = dy[s]!;
            const lx = -ndy, ly = ndx;
            const back = hasNext ? -1 : 1;
            const push0 = cap === 'square' ? half * back : 0;
            const bx = p.x + ndx * push0, by = p.y + ndy * push0;
            const l = push(left, bx + lx * half, by + ly * half, lx, ly);
            const r = push(right, bx - lx * half, by - ly * half, -lx, -ly);
            leftIn[i] = leftOut[i] = l;
            rightIn[i] = rightOut[i] = r;
            continue;
        }
        const d0x = dx[s0]!, d0y = dy[s0]!, d1x = dx[s1]!, d1y = dy[s1]!;
        const turn = cross2(d0x, d0y, d1x, d1y);
        const l0x = -d0y, l0y = d0x, l1x = -d1y, l1y = d1x;
        let mx = l0x + l1x, my = l0y + l1y;
        const ml = Math.hypot(mx, my);
        if (ml < EPS) { mx = l0x; my = l0y; } else { mx /= ml; my /= ml; }
        const cosHalf = Math.max(mx * l0x + my * l0y, 1e-3);
        // The inside of the turn: one point, where the two inner edges meet, held back so a short segment is not overrun.
        const reach = Math.min(half / cosHalf, Math.max(Math.min(len[s0]!, len[s1]!) / Math.max(Math.sqrt(1 - cosHalf * cosHalf) / cosHalf, 1e-3), half));
        // turn > 0: a left turn, the left side is the inside.
        const insideLeft = turn > 0;
        const straight = Math.abs(turn) < 1e-5 && d0x * d1x + d0y * d1y > 0;
        const miterRatio = 1 / cosHalf;
        const useMiter = straight || (join === 'miter' && miterRatio <= limit);
        const sign = insideLeft ? 1 : -1;     // +1: the left side is the inside
        const insideChain = insideLeft ? left : right;
        const outsideChain = insideLeft ? right : left;
        const insideIdx = insideLeft ? leftIn : rightIn, insideOut = insideLeft ? leftOut : rightOut;
        const outsideIdx = insideLeft ? rightIn : leftIn, outsideOutIdx = insideLeft ? rightOut : leftOut;
        // Inside point.
        const ip = push(insideChain, p.x + sign * mx * reach, p.y + sign * my * reach, sign * mx, sign * my);
        insideIdx[i] = insideOut[i] = ip;
        if (useMiter) {
            const oreach = half / cosHalf;
            const op = push(outsideChain, p.x - sign * mx * oreach, p.y - sign * my * oreach, -sign * mx, -sign * my);
            outsideIdx[i] = outsideOutIdx[i] = op;
            continue;
        }
        // The outside of the turn: the end of the incoming edge, an arc or nothing, the start of the outgoing one.
        const o0x = -sign * l0x, o0y = -sign * l0y, o1x = -sign * l1x, o1y = -sign * l1y;
        const first = push(outsideChain, p.x + o0x * half, p.y + o0y * half, o0x, o0y);
        outsideIdx[i] = first;
        let last = first;
        if (join === 'round') {
            const a0 = Math.atan2(o0y, o0x);
            let a1 = Math.atan2(o1y, o1x);
            let delta = a1 - a0;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const steps = Math.max(1, Math.ceil(Math.abs(delta) / arcStep));
            let prevIdx = first;
            for (let k = 1; k < steps; k++) {
                const a = a0 + (delta * k) / steps;
                const ax = Math.cos(a), ay = Math.sin(a);
                const mid = push(outsideChain, p.x + ax * half, p.y + ay * half, ax, ay);
                tri(b, ip, prevIdx, mid);
                prevIdx = mid;
            }
            last = push(outsideChain, p.x + o1x * half, p.y + o1y * half, o1x, o1y);
            tri(b, ip, prevIdx, last);
        } else {
            // Bevel (and a miter past its limit): the two outer corners joined by a straight edge.
            last = push(outsideChain, p.x + o1x * half, p.y + o1y * half, o1x, o1y);
            tri(b, ip, first, last);
        }
        outsideOutIdx[i] = last;
    }

    // The body: a quad per segment, from the end of one point's outline to the start of the next.
    for (let s = 0; s < segs; s++) {
        const i = s, j = (s + 1) % n;
        const lA = leftOut[i]!, rA = rightOut[i]!, lB = leftIn[j]!, rB = rightIn[j]!;
        tri(b, lA, rA, rB);
        tri(b, lA, rB, lB);
    }

    // Caps.
    if (!closed && cap === 'round') {
        emitRoundCap(b, pts[0]!, -dx[0]!, -dy[0]!, half, color, arcStep, leftIn[0]!, rightIn[0]!);
        emitRoundCap(b, pts[n - 1]!, dx[segs - 1]!, dy[segs - 1]!, half, color, arcStep, rightOut[n - 1]!, leftOut[n - 1]!);
    }

    if (feather > 0) {
        // The line's edge fades over `feather` beyond the outline. A closed line has two loops (outer and inner); an open one has one outline.
        const bandEdge = (chain: readonly Edge[]): void => {
            const outs: number[] = [];
            for (const e of chain) outs.push(vertex(b, e.x + e.ox * feather, e.y + e.oy * feather, color, 0));
            for (let k = 0; k + 1 < chain.length; k++) {
                tri(b, chain[k]!.index, outs[k]!, outs[k + 1]!);
                tri(b, chain[k]!.index, outs[k + 1]!, chain[k + 1]!.index);
            }
            if (closed && chain.length > 2) {
                const k = chain.length - 1;
                tri(b, chain[k]!.index, outs[k]!, outs[0]!);
                tri(b, chain[k]!.index, outs[0]!, chain[0]!.index);
            }
        };
        bandEdge(left);
        bandEdge(right);
        if (!closed) {
            // Butt and square ends fade across the end face.
            if (cap !== 'round') {
                for (const [first, second, dirx, diry] of [
                    [left[0]!, right[0]!, -dx[0]!, -dy[0]!],
                    [left[left.length - 1]!, right[right.length - 1]!, dx[segs - 1]!, dy[segs - 1]!],
                ] as const) {
                    const a = vertex(b, first.x + dirx * feather, first.y + diry * feather, color, 0);
                    const c = vertex(b, second.x + dirx * feather, second.y + diry * feather, color, 0);
                    tri(b, first.index, a, c);
                    tri(b, first.index, c, second.index);
                }
            }
        }
    }
}

/** A half circle of `radius` at `center` bulging along (dirx, diry), between two outline points already placed. */
function emitRoundCap(b: Builder, center: Vec2, dirx: number, diry: number, radius: number, color: PathColor, arcStep: number, from: number, to: number): void {
    const a0 = Math.atan2(diry, dirx) - Math.PI / 2;
    const steps = Math.max(2, Math.ceil(Math.PI / arcStep));
    const c = vertex(b, center.x, center.y, color);
    let prev = from;
    for (let k = 1; k < steps; k++) {
        const a = a0 + (Math.PI * k) / steps;
        const v = vertex(b, center.x + Math.cos(a) * radius, center.y + Math.sin(a) * radius, color);
        tri(b, c, prev, v);
        prev = v;
    }
    tri(b, c, prev, to);
}

// ---------------------------------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The geometry of a path: its fill, then its stroke on top, as one mesh in the path's own coordinates.
 * An empty result (fewer than the points a shape needs) is a mesh with nothing in it, which draws nothing.
 * @experimental
 */
export function buildPathGeometry(points: readonly Vec2[], style: PathStyle): MeshRendererGeometry {
    const b = newBuilder();
    const feather = Math.max(style.feather ?? 0, 0);
    const arcStep = Math.max(style.arcStep ?? 0.25, 0.05);
    const closed = style.closed ?? false;
    if (style.fill) emitFill(b, points, style.fill, feather);
    if (style.stroke) emitStroke(b, points, style.stroke, closed, feather, arcStep);
    return { positions: b.positions, colors: b.colors, indices: b.indices };
}

/** The geometry of several paths drawn into one mesh, in order. */
export function mergeGeometry(parts: readonly MeshRendererGeometry[]): MeshRendererGeometry {
    const out: MeshRendererGeometry = { positions: [], colors: [], indices: [] };
    for (const part of parts) {
        const base = out.positions.length / 2;
        for (const v of part.positions) out.positions.push(v);
        for (const c of part.colors ?? []) out.colors!.push(c);
        for (const i of part.indices) out.indices.push(base + i);
    }
    return out;
}

/** A cubic Bezier curve as points, cut finely enough that no point is further than `tolerance` from the curve. @experimental */
export function cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tolerance = 0.25): Vec2[] {
    // The flatness bound of a Bezier: the control polygon's distance from its chord says how many pieces keep the error under tolerance.
    const ux = 3 * p1.x - 2 * p0.x - p3.x, uy = 3 * p1.y - 2 * p0.y - p3.y;
    const vx = 3 * p2.x - 2 * p3.x - p0.x, vy = 3 * p2.y - 2 * p3.y - p0.y;
    const dev = Math.sqrt(Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy));
    const steps = Math.min(Math.max(Math.ceil(Math.sqrt(dev / (4 * Math.max(tolerance, 1e-4)))), 1), 256);
    const out: Vec2[] = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps, m = 1 - t;
        out.push({
            x: m * m * m * p0.x + 3 * m * m * t * p1.x + 3 * m * t * t * p2.x + t * t * t * p3.x,
            y: m * m * m * p0.y + 3 * m * m * t * p1.y + 3 * m * t * t * p2.y + t * t * t * p3.y,
        });
    }
    return out;
}

/** A quadratic Bezier curve as points. @experimental */
export function quadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, tolerance = 0.25): Vec2[] {
    // Raised to a cubic: one flattening to keep right.
    const c1 = { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) };
    const c2 = { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) };
    return cubicBezier(p0, c1, c2, p2, tolerance);
}

/** The points of a circle (or a slice of one: angles in radians, counter-clockwise from +x). @experimental */
export function circlePoints(cx: number, cy: number, radius: number, segments = 0, startAngle = 0, endAngle = Math.PI * 2): Vec2[] {
    const full = Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-9;
    const n = segments > 0 ? segments : Math.max(Math.ceil(Math.abs(endAngle - startAngle) / Math.max(Math.acos(1 - 0.25 / Math.max(radius, 0.25)) * 2, 0.05)), 8);
    const out: Vec2[] = [];
    const count = full ? n : n + 1;
    for (let i = 0; i < count; i++) {
        const a = startAngle + ((endAngle - startAngle) * i) / n;
        out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    return out;
}

/**
 * The triangles (indices into `ring`) that cover a simple polygon, whichever way round it is given.
 * @experimental
 */
export function triangulateRing(ring: readonly Vec2[]): number[] {
    if (ring.length < 3) return [];
    if (signedArea(ring) >= 0) return earClip(ring);
    // Clockwise: clip the reverse and map the indices back.
    const n = ring.length;
    return earClip(ring.slice().reverse()).map((i) => n - 1 - i);
}
