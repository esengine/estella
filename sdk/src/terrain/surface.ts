// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    surface.ts
 * @brief   The ground as one set of triangles: what is drawn near the eye, what is collided with and what a query answers.
 *
 * @details The ground is the lattice of `cellSize` cells in the terrain's space (a node at every multiple of the cell), each node as
 *          high as the source says there (an area's nodes past its edge take the edge's height), and each cell cut in two along the
 *          diagonal from its (1, 0) corner to its (0, 1) corner. That is the finest level the quadtree draws (a patch's vertices fall
 *          on the lattice and are cut the same way), the triangles collision is built from, and what `heightAt` and `normalAt` read, so
 *          all three agree to the GPU's 16-bit height encoding. Coarser levels farther from the eye are drawn coarser; nothing collides
 *          with them. The rule does not change with the camera, the order tiles are made in, or a reload.
 */
import type { TerrainSource } from './source';

/** Cells along a collision tile's side. */
export const TILE_CELLS = 32;

/** A tile's triangles: positions relative to its corner (x0, 0, z0) in the terrain's space, wound counter-clockwise from above. */
export interface SurfaceTile { x0: number; z0: number; positions: Float32Array; indices: Uint32Array }

type CellSample = [number, number, number, number, number, number];

function triangleHeight([a, b, c, d, fx, fz]: CellSample): number {
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

function triangleNormal([a, b, c, d, fx, fz]: CellSample, cell: number): [number, number, number] {
    const first = fx + fz <= 1;
    const sx = (first ? b - a : d - c) / cell, sz = (first ? c - a : d - b) / cell;
    const len = Math.hypot(sx, 1, sz);
    return [-sx / len, 1 / len, -sz / len];
}

export class TerrainSurface {
    constructor(readonly source: TerrainSource, readonly cell: number) {}

    /** The height of lattice node (i, k), or null where the source has not answered. Off an area it is its nearest edge's, as the pages have it. */
    node(i: number, k: number): number | null {
        let x = i * this.cell, z = k * this.cell;
        const b = this.source.bounds;
        if (b) {
            x = Math.min(Math.max(x, b[0]), b[2]);
            z = Math.min(Math.max(z, b[1]), b[3]);
        }
        return this.source.height(x, z);
    }

    /** Whether (x, z) is on the ground: inside an area, anywhere for ground without end. */
    covers(x: number, z: number): boolean {
        const b = this.source.bounds;
        return !b || (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
    }

    /** The height at (x, z) on its cell's triangle, or null off the ground or where a corner is not known yet. */
    height(x: number, z: number): number | null {
        const c = this.corners(x, z);
        return c && triangleHeight(c);
    }

    /** The normal of the triangle under (x, z), or null where its height is not known. */
    normal(x: number, z: number): [number, number, number] | null {
        const c = this.corners(x, z);
        return c && triangleNormal(c, this.cell);
    }

    /** Read both properties of the same triangle from one set of heights. */
    sample(x: number, z: number): { height: number; normal: [number, number, number] } | null {
        const c = this.corners(x, z);
        return c && { height: triangleHeight(c), normal: triangleNormal(c, this.cell) };
    }

    /** Tile (tx, tz)'s triangles, or null while a node of it is not known yet. */
    tile(tx: number, tz: number): SurfaceTile | null {
        const n = TILE_CELLS, side = n + 1;
        const positions = new Float32Array(side * side * 3);
        for (let k = 0; k <= n; k++) for (let i = 0; i <= n; i++) {
            const h = this.node(tx * n + i, tz * n + k);
            if (h === null) return null;
            const at = (k * side + i) * 3;
            positions[at] = i * this.cell;
            positions[at + 1] = h;
            positions[at + 2] = k * this.cell;
        }
        const indices = new Uint32Array(n * n * 6);
        let at = 0;
        for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
            const a = k * side + i, b = a + 1, c = a + side, d = c + 1;
            // The patch's cut and winding (patch.ts): a, the next row, the next column; then the other half.
            indices.set([a, c, b, b, c, d], at);
            at += 6;
        }
        return { x0: tx * n * this.cell, z0: tz * n * this.cell, positions, indices };
    }

    /**
     * Where the ray from (ox, oy, oz) along (dx, dy, dz) first meets the ground, within `maxDistance` (along the direction, normalised):
     * the distance, the point and the triangle's normal; null where it meets none (or crosses ground not known yet). Exact against the
     * triangles: it walks the lattice cell by cell under the ray and meets each cell's two.
     */
    raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDistance: number):
        { distance: number; point: [number, number, number]; normal: [number, number, number] } | null {
        const len = Math.hypot(dx, dy, dz);
        if (len <= 0) return null;
        dx /= len; dy /= len; dz /= len;
        // A cursor may be kilometres outside an area. Walk only the part of the ray
        // that can meet its terrain, even when the camera starts far beyond the terrain bounds.
        let entry = 0, exit = maxDistance;
        const clip = (origin: number, direction: number, lo: number, hi: number): boolean => {
            if (direction === 0) return origin >= lo && origin <= hi;
            const a = (lo - origin) / direction, b = (hi - origin) / direction;
            entry = Math.max(entry, Math.min(a, b));
            exit = Math.min(exit, Math.max(a, b));
            return entry <= exit;
        };
        const bounds = this.source.bounds;
        if (!clip(oy, dy, this.source.minHeight, this.source.maxHeight)) return null;
        if (bounds && (!clip(ox, dx, bounds[0], bounds[2]) || !clip(oz, dz, bounds[1], bounds[3]))) return null;
        const c = this.cell;
        // Over the cells the ray's shadow on the ground crosses, in order (Amanatides and Woo).
        let i = Math.floor((ox + entry * dx) / c), k = Math.floor((oz + entry * dz) / c);
        const si = dx > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
        const tdi = dx !== 0 ? Math.abs(c / dx) : Infinity, tdk = dz !== 0 ? Math.abs(c / dz) : Infinity;
        let ti = dx !== 0 ? ((dx > 0 ? (i + 1) * c : i * c) - ox) / dx : Infinity;
        let tk = dz !== 0 ? ((dz > 0 ? (k + 1) * c : k * c) - oz) / dz : Infinity;
        if (!(entry <= exit)) return null;
        let a = this.node(i, k), b = this.node(i + 1, k), cc = this.node(i, k + 1), d = this.node(i + 1, k + 1);
        for (let steps = 1; ; steps++) {
            if (a === null || b === null || cc === null || d === null) return null;
            const x0 = i * c, z0 = k * c;
            // The cell's two triangles, cut from its (1, 0) corner to its (0, 1) corner, as the patch is.
            let closest: { distance: number; point: [number, number, number]; normal: [number, number, number] } | null = null;
            for (const tri of [[[x0, a, z0], [x0, cc, z0 + c], [x0 + c, b, z0]], [[x0 + c, b, z0], [x0, cc, z0 + c], [x0 + c, d, z0 + c]]] as const) {
                const hit = rayTriangle(ox, oy, oz, dx, dy, dz, tri[0], tri[1], tri[2]);
                if (hit && hit.t <= maxDistance && (!closest || hit.t < closest.distance)) {
                    const x = ox + dx * hit.t, z = oz + dz * hit.t;
                    if (this.covers(x, z)) closest = { distance: hit.t, point: [x, oy + dy * hit.t, z], normal: hit.n };
                }
            }
            if (closest) return closest;
            if (steps === 1_000_000 || (dx === 0 && dz === 0) || Math.min(ti, tk) > exit) return null;
            // Adjacent cells share the two heights on the edge the ray just crossed.
            if (ti < tk) {
                ti += tdi;
                i += si;
                if (si > 0) {
                    a = b; cc = d;
                    b = this.node(i + 1, k); d = this.node(i + 1, k + 1);
                } else {
                    b = a; d = cc;
                    a = this.node(i, k); cc = this.node(i, k + 1);
                }
            } else {
                tk += tdk;
                k += sk;
                if (sk > 0) {
                    a = cc; b = d;
                    cc = this.node(i, k + 1); d = this.node(i + 1, k + 1);
                } else {
                    cc = a; d = b;
                    a = this.node(i, k); b = this.node(i + 1, k);
                }
            }
        }
    }

    /** The four corners of the cell under (x, z) and where in it the point is, or null. */
    private corners(x: number, z: number): CellSample | null {
        if (!this.covers(x, z)) return null;
        const u = x / this.cell, v = z / this.cell;
        const i = Math.floor(u), k = Math.floor(v);
        const a = this.node(i, k), b = this.node(i + 1, k), c = this.node(i, k + 1), d = this.node(i + 1, k + 1);
        if (a === null || b === null || c === null || d === null) return null;
        return [a, b, c, d, u - i, v - k];
    }
}

/** Where a ray (unit direction) meets a triangle from either side, and the triangle's upward normal; null where it misses. */
function rayTriangle(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
                     p0: readonly number[], p1: readonly number[], p2: readonly number[]): { t: number; n: [number, number, number] } | null {
    const e1x = p1[0]! - p0[0]!, e1y = p1[1]! - p0[1]!, e1z = p1[2]! - p0[2]!;
    const e2x = p2[0]! - p0[0]!, e2y = p2[1]! - p0[1]!, e2z = p2[2]! - p0[2]!;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return null;
    const inv = 1 / det;
    const sx = ox - p0[0]!, sy = oy - p0[1]!, sz = oz - p0[2]!;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < -1e-9 || u > 1 + 1e-9) return null;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-9 || u + v > 1 + 1e-9) return null;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < 0) return null;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    return { t, n: [nx / l, ny / l, nz / l] };
}
