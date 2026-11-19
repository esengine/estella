// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    curve.ts
 * @brief   A smooth curve through a list of points, measured by the distance along it.
 *
 * @details A centripetal Catmull-Rom curve (it passes through every point and does not loop where they are unevenly spaced) cut into short straight pieces, with the length of each summed, so a place on
 *          the curve is a distance `s` from its start and not a parameter that runs fast where the points are close and slow where
 *          they are far. That is what a river's width and speed, a road's banking or a rail's pace are written against. The points are
 *          in the curve's own space; where it is in the world is its entity's Transform.
 *
 *          Each point carries a width, interpolated along the curve (a river narrows at a rapid, a road widens at a junction).
 */

/** A point of a curve: where it is, and how wide the thing along it is there. */
export interface SplinePoint {
    x: number;
    y: number;
    z: number;
    width: number;
}

/** Where on a curve a point is nearest, and how far from it. */
export interface SplineNearest {
    /** The distance along the curve. */
    s: number;
    /** The distance from the query point to the curve. */
    distance: number;
    /** Which side of the curve the point is on: the sign of the xz cross product of the curve's heading and the offset to the point. */
    side: number;
}

const SAMPLES_PER_SEGMENT = 16;

/** The curve through `points`, open or closed. */
export class SplineCurve {
    /** The straight pieces the curve is cut into: positions, widths, and the distance along the curve at each (one longer than the pieces). */
    private readonly px: Float64Array;
    private readonly py: Float64Array;
    private readonly pz: Float64Array;
    private readonly pw: Float64Array;
    private readonly ps: Float64Array;
    readonly count: number;
    /** The length of the curve. */
    readonly length: number;
    readonly closed: boolean;

    constructor(points: readonly SplinePoint[], closed = false) {
        this.closed = closed && points.length >= 3;
        const n = points.length;
        const segments = n < 2 ? 0 : this.closed ? n : n - 1;
        const total = segments * SAMPLES_PER_SEGMENT + (this.closed ? 0 : 1);
        const count = n === 0 ? 0 : n === 1 ? 1 : total;
        this.count = count;
        this.px = new Float64Array(count); this.py = new Float64Array(count); this.pz = new Float64Array(count);
        this.pw = new Float64Array(count); this.ps = new Float64Array(count);
        if (n === 1) { this.px[0] = points[0]!.x; this.py[0] = points[0]!.y; this.pz[0] = points[0]!.z; this.pw[0] = points[0]!.width; }
        // Past either end of an open curve the points go on in the line the last two make, which keeps the curve's end from curling back.
        const at = (i: number): SplinePoint => {
            if (this.closed) return points[((i % n) + n) % n]!;
            if (i < 0) { const a = points[0]!, b = points[1]!; return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z, width: a.width }; }
            if (i >= n) { const a = points[n - 1]!, b = points[n - 2]!; return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z, width: a.width }; }
            return points[i]!;
        };
        let k = 0;
        for (let seg = 0; seg < segments; seg++) {
            const p0 = at(seg - 1), p1 = at(seg), p2 = at(seg + 1), p3 = at(seg + 2);
            const last = !this.closed && seg === segments - 1;
            for (let j = 0; j < SAMPLES_PER_SEGMENT + (last ? 1 : 0); j++) {
                const t = j / SAMPLES_PER_SEGMENT;
                const at3 = centripetal(p0, p1, p2, p3, t);
                this.px[k] = at3[0];
                this.py[k] = at3[1];
                this.pz[k] = at3[2];
                // Widths blend along the segment: a smooth ease, so a width does not turn a corner at a point.
                this.pw[k] = p1.width + (p2.width - p1.width) * (t * t * (3 - 2 * t));
                k++;
            }
        }
        let length = 0;
        for (let i = 0; i < count; i++) {
            if (i > 0) length += Math.hypot(this.px[i]! - this.px[i - 1]!, this.py[i]! - this.py[i - 1]!, this.pz[i]! - this.pz[i - 1]!);
            this.ps[i] = length;
        }
        if (this.closed && count > 0) length += Math.hypot(this.px[0]! - this.px[count - 1]!, this.py[0]! - this.py[count - 1]!, this.pz[0]! - this.pz[count - 1]!);
        this.length = length;
    }

    /** The index of the piece `s` falls in, and how far along it (0 to 1). */
    private locate(s: number): [number, number] {
        const n = this.count;
        if (n < 2) return [0, 0];
        const wrapped = this.closed ? ((s % this.length) + this.length) % this.length : Math.min(Math.max(s, 0), this.length);
        let lo = 0, hi = n - 1;
        // The last piece of a closed curve runs from the last sample back to the first, past the end of the table.
        const tail = this.closed ? this.ps[n - 1]! : Infinity;
        if (this.closed && wrapped >= tail) return [n - 1, (wrapped - tail) / Math.max(this.length - tail, 1e-12)];
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.ps[mid]! <= wrapped) lo = mid; else hi = mid;
        }
        const span = this.ps[lo + 1]! - this.ps[lo]!;
        return [lo, span > 0 ? (wrapped - this.ps[lo]!) / span : 0];
    }

    private next(i: number): number { return this.closed ? (i + 1) % this.count : Math.min(i + 1, this.count - 1); }

    /** The point a distance `s` along the curve. Past either end of an open curve it is the end; a closed curve goes round. */
    position(s: number): [number, number, number] {
        if (this.count === 0) return [0, 0, 0];
        const [i, t] = this.locate(s);
        const j = this.next(i);
        return [lerp(this.px[i]!, this.px[j]!, t), lerp(this.py[i]!, this.py[j]!, t), lerp(this.pz[i]!, this.pz[j]!, t)];
    }

    /** The unit direction of travel at distance `s`. */
    tangent(s: number): [number, number, number] {
        if (this.count < 2) return [0, 0, 1];
        const [i] = this.locate(s);
        const j = this.next(i);
        let dx = this.px[j]! - this.px[i]!, dy = this.py[j]! - this.py[i]!, dz = this.pz[j]! - this.pz[i]!;
        if (j === i) { dx = this.px[i]! - this.px[i - 1]!; dy = this.py[i]! - this.py[i - 1]!; dz = this.pz[i]! - this.pz[i - 1]!; }
        const len = Math.hypot(dx, dy, dz) || 1;
        return [dx / len, dy / len, dz / len];
    }

    /** The width at distance `s`. */
    width(s: number): number {
        if (this.count === 0) return 0;
        const [i, t] = this.locate(s);
        return lerp(this.pw[i]!, this.pw[this.next(i)]!, t);
    }

    /** Where on the curve (x, z) is nearest, measured in the xz plane. */
    nearest(x: number, z: number): SplineNearest {
        let bestD2 = Infinity, bestS = 0, bestSide = 0;
        const pieces = this.closed ? this.count : this.count - 1;
        for (let i = 0; i < pieces; i++) {
            const j = this.next(i);
            const ax = this.px[i]!, az = this.pz[i]!;
            const ex = this.px[j]! - ax, ez = this.pz[j]! - az;
            const len2 = ex * ex + ez * ez;
            const t = len2 > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / len2, 0), 1) : 0;
            const dx = x - (ax + t * ex), dz = z - (az + t * ez);
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                const pieceLength = i === this.count - 1 ? this.length - this.ps[i]! : this.ps[j]! - this.ps[i]!;
                bestS = this.ps[i]! + t * pieceLength;
                bestSide = Math.sign(ex * dz - ez * dx);
            }
        }
        return { s: bestS, distance: Math.sqrt(bestD2), side: bestSide };
    }

    /** The distance along the curve of its point nearest (x, y, z), measured in all three axes: a track that climbs is not flattened. */
    nearestDistance(x: number, y: number, z: number): number {
        let bestD2 = Infinity, bestS = 0;
        const pieces = this.closed ? this.count : this.count - 1;
        for (let i = 0; i < pieces; i++) {
            const j = this.next(i);
            const ax = this.px[i]!, ay = this.py[i]!, az = this.pz[i]!;
            const ex = this.px[j]! - ax, ey = this.py[j]! - ay, ez = this.pz[j]! - az;
            const len2 = ex * ex + ey * ey + ez * ez;
            const t = len2 > 0 ? Math.min(Math.max(((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / len2, 0), 1) : 0;
            const dx = x - (ax + t * ex), dy = y - (ay + t * ey), dz = z - (az + t * ez);
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < bestD2) {
                bestD2 = d2;
                const pieceLength = i === this.count - 1 ? this.length - this.ps[i]! : this.ps[j]! - this.ps[i]!;
                bestS = this.ps[i]! + t * pieceLength;
            }
        }
        return bestS;
    }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/**
 * The centripetal Catmull-Rom curve between p1 and p2 (`t` 0 to 1), through p0 and p3: its knots are spaced by the square root of the distance
 * between points, which is what keeps it from looping or cusping where the points are close at one end and far at the other, as the
 * uniform one does.
 */
function centripetal(p0: SplinePoint, p1: SplinePoint, p2: SplinePoint, p3: SplinePoint, t: number): [number, number, number] {
    const knot = (a: SplinePoint, b: SplinePoint): number => Math.max(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) ** 0.5, 1e-4);
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
    const u = t1 + t * (t2 - t1);
    const mix = (a: [number, number, number], b: [number, number, number], ta: number, tb: number): [number, number, number] => {
        const wa = (tb - u) / (tb - ta), wb = (u - ta) / (tb - ta);
        return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
    };
    const v = (p: SplinePoint): [number, number, number] => [p.x, p.y, p.z];
    const a1 = mix(v(p0), v(p1), t0, t1), a2 = mix(v(p1), v(p2), t1, t2), a3 = mix(v(p2), v(p3), t2, t3);
    const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
    return mix(b1, b2, t1, t2);
}
