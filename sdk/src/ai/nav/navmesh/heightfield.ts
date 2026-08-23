// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    heightfield.ts
 * @brief   Solid voxel heightfield — the first step of turning triangles into a
 *          navigation mesh.
 *
 * Every column of the world holds a list of the SOLID intervals in it, so a
 * bridge and the road under it are two entries rather than whichever a ray met
 * first. That is the whole reason the navmesh pipeline starts with voxels: a
 * heightfield with one surface per column cannot describe a world with two.
 *
 * Triangles are clipped into the columns they cross rather than sampled, so a
 * floor tilted between two cells still fills both. The rasteriser is Recast's,
 * which is the shape this problem has had a standard answer for since 2009.
 *
 * All lengths here are WORLD pixels; heights are stored as voxel indices off
 * `min.y`, which is what keeps a span an integer pair rather than two floats.
 */

import type { Vec3 } from '../../../types';

/** Not walkable — either never was, or a filter took it away. */
export const NAV_AREA_NULL = 0;
/** Ground an agent can stand on. */
export const NAV_AREA_WALKABLE = 1;

/** The tallest a span may reach, in voxels. */
export const NAV_SPAN_MAX_HEIGHT = 0xffff;

/** One solid interval in a column: voxels `[smin, smax)` are inside geometry. */
export interface NavSpan {
    smin: number;
    smax: number;
    area: number;
    next: NavSpan | null;
}

/** How many columns a box of world covers at this resolution. Its own function
 *  because a caller has to be able to ask before committing to the memory. */
export function heightfieldColumns(
    min: Vec3, max: Vec3, cellSize: number,
): { width: number; depth: number } {
    return {
        width: Math.max(1, Math.ceil((max.x - min.x) / cellSize)),
        depth: Math.max(1, Math.ceil((max.z - min.z) / cellSize)),
    };
}

export class NavHeightfield {
    /** Columns along world x. */
    readonly width: number;
    /** Columns along world z. */
    readonly depth: number;
    readonly min: Vec3;
    readonly max: Vec3;
    readonly cellSize: number;
    readonly cellHeight: number;
    /** Column-major-free: `x + z * width`, lowest span first. */
    readonly spans: (NavSpan | null)[];

    constructor(min: Vec3, max: Vec3, cellSize: number, cellHeight: number) {
        this.min = { ...min };
        this.max = { ...max };
        this.cellSize = cellSize;
        this.cellHeight = cellHeight;
        const size = heightfieldColumns(min, max, cellSize);
        this.width = size.width;
        this.depth = size.depth;
        this.spans = new Array<NavSpan | null>(this.width * this.depth).fill(null);
    }
}

/**
 * Add a solid interval to a column, merging it into whatever it touches: two
 * spans that overlap ARE one solid thing. `mergeThreshold` is how close two tops
 * have to be for the more walkable area to win, so a thin slab laid on a wall
 * keeps its own.
 */
export function addSpan(
    hf: NavHeightfield, x: number, z: number,
    smin: number, smax: number, area: number, mergeThreshold: number,
): void {
    const idx = x + z * hf.width;
    const s: NavSpan = { smin, smax, area, next: null };

    let prev: NavSpan | null = null;
    let cur = hf.spans[idx] ?? null;
    while (cur) {
        if (cur.smin > s.smax) break;
        if (cur.smax < s.smin) {
            prev = cur;
            cur = cur.next;
            continue;
        }
        if (cur.smin < s.smin) s.smin = cur.smin;
        if (cur.smax > s.smax) s.smax = cur.smax;
        if (Math.abs(s.smax - cur.smax) <= mergeThreshold) s.area = Math.max(s.area, cur.area);
        const next = cur.next;
        if (prev) prev.next = next; else hf.spans[idx] = next;
        cur = next;
    }

    if (prev) {
        s.next = prev.next;
        prev.next = s;
    } else {
        s.next = hf.spans[idx] ?? null;
        hf.spans[idx] = s;
    }
}

/** Scratch for the clipper: four polygons of at most seven vertices. */
const CLIP_BUF = new Float32Array(7 * 3 * 4);

/** Where {@link dividePoly} reports the two vertex counts it produced. */
const DIVIDE_OUT = new Int32Array(2);

/**
 * Split a polygon by the plane `axis = value` into the part on the near side
 * (`out1`, where `coord <= value`) and the part beyond it (`out2`), reporting
 * their vertex counts in {@link DIVIDE_OUT}.
 */
function dividePoly(
    buf: Float32Array, inOff: number, nin: number,
    out1: number, out2: number, value: number, axis: number,
): void {
    const d = DIVIDE_D;
    for (let i = 0; i < nin; i++) d[i] = value - buf[inOff + i * 3 + axis]!;

    let m = 0;
    let n = 0;
    for (let i = 0, j = nin - 1; i < nin; j = i, i++) {
        const dj = d[j]!;
        const di = d[i]!;
        if ((dj >= 0) !== (di >= 0)) {
            const s = dj / (dj - di);
            for (let k = 0; k < 3; k++) {
                const a = buf[inOff + j * 3 + k]!;
                const v = a + (buf[inOff + i * 3 + k]! - a) * s;
                buf[out1 + m * 3 + k] = v;
                buf[out2 + n * 3 + k] = v;
            }
            m++; n++;
            if (di > 0) {
                for (let k = 0; k < 3; k++) buf[out1 + m * 3 + k] = buf[inOff + i * 3 + k]!;
                m++;
            } else if (di < 0) {
                for (let k = 0; k < 3; k++) buf[out2 + n * 3 + k] = buf[inOff + i * 3 + k]!;
                n++;
            }
        } else {
            if (di >= 0) {
                for (let k = 0; k < 3; k++) buf[out1 + m * 3 + k] = buf[inOff + i * 3 + k]!;
                m++;
                if (di !== 0) continue;
            }
            for (let k = 0; k < 3; k++) buf[out2 + n * 3 + k] = buf[inOff + i * 3 + k]!;
            n++;
        }
    }
    DIVIDE_OUT[0] = m;
    DIVIDE_OUT[1] = n;
}

const DIVIDE_D = new Float32Array(12);

/**
 * Rasterise world-space triangles into solid spans. A triangle whose normal
 * leans further from level than `walkableSlopeCos` allows is still solid — it is
 * simply not ground, which is how a wall comes to block a route rather than
 * disappear from it.
 *
 * @param verts   `vertexCount * 3` world-space floats.
 * @param indices Three per triangle.
 */
export function rasterizeTriangles(
    hf: NavHeightfield, verts: Float32Array, indices: ArrayLike<number>,
    walkableSlopeCos: number, mergeThreshold: number,
): void {
    for (let t = 0; t + 2 < indices.length; t += 3) {
        const a = indices[t]! * 3;
        const b = indices[t + 1]! * 3;
        const c = indices[t + 2]! * 3;
        const area = triangleArea(verts, a, b, c, walkableSlopeCos);
        rasterizeTriangle(hf, verts, a, b, c, area, mergeThreshold);
    }
}

/** Walkable when the triangle's own normal leans no further than allowed. */
function triangleArea(
    verts: Float32Array, a: number, b: number, c: number, walkableSlopeCos: number,
): number {
    const e0x = verts[b]! - verts[a]!;
    const e0y = verts[b + 1]! - verts[a + 1]!;
    const e0z = verts[b + 2]! - verts[a + 2]!;
    const e1x = verts[c]! - verts[a]!;
    const e1y = verts[c + 1]! - verts[a + 1]!;
    const e1z = verts[c + 2]! - verts[a + 2]!;
    const nx = e0y * e1z - e0z * e1y;
    const ny = e0z * e1x - e0x * e1z;
    const nz = e0x * e1y - e0y * e1x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len === 0) return NAV_AREA_NULL;
    return ny / len > walkableSlopeCos ? NAV_AREA_WALKABLE : NAV_AREA_NULL;
}

function rasterizeTriangle(
    hf: NavHeightfield, verts: Float32Array, a: number, b: number, c: number,
    area: number, mergeThreshold: number,
): void {
    const { min, max, cellSize: cs, cellHeight: ch, width: w, depth: d } = hf;
    const ics = 1 / cs;
    const ich = 1 / ch;
    const by = max.y - min.y;

    let tminX = verts[a]!, tmaxX = tminX;
    let tminY = verts[a + 1]!, tmaxY = tminY;
    let tminZ = verts[a + 2]!, tmaxZ = tminZ;
    for (let n = 0; n < 2; n++) {
        const o = n === 0 ? b : c;
        tminX = Math.min(tminX, verts[o]!); tmaxX = Math.max(tmaxX, verts[o]!);
        tminY = Math.min(tminY, verts[o + 1]!); tmaxY = Math.max(tmaxY, verts[o + 1]!);
        tminZ = Math.min(tminZ, verts[o + 2]!); tmaxZ = Math.max(tmaxZ, verts[o + 2]!);
    }
    if (tmaxX < min.x || tminX > max.x || tmaxY < min.y || tminY > max.y
        || tmaxZ < min.z || tminZ > max.z) return;

    const buf = CLIP_BUF;
    let inOff = 0;
    let rowOff = 7 * 3;
    let p1 = 7 * 3 * 2;
    let p2 = 7 * 3 * 3;
    for (let k = 0; k < 3; k++) {
        buf[k] = verts[a + k]!;
        buf[3 + k] = verts[b + k]!;
        buf[6 + k] = verts[c + k]!;
    }
    let nvIn = 3;

    let z0 = Math.floor((tminZ - min.z) * ics);
    let z1 = Math.floor((tmaxZ - min.z) * ics);
    z0 = clampInt(z0, -1, d - 1);
    z1 = clampInt(z1, 0, d - 1);

    for (let z = z0; z <= z1; z++) {
        const cz = min.z + z * cs;
        dividePoly(buf, inOff, nvIn, rowOff, p1, cz + cs, 2);
        const nvRow = DIVIDE_OUT[0]!;
        nvIn = DIVIDE_OUT[1]!;
        // What is left of the triangle rasterises in later rows; swap so the
        // remainder becomes the input and the buffer we just read is free.
        const swap = inOff; inOff = p1; p1 = swap;
        if (nvRow < 3 || z < 0) continue;

        let minX = buf[rowOff]!;
        let maxX = minX;
        for (let i = 1; i < nvRow; i++) {
            minX = Math.min(minX, buf[rowOff + i * 3]!);
            maxX = Math.max(maxX, buf[rowOff + i * 3]!);
        }
        let x0 = Math.floor((minX - min.x) * ics);
        let x1 = Math.floor((maxX - min.x) * ics);
        if (x1 < 0 || x0 >= w) continue;
        x0 = clampInt(x0, -1, w - 1);
        x1 = clampInt(x1, 0, w - 1);

        let nv2 = nvRow;
        for (let x = x0; x <= x1; x++) {
            const cx = min.x + x * cs;
            dividePoly(buf, rowOff, nv2, p1, p2, cx + cs, 0);
            const nv = DIVIDE_OUT[0]!;
            nv2 = DIVIDE_OUT[1]!;
            const swapRow = rowOff; rowOff = p2; p2 = swapRow;
            if (nv < 3 || x < 0) continue;

            let smin = buf[p1 + 1]!;
            let smax = smin;
            for (let i = 1; i < nv; i++) {
                smin = Math.min(smin, buf[p1 + i * 3 + 1]!);
                smax = Math.max(smax, buf[p1 + i * 3 + 1]!);
            }
            smin -= min.y;
            smax -= min.y;
            if (smax < 0 || smin > by) continue;
            if (smin < 0) smin = 0;
            if (smax > by) smax = by;

            const ismin = clampInt(Math.floor(smin * ich), 0, NAV_SPAN_MAX_HEIGHT);
            const ismax = clampInt(Math.ceil(smax * ich), ismin + 1, NAV_SPAN_MAX_HEIGHT);
            addSpan(hf, x, z, ismin, ismax, area, mergeThreshold);
        }
    }
}

function clampInt(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * A solid span low enough to step onto becomes ground. Without this a kerb, a
 * doorstep or the lip of a ramp reads as an obstacle standing on the floor, and
 * every one of them cuts the walkable world in half.
 */
export function filterLowHangingWalkableObstacles(hf: NavHeightfield, walkableClimb: number): void {
    for (let i = 0; i < hf.spans.length; i++) {
        let prev: NavSpan | null = null;
        let prevWalkable = false;
        let prevArea = NAV_AREA_NULL;
        for (let s = hf.spans[i] ?? null; s; s = s.next) {
            const walkable = s.area !== NAV_AREA_NULL;
            if (!walkable && prevWalkable && prev
                && Math.abs(s.smax - prev.smax) <= walkableClimb) {
                s.area = prevArea;
            }
            prevWalkable = walkable;
            prevArea = s.area;
            prev = s;
        }
    }
}

/**
 * Ground on the edge of a drop is not ground. An agent standing there is half
 * over the fall, and a route planned across it walks off — so the last row of
 * cells before a ledge stops being walkable, which is also what keeps the top of
 * a wall from connecting to the floor beside it.
 */
export function filterLedgeSpans(
    hf: NavHeightfield, walkableHeight: number, walkableClimb: number,
): void {
    const { width: w, depth: d } = hf;
    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            for (let s = hf.spans[x + z * w] ?? null; s; s = s.next) {
                if (s.area === NAV_AREA_NULL) continue;
                const bot = s.smax;
                const top = s.next ? s.next.smin : NAV_SPAN_MAX_HEIGHT;

                // How far DOWN the biggest reachable neighbour is, and the spread
                // between the neighbours that are close enough to walk onto.
                let minDrop = NAV_SPAN_MAX_HEIGHT;
                let accessMin = s.smax;
                let accessMax = s.smax;

                for (let dir = 0; dir < 4; dir++) {
                    const nx = x + DIR_X[dir]!;
                    const nz = z + DIR_Z[dir]!;
                    if (nx < 0 || nz < 0 || nx >= w || nz >= d) {
                        minDrop = Math.min(minDrop, -walkableClimb - bot);
                        continue;
                    }
                    let ns = hf.spans[nx + nz * w] ?? null;
                    // The gap under the neighbour's lowest span: the floor there
                    // is the bottom of the world, not the span above it.
                    let nbot = -walkableClimb;
                    let ntop = ns ? ns.smin : NAV_SPAN_MAX_HEIGHT;
                    if (Math.min(top, ntop) - Math.max(bot, nbot) > walkableHeight) {
                        minDrop = Math.min(minDrop, nbot - bot);
                    }
                    for (; ns; ns = ns.next) {
                        nbot = ns.smax;
                        ntop = ns.next ? ns.next.smin : NAV_SPAN_MAX_HEIGHT;
                        if (Math.min(top, ntop) - Math.max(bot, nbot) <= walkableHeight) continue;
                        minDrop = Math.min(minDrop, nbot - bot);
                        if (Math.abs(nbot - bot) <= walkableClimb) {
                            accessMin = Math.min(accessMin, nbot);
                            accessMax = Math.max(accessMax, nbot);
                        }
                    }
                }

                if (minDrop < -walkableClimb) s.area = NAV_AREA_NULL;
                else if (accessMax - accessMin > walkableClimb) s.area = NAV_AREA_NULL;
            }
        }
    }
}

/** Ground with less headroom than the agent is tall is a crawlspace, not floor. */
export function filterWalkableLowHeightSpans(hf: NavHeightfield, walkableHeight: number): void {
    for (let i = 0; i < hf.spans.length; i++) {
        for (let s = hf.spans[i] ?? null; s; s = s.next) {
            const top = s.next ? s.next.smin : NAV_SPAN_MAX_HEIGHT;
            if (top - s.smax < walkableHeight) s.area = NAV_AREA_NULL;
        }
    }
}

/** Neighbour offsets, indexed by direction: 0 = -x, 1 = +z, 2 = +x, 3 = -z.
 *  Every walk over the field turns with `(dir + 1) & 3`, so the order matters. */
export const DIR_X = [-1, 0, 1, 0] as const;
export const DIR_Z = [0, 1, 0, -1] as const;
