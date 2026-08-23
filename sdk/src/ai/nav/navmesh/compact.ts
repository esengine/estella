// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    compact.ts
 * @brief   Compact heightfield — the OPEN space above each solid span, with the
 *          neighbours an agent can actually reach from it.
 *
 * The solid field says where the world is; this says where an agent may be. Two
 * open spans are neighbours only if the step between them is small enough to
 * climb and the gap is tall enough to stand in, so the connection graph here is
 * already the walkable one: everything after this reads adjacency instead of
 * re-deciding it.
 *
 * Flat typed arrays rather than the solid field's linked spans, because from
 * here on the field is walked far more often than it is built.
 */

import {
    DIR_X, DIR_Z, NAV_AREA_NULL, NAV_SPAN_MAX_HEIGHT, type NavHeightfield,
} from './heightfield';
import type { Quat, Vec3 } from '../../../types';
import { q } from '../../../math/quat';

/** A direction with no reachable neighbour. Six bits per direction, so 63 is the
 *  one value that cannot also be a span offset. */
export const NAV_NOT_CONNECTED = 0x3f;

export class NavCompactField {
    readonly width: number;
    readonly depth: number;
    readonly min: Vec3;
    readonly max: Vec3;
    readonly cellSize: number;
    readonly cellHeight: number;
    /** In voxels — what the connection test was built with. */
    readonly walkableHeight: number;
    readonly walkableClimb: number;

    /** First span of column `x + z * width`, and how many it has. */
    readonly cellIndex: Int32Array;
    readonly cellCount: Int32Array;

    /** Floor of the open span, in voxels off `min.y`. */
    readonly y: Int32Array;
    /** Headroom above it, in voxels. */
    readonly h: Int32Array;
    /** Four six-bit neighbour offsets, one per direction. */
    readonly con: Int32Array;
    readonly areas: Uint8Array;
    /** Region id, filled in by the partitioner. 0 = none. */
    readonly regs: Int32Array;
    readonly spanCount: number;

    constructor(hf: NavHeightfield, walkableHeight: number, walkableClimb: number) {
        this.width = hf.width;
        this.depth = hf.depth;
        this.min = { ...hf.min };
        this.max = { ...hf.max };
        this.cellSize = hf.cellSize;
        this.cellHeight = hf.cellHeight;
        this.walkableHeight = walkableHeight;
        this.walkableClimb = walkableClimb;

        const cells = hf.width * hf.depth;
        let count = 0;
        for (let i = 0; i < cells; i++) {
            for (let s = hf.spans[i] ?? null; s; s = s.next) {
                if (s.area !== NAV_AREA_NULL) count++;
            }
        }
        this.spanCount = count;
        this.cellIndex = new Int32Array(cells);
        this.cellCount = new Int32Array(cells);
        this.y = new Int32Array(count);
        this.h = new Int32Array(count);
        this.con = new Int32Array(count);
        this.areas = new Uint8Array(count);
        this.regs = new Int32Array(count);

        let idx = 0;
        for (let i = 0; i < cells; i++) {
            this.cellIndex[i] = idx;
            for (let s = hf.spans[i] ?? null; s; s = s.next) {
                if (s.area === NAV_AREA_NULL) continue;
                const bot = s.smax;
                const top = s.next ? s.next.smin : NAV_SPAN_MAX_HEIGHT;
                this.y[idx] = Math.min(bot, NAV_SPAN_MAX_HEIGHT);
                this.h[idx] = Math.min(Math.max(top - bot, 0), NAV_SPAN_MAX_HEIGHT);
                this.areas[idx] = s.area;
                idx++;
                this.cellCount[i]!++;
            }
        }

        this.connect();
    }

    getCon(i: number, dir: number): number {
        return (this.con[i]! >> (dir * 6)) & 0x3f;
    }

    private setCon(i: number, dir: number, value: number): void {
        const shift = dir * 6;
        this.con[i] = (this.con[i]! & ~(0x3f << shift)) | ((value & 0x3f) << shift);
    }

    /** Index of the span reached from `i` in `dir`, or -1. */
    neighbourSpan(x: number, z: number, i: number, dir: number): number {
        const con = this.getCon(i, dir);
        if (con === NAV_NOT_CONNECTED) return -1;
        const nx = x + DIR_X[dir]!;
        const nz = z + DIR_Z[dir]!;
        return this.cellIndex[nx + nz * this.width]! + con;
    }

    private connect(): void {
        const { width: w, depth: d } = this;
        for (let z = 0; z < d; z++) {
            for (let x = 0; x < w; x++) {
                const c = x + z * w;
                const start = this.cellIndex[c]!;
                const end = start + this.cellCount[c]!;
                for (let i = start; i < end; i++) {
                    for (let dir = 0; dir < 4; dir++) {
                        this.setCon(i, dir, NAV_NOT_CONNECTED);
                        const nx = x + DIR_X[dir]!;
                        const nz = z + DIR_Z[dir]!;
                        if (nx < 0 || nz < 0 || nx >= w || nz >= d) continue;
                        const nc = nx + nz * w;
                        const nStart = this.cellIndex[nc]!;
                        const nEnd = nStart + this.cellCount[nc]!;
                        for (let k = nStart; k < nEnd; k++) {
                            const bot = Math.max(this.y[i]!, this.y[k]!);
                            const top = Math.min(this.y[i]! + this.h[i]!, this.y[k]! + this.h[k]!);
                            if (top - bot < this.walkableHeight) continue;
                            if (Math.abs(this.y[k]! - this.y[i]!) > this.walkableClimb) continue;
                            const offset = k - nStart;
                            // Six bits is what a direction gets; a column with more
                            // than 63 floors is beyond what this can address, and
                            // saying "not connected" is the honest answer for it.
                            if (offset < 0 || offset >= NAV_NOT_CONNECTED) continue;
                            this.setCon(i, dir, offset);
                            break;
                        }
                    }
                }
            }
        }
    }
}

/** A box that blocks, in world space, turned by its own rotation. */
export interface NavObstacleBox {
    center: Vec3;
    halfExtents: Vec3;
    rotation: Quat;
}

/**
 * Take the ground inside each box away, BEFORE the erosion — so the mesh pulls
 * back from an obstacle by the agent's width, exactly as it does from a wall. An
 * obstacle marked after eroding would leave routes scraping along its face.
 */
export function markObstacles(chf: NavCompactField, obstacles: readonly NavObstacleBox[]): void {
    const cs = chf.cellSize;
    const ch = chf.cellHeight;
    for (const box of obstacles) {
        const reach = Math.abs(box.halfExtents.x) + Math.abs(box.halfExtents.y)
            + Math.abs(box.halfExtents.z);
        const x0 = Math.max(0, Math.floor((box.center.x - reach - chf.min.x) / cs));
        const x1 = Math.min(chf.width - 1, Math.ceil((box.center.x + reach - chf.min.x) / cs));
        const z0 = Math.max(0, Math.floor((box.center.z - reach - chf.min.z) / cs));
        const z1 = Math.min(chf.depth - 1, Math.ceil((box.center.z + reach - chf.min.z) / cs));
        const inverse = { x: -box.rotation.x, y: -box.rotation.y, z: -box.rotation.z, w: box.rotation.w };

        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                const c = x + z * chf.width;
                const start = chf.cellIndex[c]!;
                const end = start + chf.cellCount[c]!;
                const wx = chf.min.x + (x + 0.5) * cs - box.center.x;
                const wz = chf.min.z + (z + 0.5) * cs - box.center.z;
                for (let i = start; i < end; i++) {
                    if (chf.areas[i] === NAV_AREA_NULL) continue;
                    const wy = chf.min.y + chf.y[i]! * ch - box.center.y;
                    const local = q.rotate(inverse, { x: wx, y: wy, z: wz });
                    if (Math.abs(local.x) > box.halfExtents.x) continue;
                    if (Math.abs(local.y) > box.halfExtents.y) continue;
                    if (Math.abs(local.z) > box.halfExtents.z) continue;
                    chf.areas[i] = NAV_AREA_NULL;
                }
            }
        }
    }
}

/**
 * Take `radius` cells off every edge of the walkable world. An agent is a body:
 * planning it down the exact edge of a walkway puts half of it over the drop.
 * Eroding here rather than filtering per query makes the mesh the set of places
 * the agent's centre may be — and is why a mesh is baked per agent SIZE.
 */
export function erodeWalkableArea(chf: NavCompactField, radius: number): void {
    if (radius <= 0) return;
    const { width: w, depth: d, spanCount: n } = chf;
    const dist = new Int32Array(n).fill(0xff);

    // Anything on the boundary of the walkable set starts at zero distance.
    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const start = chf.cellIndex[c]!;
            const end = start + chf.cellCount[c]!;
            for (let i = start; i < end; i++) {
                if (chf.areas[i] === NAV_AREA_NULL) { dist[i] = 0; continue; }
                let open = 0;
                for (let dir = 0; dir < 4; dir++) {
                    const ni = chf.neighbourSpan(x, z, i, dir);
                    if (ni >= 0 && chf.areas[ni] !== NAV_AREA_NULL) open++;
                }
                if (open !== 4) dist[i] = 0;
            }
        }
    }

    chamfer(chf, dist);

    const threshold = radius * 2;
    for (let i = 0; i < n; i++) {
        if (dist[i]! < threshold) chf.areas[i] = NAV_AREA_NULL;
    }
}

/**
 * Two sweeps of a 3-4 weighted chamfer transform over the connection graph — the
 * same approximation of euclidean distance the grid uses, but following reachable
 * neighbours rather than the raster, so a cell across a wall is not "one away".
 *
 * Written out rather than driven by a table of directions: this is the single
 * hottest loop of the bake, and one iterator per span per direction was costing
 * more than the arithmetic it was iterating over.
 */
function chamfer(chf: NavCompactField, dist: Int32Array): void {
    const { width: w, depth: d } = chf;
    const cellIndex = chf.cellIndex;
    const cellCount = chf.cellCount;
    const con = chf.con;

    /** The span reached from `i` in `dir`, or -1, without the method call. */
    const step = (x: number, z: number, i: number, dir: number): number => {
        const c = (con[i]! >> (dir * 6)) & 0x3f;
        if (c === NAV_NOT_CONNECTED) return -1;
        return cellIndex[x + DIR_X[dir]! + (z + DIR_Z[dir]!) * w]! + c;
    };

    for (let z = 0; z < d; z++) {
        for (let x = 0; x < w; x++) {
            const c = x + z * w;
            const end = cellIndex[c]! + cellCount[c]!;
            for (let i = cellIndex[c]!; i < end; i++) {
                let best = dist[i]!;
                // The two directions already swept, and the diagonal behind each.
                const a = step(x, z, i, 0);
                if (a >= 0) {
                    if (dist[a]! + 2 < best) best = dist[a]! + 2;
                    const aa = step(x - 1, z, a, 3);
                    if (aa >= 0 && dist[aa]! + 3 < best) best = dist[aa]! + 3;
                }
                const b = step(x, z, i, 3);
                if (b >= 0) {
                    if (dist[b]! + 2 < best) best = dist[b]! + 2;
                    const bb = step(x, z - 1, b, 2);
                    if (bb >= 0 && dist[bb]! + 3 < best) best = dist[bb]! + 3;
                }
                dist[i] = best > 0xff ? 0xff : best;
            }
        }
    }

    for (let z = d - 1; z >= 0; z--) {
        for (let x = w - 1; x >= 0; x--) {
            const c = x + z * w;
            const start = cellIndex[c]!;
            for (let i = start + cellCount[c]! - 1; i >= start; i--) {
                let best = dist[i]!;
                const a = step(x, z, i, 2);
                if (a >= 0) {
                    if (dist[a]! + 2 < best) best = dist[a]! + 2;
                    const aa = step(x + 1, z, a, 1);
                    if (aa >= 0 && dist[aa]! + 3 < best) best = dist[aa]! + 3;
                }
                const b = step(x, z, i, 1);
                if (b >= 0) {
                    if (dist[b]! + 2 < best) best = dist[b]! + 2;
                    const bb = step(x, z + 1, b, 0);
                    if (bb >= 0 && dist[bb]! + 3 < best) best = dist[bb]! + 3;
                }
                dist[i] = best > 0xff ? 0xff : best;
            }
        }
    }
}

