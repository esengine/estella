// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    polymesh.ts
 * @brief   Turn region outlines into convex polygons that know their neighbours.
 *
 * Convex is the point: inside one polygon an agent can walk from any point to
 * any other in a straight line, so a route only ever has to name the polygons it
 * crosses and the doorways between them. Getting there is ear clipping, then
 * merging the resulting triangles back into the biggest convex shapes that still
 * fit — fewer, larger polygons mean a shorter search and a straighter path.
 *
 * Vertices are shared between contours: two regions that touch traced the same
 * corners, so they land on the same vertex indices and their polygons come out
 * adjacent. Vertices at the same spot but far apart in height stay separate,
 * which is what keeps a bridge from being welded to the road under it.
 */

import type { NavContour } from './contours';

/** No polygon on this edge. */
export const NAV_NO_NEIGHBOUR = -1;

export interface NavPolyMesh {
    /** `x, y, z` voxel coordinates per vertex. */
    verts: Int32Array;
    vertCount: number;
    /** `maxVertsPerPoly` vertex indices per polygon, padded with -1. */
    polys: Int32Array;
    /** `maxVertsPerPoly` neighbour polygon indices, one per edge, -1 for none. */
    neis: Int32Array;
    polyCount: number;
    maxVertsPerPoly: number;
}

/**
 * @param maxVertsPerPoly How many corners a polygon may have. Six is Recast's
 *        default and the number this pipeline is tuned around: more merges the
 *        mesh further but makes every per-edge loop longer.
 */
export function buildPolyMesh(contours: NavContour[], maxVertsPerPoly: number): NavPolyMesh {
    const nvp = Math.max(3, maxVertsPerPoly);
    const verts: number[] = [];
    const vertLookup = new Map<number, number[]>();
    const polys: number[] = [];

    const indices: number[] = [];
    const tris: number[] = [];

    for (const contour of contours) {
        const n = contour.verts.length / 3;
        if (n < 3) continue;

        indices.length = 0;
        for (let i = 0; i < n; i++) indices.push(i);
        tris.length = 0;
        // A negative count is a contour that crossed itself; what it did manage
        // to cut is still better than dropping the region entirely.
        const ntris = Math.abs(triangulate(n, contour.verts, indices, tris));
        if (ntris === 0) continue;

        // Contour-local vertex indices become mesh-wide ones here, which is where
        // the sharing between neighbouring regions happens.
        const mapped: number[] = [];
        for (let i = 0; i < n; i++) {
            mapped.push(addVertex(verts, vertLookup,
                contour.verts[i * 3]!, contour.verts[i * 3 + 1]!, contour.verts[i * 3 + 2]!));
        }

        const local: number[] = [];
        for (let t = 0; t < ntris; t++) {
            const a = mapped[tris[t * 3]!]!;
            const b = mapped[tris[t * 3 + 1]!]!;
            const c = mapped[tris[t * 3 + 2]!]!;
            if (a === b || b === c || c === a) continue;
            const base = local.length;
            for (let k = 0; k < nvp; k++) local.push(-1);
            local[base] = a;
            local[base + 1] = b;
            local[base + 2] = c;
        }

        mergePolygons(local, verts, nvp);
        for (const v of local) polys.push(v);
    }

    const polyCount = polys.length / nvp;
    const mesh: NavPolyMesh = {
        verts: Int32Array.from(verts),
        vertCount: verts.length / 3,
        polys: Int32Array.from(polys),
        neis: new Int32Array(polyCount * nvp).fill(NAV_NO_NEIGHBOUR),
        polyCount,
        maxVertsPerPoly: nvp,
    };
    buildAdjacency(mesh);
    return mesh;
}

/**
 * Index of a vertex at `(x, y, z)`, adding it if it is new. Two corners at one
 * spot in the ground plane are the same vertex only if their heights are within a
 * voxel or two: two regions round a shared height slightly differently, while a
 * floor and the floor above it are nowhere near.
 */
function addVertex(
    verts: number[], lookup: Map<number, number[]>, x: number, y: number, z: number,
): number {
    const key = (x * 73856093) ^ (z * 83492791);
    let bucket = lookup.get(key);
    if (!bucket) { bucket = []; lookup.set(key, bucket); }
    for (const i of bucket) {
        if (verts[i * 3] === x && verts[i * 3 + 2] === z
            && Math.abs(verts[i * 3 + 1]! - y) <= VERTEX_WELD_VOXELS) return i;
    }
    const index = verts.length / 3;
    verts.push(x, y, z);
    bucket.push(index);
    return index;
}

/** How far apart in voxels two corners at one spot may be and still be one
 *  vertex. Recast's number, and the reason it is not zero is that the corner
 *  height is a max over four cells, taken from two different sides. */
const VERTEX_WELD_VOXELS = 2;

// ---------------------------------------------------------------------------
// Ear clipping
// ---------------------------------------------------------------------------

/** Twice the signed area of a triangle in the ground plane. */
function area2(verts: Int32Array, a: number, b: number, c: number): number {
    return (verts[b * 3]! - verts[a * 3]!) * (verts[c * 3 + 2]! - verts[a * 3 + 2]!)
        - (verts[c * 3]! - verts[a * 3]!) * (verts[b * 3 + 2]! - verts[a * 3 + 2]!);
}

function xorb(a: boolean, b: boolean): boolean {
    return a !== b;
}

function left(v: Int32Array, a: number, b: number, c: number): boolean {
    return area2(v, a, b, c) < 0;
}

function leftOn(v: Int32Array, a: number, b: number, c: number): boolean {
    return area2(v, a, b, c) <= 0;
}

function collinear(v: Int32Array, a: number, b: number, c: number): boolean {
    return area2(v, a, b, c) === 0;
}

function intersectProp(v: Int32Array, a: number, b: number, c: number, d: number): boolean {
    if (collinear(v, a, b, c) || collinear(v, a, b, d)
        || collinear(v, c, d, a) || collinear(v, c, d, b)) return false;
    return xorb(left(v, a, b, c), left(v, a, b, d)) && xorb(left(v, c, d, a), left(v, c, d, b));
}

function between(v: Int32Array, a: number, b: number, c: number): boolean {
    if (!collinear(v, a, b, c)) return false;
    if (v[a * 3] !== v[b * 3]) {
        return (v[a * 3]! <= v[c * 3]! && v[c * 3]! <= v[b * 3]!)
            || (v[a * 3]! >= v[c * 3]! && v[c * 3]! >= v[b * 3]!);
    }
    return (v[a * 3 + 2]! <= v[c * 3 + 2]! && v[c * 3 + 2]! <= v[b * 3 + 2]!)
        || (v[a * 3 + 2]! >= v[c * 3 + 2]! && v[c * 3 + 2]! >= v[b * 3 + 2]!);
}

function intersect(v: Int32Array, a: number, b: number, c: number, d: number): boolean {
    return intersectProp(v, a, b, c, d)
        || between(v, a, b, c) || between(v, a, b, d)
        || between(v, c, d, a) || between(v, c, d, b);
}

function vequal(v: Int32Array, a: number, b: number): boolean {
    return v[a * 3] === v[b * 3] && v[a * 3 + 2] === v[b * 3 + 2];
}

const INDEX_MASK = 0x0fffffff;
const EAR_FLAG = 0x10000000;

/** Whether the diagonal (i, j) stays strictly inside the polygon. */
function diagonalie(v: Int32Array, n: number, indices: number[], i: number, j: number): boolean {
    const d0 = indices[i]! & INDEX_MASK;
    const d1 = indices[j]! & INDEX_MASK;
    for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (k === i || k1 === i || k === j || k1 === j) continue;
        const p0 = indices[k]! & INDEX_MASK;
        const p1 = indices[k1]! & INDEX_MASK;
        if (vequal(v, d0, p0) || vequal(v, d1, p0) || vequal(v, d0, p1) || vequal(v, d1, p1)) continue;
        if (intersect(v, d0, d1, p0, p1)) return false;
    }
    return true;
}

/** Whether the diagonal leaves vertex `i` into the polygon rather than out of it. */
function inCone(v: Int32Array, n: number, indices: number[], i: number, j: number): boolean {
    const p = indices[i]! & INDEX_MASK;
    const pn = indices[(i + 1) % n]! & INDEX_MASK;
    const pp = indices[(i + n - 1) % n]! & INDEX_MASK;
    const q = indices[j]! & INDEX_MASK;
    if (leftOn(v, pp, p, pn)) return left(v, p, q, pp) && left(v, q, p, pn);
    return !(leftOn(v, p, q, pn) && leftOn(v, q, p, pp));
}

function diagonal(v: Int32Array, n: number, indices: number[], i: number, j: number): boolean {
    return inCone(v, n, indices, i, j) && diagonalie(v, n, indices, i, j);
}

/**
 * Ear clipping over the contour, always cutting the shortest available ear so
 * the triangles stay as fat as they can. Returns how many were produced, or a
 * negative count if the contour was too tangled to finish.
 */
function triangulate(n: number, verts: Int32Array, indices: number[], tris: number[]): number {
    let ntris = 0;
    let count = n;

    for (let i = 0; i < count; i++) {
        const i1 = (i + 1) % count;
        const i2 = (i1 + 1) % count;
        if (diagonal(verts, count, indices, i, i2)) indices[i1] = indices[i1]! | EAR_FLAG;
    }

    while (count > 3) {
        let minLen = -1;
        let mini = -1;
        for (let i = 0; i < count; i++) {
            const i1 = (i + 1) % count;
            if ((indices[i1]! & EAR_FLAG) === 0) continue;
            const p0 = (indices[i]! & INDEX_MASK) * 3;
            const p2 = (indices[(i1 + 1) % count]! & INDEX_MASK) * 3;
            const dx = verts[p2]! - verts[p0]!;
            const dz = verts[p2 + 2]! - verts[p0 + 2]!;
            const len = dx * dx + dz * dz;
            if (minLen < 0 || len < minLen) { minLen = len; mini = i; }
        }
        // No ear anywhere means the outline crosses itself; hand back what there
        // is rather than loop, and let the caller drop the contour.
        if (mini === -1) return -ntris;

        const i = mini;
        const i1 = (i + 1) % count;
        const i2 = (i1 + 1) % count;
        tris.push(indices[i]! & INDEX_MASK, indices[i1]! & INDEX_MASK, indices[i2]! & INDEX_MASK);
        ntris++;

        count--;
        for (let k = i1; k < count; k++) indices[k] = indices[k + 1]!;
        const j1 = i1 >= count ? 0 : i1;
        const j = (j1 + count - 1) % count;
        setEar(verts, count, indices, (j + count - 1) % count, j1, j);
        setEar(verts, count, indices, j, (j1 + 1) % count, j1);
    }

    tris.push(indices[0]! & INDEX_MASK, indices[1]! & INDEX_MASK, indices[2]! & INDEX_MASK);
    return ntris + 1;
}

function setEar(
    verts: Int32Array, count: number, indices: number[], from: number, to: number, at: number,
): void {
    if (diagonal(verts, count, indices, from, to)) indices[at] = indices[at]! | EAR_FLAG;
    else indices[at] = indices[at]! & INDEX_MASK;
}

// ---------------------------------------------------------------------------
// Convex merging
// ---------------------------------------------------------------------------

function polyVertCount(poly: number[], base: number, nvp: number): number {
    for (let i = 0; i < nvp; i++) if (poly[base + i] === -1) return i;
    return nvp;
}

/** True when `c` is left of the line `a → b` — the convexity test at a joint. */
function uleft(verts: number[], a: number, b: number, c: number): boolean {
    return (verts[b * 3]! - verts[a * 3]!) * (verts[c * 3 + 2]! - verts[a * 3 + 2]!)
        - (verts[c * 3]! - verts[a * 3]!) * (verts[b * 3 + 2]! - verts[a * 3 + 2]!) < 0;
}

/** Where two polygons touch, and how good a merge it would be — the squared
 *  length of the edge that would vanish, or -1 when they cannot merge at all. */
function polyMergeValue(
    polys: number[], verts: number[], a: number, b: number, nvp: number, out: Int32Array,
): number {
    const na = polyVertCount(polys, a, nvp);
    const nb = polyVertCount(polys, b, nvp);
    if (na + nb - 2 > nvp) return -1;

    let ea = -1;
    let eb = -1;
    for (let i = 0; i < na && ea === -1; i++) {
        let va0 = polys[a + i]!;
        let va1 = polys[a + (i + 1) % na]!;
        if (va0 > va1) { const t = va0; va0 = va1; va1 = t; }
        for (let j = 0; j < nb; j++) {
            let vb0 = polys[b + j]!;
            let vb1 = polys[b + (j + 1) % nb]!;
            if (vb0 > vb1) { const t = vb0; vb0 = vb1; vb1 = t; }
            if (va0 === vb0 && va1 === vb1) { ea = i; eb = j; break; }
        }
    }
    if (ea === -1 || eb === -1) return -1;

    // Both joints where the two outlines meet have to stay convex, or the merged
    // polygon would have a notch and "straight line inside it" would be a lie.
    if (!uleft(verts, polys[a + (ea + na - 1) % na]!, polys[a + ea]!, polys[b + (eb + 2) % nb]!)) return -1;
    if (!uleft(verts, polys[b + (eb + nb - 1) % nb]!, polys[b + eb]!, polys[a + (ea + 2) % na]!)) return -1;

    const va = polys[a + ea]!;
    const vb = polys[a + (ea + 1) % na]!;
    const dx = verts[va * 3]! - verts[vb * 3]!;
    const dz = verts[va * 3 + 2]! - verts[vb * 3 + 2]!;
    out[0] = ea;
    out[1] = eb;
    return dx * dx + dz * dz;
}

function mergePolygons(polys: number[], verts: number[], nvp: number): void {
    if (nvp <= 3) return;
    const edge = new Int32Array(2);
    const tmp = new Array<number>(nvp);

    for (;;) {
        let bestValue = 0;
        let bestA = -1;
        let bestB = -1;
        let bestEa = 0;
        let bestEb = 0;
        const count = polys.length / nvp;
        for (let i = 0; i < count - 1; i++) {
            for (let j = i + 1; j < count; j++) {
                const v = polyMergeValue(polys, verts, i * nvp, j * nvp, nvp, edge);
                if (v <= bestValue) continue;
                bestValue = v;
                bestA = i; bestB = j;
                bestEa = edge[0]!; bestEb = edge[1]!;
            }
        }
        if (bestA === -1) break;

        const a = bestA * nvp;
        const b = bestB * nvp;
        const na = polyVertCount(polys, a, nvp);
        const nb = polyVertCount(polys, b, nvp);
        tmp.fill(-1);
        let n = 0;
        for (let i = 0; i < na - 1; i++) tmp[n++] = polys[a + (bestEa + 1 + i) % na]!;
        for (let i = 0; i < nb - 1; i++) tmp[n++] = polys[b + (bestEb + 1 + i) % nb]!;
        for (let i = 0; i < nvp; i++) polys[a + i] = tmp[i]!;

        // The merged-away polygon is filled by the last one, so the array stays
        // packed without shifting everything after it.
        const last = polys.length - nvp;
        for (let i = 0; i < nvp; i++) polys[b + i] = polys[last + i]!;
        polys.length = last;
    }
}

// ---------------------------------------------------------------------------
// Adjacency
// ---------------------------------------------------------------------------

/**
 * Link polygons that share an edge. Every interior edge is traced twice, once
 * from each side and in opposite directions — that is what a consistent winding
 * buys — so matching `(v0, v1)` against `(v1, v0)` finds each pair exactly once.
 */
function buildAdjacency(mesh: NavPolyMesh): void {
    const { polys, neis, polyCount, maxVertsPerPoly: nvp } = mesh;
    const seen = new Map<number, number>();

    for (let p = 0; p < polyCount; p++) {
        const base = p * nvp;
        for (let j = 0; j < nvp; j++) {
            const v0 = polys[base + j]!;
            if (v0 === -1) break;
            const nextIdx = j + 1 >= nvp || polys[base + j + 1] === -1 ? 0 : j + 1;
            const v1 = polys[base + nextIdx]!;
            if (v0 >= v1) continue;
            seen.set(v0 * mesh.vertCount + v1, base + j);
        }
    }

    for (let p = 0; p < polyCount; p++) {
        const base = p * nvp;
        for (let j = 0; j < nvp; j++) {
            const v0 = polys[base + j]!;
            if (v0 === -1) break;
            const nextIdx = j + 1 >= nvp || polys[base + j + 1] === -1 ? 0 : j + 1;
            const v1 = polys[base + nextIdx]!;
            if (v0 <= v1) continue;
            const other = seen.get(v1 * mesh.vertCount + v0);
            if (other === undefined) continue;
            neis[base + j] = ((other / nvp) | 0);
            neis[other] = p;
        }
    }
}
