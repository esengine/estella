// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    contours.ts
 * @brief   Walk the outline of every region and simplify it into a few corners.
 *
 * A region is thousands of cells; its shape is a dozen. The walk follows the
 * boundary cell by cell, then the simplifier keeps only the corners the outline
 * cannot be drawn without: the ones where the region on the other side changes
 * (those are the doorways between regions, and dropping one would tear the mesh
 * in two), plus enough of the rest to stay within `maxError` of the raw edge.
 *
 * Two regions that touch each trace the shared boundary from their own side, in
 * opposite directions. They must land on the SAME corners, or the polygons will
 * not share vertices and the finished mesh will have a seam no agent can cross —
 * which is why the deviation is measured in a fixed order rather than along the
 * direction of travel.
 */

import { DIR_X, DIR_Z } from './heightfield';
import type { NavCompactField } from './compact';

/** One region's outline: `x, y, z` voxel coordinates per vertex. */
export interface NavContour {
    verts: Int32Array;
    reg: number;
}

/**
 * @param maxError   How far, in cells, the simplified outline may stray from the
 *                   raw one.
 * @param maxEdgeLen How long a wall edge may get before it is split, in cells.
 *                   Long edges make big polygons and coarse routes along them;
 *                   0 leaves them alone.
 */
export function buildContours(
    chf: NavCompactField, maxError: number, maxEdgeLen: number,
): NavContour[] {
    const { width: w, depth: d } = chf;
    const flags = new Uint8Array(chf.spanCount);

    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                if (chf.regs[i] === 0) { flags[i] = 0; continue; }
                let same = 0;
                for (let dir = 0; dir < 4; dir++) {
                    const ni = chf.neighbourSpan(x, z, i, dir);
                    const r = ni >= 0 ? chf.regs[ni]! : 0;
                    if (r === chf.regs[i]) same |= 1 << dir;
                }
                // Invert: the bits left standing are the sides that face OUT.
                flags[i] = same ^ 0xf;
            }
        }
    }

    const contours: NavContour[] = [];
    const raw: number[] = [];
    const simplified: number[] = [];

    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                // 0xf is a span with no neighbour on any side — a single cell of
                // ground, which has an outline but no interior to walk.
                if (flags[i] === 0 || flags[i] === 0xf) { flags[i] = 0; continue; }
                const reg = chf.regs[i]!;
                if (reg === 0) continue;

                raw.length = 0;
                simplified.length = 0;
                walkContour(chf, flags, x, z, i, raw);
                simplifyContour(raw, simplified, maxError, maxEdgeLen);
                removeDegenerateSegments(simplified);
                if (simplified.length / 4 < 3) continue;

                contours.push({ verts: windCorrectly(simplified), reg });
            }
        }
    }

    return contours;
}

/**
 * Follow the boundary of one region, emitting a vertex per outward-facing cell
 * edge and clearing each edge as it is used, so no boundary is walked twice.
 * Turning right along an outward edge and left through an inward one is what
 * keeps the walk on the outline instead of wandering into the region.
 */
function walkContour(
    chf: NavCompactField, flags: Uint8Array,
    startX: number, startZ: number, startI: number, out: number[],
): void {
    let dir = 0;
    while ((flags[startI]! & (1 << dir)) === 0) dir++;

    const startDir = dir;
    let x = startX;
    let z = startZ;
    let i = startI;

    // A contour cannot be longer than the field has edges; the cap is a guard
    // against a malformed field turning into a hang, not an expected limit.
    for (let iter = 0; iter < 1 << 20; iter++) {
        if (flags[i]! & (1 << dir)) {
            let px = x;
            let pz = z;
            const py = cornerHeight(chf, x, z, i, dir);
            if (dir === 0) pz++;
            else if (dir === 1) { px++; pz++; }
            else if (dir === 2) px++;

            const ni = chf.neighbourSpan(x, z, i, dir);
            out.push(px, py, pz, ni >= 0 ? chf.regs[ni]! : 0);

            flags[i] = flags[i]! & ~(1 << dir);
            dir = (dir + 1) & 3;
        } else {
            const ni = chf.neighbourSpan(x, z, i, dir);
            if (ni < 0) return;
            x += DIR_X[dir]!;
            z += DIR_Z[dir]!;
            i = ni;
            dir = (dir + 3) & 3;
        }
        if (i === startI && dir === startDir) break;
    }
}

/**
 * The height of the corner between this cell and the three around it — the
 * highest floor of the four, so a contour vertex sits on top of the step rather
 * than inside it.
 */
function cornerHeight(chf: NavCompactField, x: number, z: number, i: number, dir: number): number {
    let ch = chf.y[i]!;
    const dirp = (dir + 1) & 3;

    const a = chf.neighbourSpan(x, z, i, dir);
    if (a >= 0) {
        ch = Math.max(ch, chf.y[a]!);
        const a2 = chf.neighbourSpan(x + DIR_X[dir]!, z + DIR_Z[dir]!, a, dirp);
        if (a2 >= 0) ch = Math.max(ch, chf.y[a2]!);
    }
    const b = chf.neighbourSpan(x, z, i, dirp);
    if (b >= 0) {
        ch = Math.max(ch, chf.y[b]!);
        const b2 = chf.neighbourSpan(x + DIR_X[dirp]!, z + DIR_Z[dirp]!, b, dir);
        if (b2 >= 0) ch = Math.max(ch, chf.y[b2]!);
    }
    return ch;
}

/** Squared distance from a point to a segment, in the ground plane. */
function distancePtSeg(x: number, z: number, px: number, pz: number, qx: number, qz: number): number {
    const pqx = qx - px;
    const pqz = qz - pz;
    let dx = x - px;
    let dz = z - pz;
    const d = pqx * pqx + pqz * pqz;
    let t = pqx * dx + pqz * dz;
    if (d > 0) t /= d;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    dx = px + t * pqx - x;
    dz = pz + t * pqz - z;
    return dx * dx + dz * dz;
}

function simplifyContour(
    points: number[], simplified: number[], maxError: number, maxEdgeLen: number,
): void {
    const pn = points.length / 4;

    let hasPortals = false;
    for (let i = 0; i < pn; i++) {
        if (points[i * 4 + 3] !== 0) { hasPortals = true; break; }
    }

    if (hasPortals) {
        // Every place the region on the other side changes is a doorway, and both
        // sides of it must agree where it starts — so it is kept, always.
        for (let i = 0; i < pn; i++) {
            const ii = (i + 1) % pn;
            if (points[i * 4 + 3] === points[ii * 4 + 3]) continue;
            simplified.push(points[i * 4]!, points[i * 4 + 1]!, points[i * 4 + 2]!, i);
        }
    }

    if (simplified.length === 0) {
        // An outline touching nothing has no fixed points of its own; two
        // opposite extremes give the refinement below something to work from.
        let llx = points[0]!, lly = points[1]!, llz = points[2]!, lli = 0;
        let urx = llx, ury = lly, urz = llz, uri = 0;
        for (let i = 0; i < pn; i++) {
            const x = points[i * 4]!, y = points[i * 4 + 1]!, z = points[i * 4 + 2]!;
            if (x < llx || (x === llx && z < llz)) { llx = x; lly = y; llz = z; lli = i; }
            if (x > urx || (x === urx && z > urz)) { urx = x; ury = y; urz = z; uri = i; }
        }
        simplified.push(llx, lly, llz, lli, urx, ury, urz, uri);
    }

    for (let i = 0; i < simplified.length / 4;) {
        const ii = (i + 1) % (simplified.length / 4);
        let ax = simplified[i * 4]!;
        let az = simplified[i * 4 + 2]!;
        const ai = simplified[i * 4 + 3]!;
        let bx = simplified[ii * 4]!;
        let bz = simplified[ii * 4 + 2]!;
        const bi = simplified[ii * 4 + 3]!;

        let maxd = 0;
        let maxi = -1;
        let ci: number;
        let cinc: number;
        let endi: number;

        // Walk the raw points in a fixed order regardless of which way this
        // segment runs, so the region on the other side measures the same
        // deviation and keeps the same corner.
        if (bx > ax || (bx === ax && bz > az)) {
            cinc = 1; ci = (ai + 1) % pn; endi = bi;
        } else {
            cinc = pn - 1; ci = (bi + cinc) % pn; endi = ai;
            const tx = ax; ax = bx; bx = tx;
            const tz = az; az = bz; bz = tz;
        }

        // Only walls are refined: a segment shared with another region already
        // runs doorway to doorway, and bending it would bend only this side.
        if (points[ci * 4 + 3] === 0) {
            while (ci !== endi) {
                const d = distancePtSeg(points[ci * 4]!, points[ci * 4 + 2]!, ax, az, bx, bz);
                if (d > maxd) { maxd = d; maxi = ci; }
                ci = (ci + cinc) % pn;
            }
        }

        if (maxi !== -1 && maxd > maxError * maxError) {
            simplified.splice((i + 1) * 4, 0,
                points[maxi * 4]!, points[maxi * 4 + 1]!, points[maxi * 4 + 2]!, maxi);
        } else {
            i++;
        }
    }

    if (maxEdgeLen > 0) splitLongEdges(points, simplified, pn, maxEdgeLen);

    // Each vertex ends up carrying the region across the edge that LEAVES it.
    for (let i = 0; i < simplified.length / 4; i++) {
        const next = (simplified[i * 4 + 3]! + 1) % pn;
        simplified[i * 4 + 3] = points[next * 4 + 3]!;
    }
}

function splitLongEdges(points: number[], simplified: number[], pn: number, maxEdgeLen: number): void {
    for (let i = 0; i < simplified.length / 4;) {
        const n = simplified.length / 4;
        const ii = (i + 1) % n;
        const ax = simplified[i * 4]!;
        const az = simplified[i * 4 + 2]!;
        const ai = simplified[i * 4 + 3]!;
        const bx = simplified[ii * 4]!;
        const bz = simplified[ii * 4 + 2]!;
        const bi = simplified[ii * 4 + 3]!;

        let maxi = -1;
        const ci = (ai + 1) % pn;
        if (points[ci * 4 + 3] === 0) {
            const dx = bx - ax;
            const dz = bz - az;
            if (dx * dx + dz * dz > maxEdgeLen * maxEdgeLen) {
                const span = bi < ai ? bi + pn - ai : bi - ai;
                if (span > 1) {
                    maxi = bx > ax || (bx === ax && bz > az)
                        ? (ai + (span >> 1)) % pn
                        : (ai + ((span + 1) >> 1)) % pn;
                }
            }
        }

        if (maxi !== -1) {
            simplified.splice((i + 1) * 4, 0,
                points[maxi * 4]!, points[maxi * 4 + 1]!, points[maxi * 4 + 2]!, maxi);
        } else {
            i++;
        }
    }
}

/** Neighbouring vertices that share a spot in the ground plane confuse the
 *  triangulator, and a zero-length edge is not a shape. */
function removeDegenerateSegments(simplified: number[]): void {
    let n = simplified.length / 4;
    for (let i = 0; i < n; i++) {
        const ni = (i + 1) % n;
        if (simplified[i * 4] !== simplified[ni * 4]
            || simplified[i * 4 + 2] !== simplified[ni * 4 + 2]) continue;
        simplified.splice(i * 4, 4);
        n--;
        i--;
    }
}

/**
 * Every contour comes out wound the same way, so that the triangulator, the
 * polygon merger and the funnel can each assume a side without asking. The
 * measure is twice the signed area in the ground plane; a walk that produced the
 * mirror of it is simply reversed.
 */
function windCorrectly(simplified: number[]): Int32Array {
    const n = simplified.length / 4;
    let area = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        area += simplified[i * 4]! * simplified[j * 4 + 2]! - simplified[j * 4]! * simplified[i * 4 + 2]!;
    }

    const out = new Int32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const src = area > 0 ? i : n - 1 - i;
        out[i * 3] = simplified[src * 4]!;
        out[i * 3 + 1] = simplified[src * 4 + 1]!;
        out[i * 3 + 2] = simplified[src * 4 + 2]!;
    }
    return out;
}
