// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    bvh.ts
 * @brief   What a ray hits, and how far away — the question a bake asks millions
 *          of times and nothing else here answers.
 *
 * Flat typed arrays throughout, and a traversal that allocates nothing: a bake
 * of one room is tens of millions of these, and an object per ray is the whole
 * cost of the pass.
 */

/** Triangles as `9 * count` floats: three world-space corners each. */
export interface TriangleSoup {
    positions: Float32Array;
    count: number;
}

const LEAF_TRIS = 4;
const STACK = 64;

export class Bvh {
    /** Six floats per node: min xyz, max xyz. */
    private readonly bounds: Float32Array;
    /** Two ints per node: a leaf's first triangle or an inner node's right child,
     *  then the triangle count — zero for an inner node. */
    private readonly node: Int32Array;
    /** Triangle indices, reordered so a leaf's are contiguous. */
    private readonly order: Int32Array;
    private readonly tris: TriangleSoup;
    private used = 0;

    constructor(tris: TriangleSoup) {
        this.tris = tris;
        this.order = new Int32Array(tris.count);
        for (let i = 0; i < tris.count; i++) this.order[i] = i;
        const maxNodes = Math.max(1, tris.count * 2);
        this.bounds = new Float32Array(maxNodes * 6);
        this.node = new Int32Array(maxNodes * 2);
        this.used = 1;
        this.build(0, 0, tris.count);
    }

    private centroid(tri: number, axis: number): number {
        const at = this.order[tri] * 9;
        return (this.tris.positions[at + axis] + this.tris.positions[at + 3 + axis]
              + this.tris.positions[at + 6 + axis]) / 3;
    }

    private bound(node: number, from: number, to: number): void {
        const b = node * 6;
        for (let k = 0; k < 3; k++) { this.bounds[b + k] = Infinity; this.bounds[b + 3 + k] = -Infinity; }
        for (let t = from; t < to; t++) {
            const at = this.order[t] * 9;
            for (let c = 0; c < 3; c++) {
                for (let k = 0; k < 3; k++) {
                    const v = this.tris.positions[at + c * 3 + k];
                    if (v < this.bounds[b + k]) this.bounds[b + k] = v;
                    if (v > this.bounds[b + 3 + k]) this.bounds[b + 3 + k] = v;
                }
            }
        }
    }

    /** Split on the widest axis at the centroid midpoint — cheap, and a bake
     *  builds this once per scene while it traverses it for hours. */
    private build(node: number, from: number, to: number): void {
        this.bound(node, from, to);
        const n = to - from;
        if (n <= LEAF_TRIS) {
            this.node[node * 2] = from;
            this.node[node * 2 + 1] = n;
            return;
        }
        const b = node * 6;
        let axis = 0;
        let widest = -1;
        for (let k = 0; k < 3; k++) {
            const w = this.bounds[b + 3 + k] - this.bounds[b + k];
            if (w > widest) { widest = w; axis = k; }
        }
        const mid = (this.bounds[b + axis] + this.bounds[b + 3 + axis]) / 2;
        let i = from, j = to - 1;
        while (i <= j) {
            if (this.centroid(i, axis) < mid) i++;
            else { const tmp = this.order[i]; this.order[i] = this.order[j]; this.order[j] = tmp; j--; }
        }
        // Every centroid on one side of the midpoint: split down the middle
        // instead, or the recursion never shrinks.
        let split = i;
        if (split === from || split === to) split = (from + to) >> 1;

        const left = this.used++;
        const right = this.used++;
        this.node[node * 2] = right;
        this.node[node * 2 + 1] = 0;
        this.build(left, from, split);
        this.build(right, split, to);
    }

    /**
     * Whether anything blocks the segment from `origin` to `origin + dir * far`.
     *
     * A shadow ray wants the first blocker, not the nearest one, so this stops at
     * the first hit — which is most of what a bake asks and the cheapest to answer.
     */
    occluded(ox: number, oy: number, oz: number,
             dx: number, dy: number, dz: number, far: number, epsilon: number): boolean {
        return this.trace(ox, oy, oz, dx, dy, dz, far, epsilon, true) >= 0;
    }

    /** The nearest triangle along the ray, or -1. `hitDistance` holds how far. */
    hit(ox: number, oy: number, oz: number,
        dx: number, dy: number, dz: number, far: number, epsilon: number): number {
        return this.trace(ox, oy, oz, dx, dy, dz, far, epsilon, false);
    }

    /** Distance to the last {@link hit}; meaningless before one. */
    hitDistance = 0;
    /** Barycentric coordinates of the last {@link hit}, as `u` and `v` on corners
     *  two and three — corner one takes `1 - u - v`. */
    hitU = 0;
    hitV = 0;

    private readonly stack = new Int32Array(STACK);

    private trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
                  far: number, epsilon: number, anyHit: boolean): number {
        const invX = 1 / dx, invY = 1 / dy, invZ = 1 / dz;
        let best = -1;
        let bestT = far;
        let sp = 0;
        this.stack[sp++] = 0;
        while (sp > 0) {
            const node = this.stack[--sp];
            const b = node * 6;
            const tx1 = (this.bounds[b] - ox) * invX, tx2 = (this.bounds[b + 3] - ox) * invX;
            let tmin = Math.min(tx1, tx2), tmax = Math.max(tx1, tx2);
            const ty1 = (this.bounds[b + 1] - oy) * invY, ty2 = (this.bounds[b + 4] - oy) * invY;
            tmin = Math.max(tmin, Math.min(ty1, ty2)); tmax = Math.min(tmax, Math.max(ty1, ty2));
            const tz1 = (this.bounds[b + 2] - oz) * invZ, tz2 = (this.bounds[b + 5] - oz) * invZ;
            tmin = Math.max(tmin, Math.min(tz1, tz2)); tmax = Math.min(tmax, Math.max(tz1, tz2));
            if (tmax < Math.max(tmin, epsilon) || tmin > bestT) continue;

            const count = this.node[node * 2 + 1];
            if (count === 0) {
                this.stack[sp++] = node + 1;
                this.stack[sp++] = this.node[node * 2];
                continue;
            }
            const first = this.node[node * 2];
            for (let k = 0; k < count; k++) {
                const tri = this.order[first + k];
                const t = this.intersect(tri, ox, oy, oz, dx, dy, dz, epsilon, bestT);
                if (t < 0) continue;
                if (anyHit) { this.hitDistance = t; return tri; }
                bestT = t; best = tri;
                this.hitU = this.lastU; this.hitV = this.lastV;
            }
        }
        this.hitDistance = bestT;
        return best;
    }

    private lastU = 0;
    private lastV = 0;

    /** Möller-Trumbore, both faces: a bake lights what is there, and a wall
     *  modelled inside out still occludes the room. */
    private intersect(tri: number, ox: number, oy: number, oz: number,
                      dx: number, dy: number, dz: number, epsilon: number, far: number): number {
        const p = this.tris.positions;
        const at = tri * 9;
        const e1x = p[at + 3] - p[at], e1y = p[at + 4] - p[at + 1], e1z = p[at + 5] - p[at + 2];
        const e2x = p[at + 6] - p[at], e2y = p[at + 7] - p[at + 1], e2z = p[at + 8] - p[at + 2];
        const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
        const a = e1x * hx + e1y * hy + e1z * hz;
        if (a > -1e-12 && a < 1e-12) return -1;
        const f = 1 / a;
        const sx = ox - p[at], sy = oy - p[at + 1], sz = oz - p[at + 2];
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) return -1;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = f * (dx * qx + dy * qy + dz * qz);
        if (v < 0 || u + v > 1) return -1;
        const t = f * (e2x * qx + e2y * qy + e2z * qz);
        if (t <= epsilon || t >= far) return -1;
        this.lastU = u; this.lastV = v;
        return t;
    }
}
