// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** @file  triangleTree.ts — rays against a surface: what a bake reads a dense model through, and what keeps hair out of a head. */
import { triangulateFace } from './triangulate';
import type { PolyMesh } from './polyMesh';

const LEAF = 4;

/** A mesh's triangles as a tree reads them: nine numbers each, three corners. */
export function trianglesOf(mesh: PolyMesh): Float64Array {
    const out: number[] = [];
    for (const face of mesh.faces) {
        for (const tri of triangulateFace(mesh, face)) {
            for (const v of tri) { const p = mesh.positions[v]!; out.push(p[0], p[1], p[2]); }
        }
    }
    return Float64Array.from(out);
}

/** A bounding-volume hierarchy over triangles, in flat arrays: a dense model is several hundred thousand of them. */
export class TriangleTree {
    private readonly order: Int32Array;
    private readonly boxes: Float64Array;
    /** Per node: a leaf's first triangle in `order` and its count, or the right child and 0. */
    private readonly links: Int32Array;
    private nodes = 0;
    private readonly stack = new Int32Array(128);

    constructor(private readonly corners: Float64Array) {
        const count = corners.length / 9;
        this.order = Int32Array.from({ length: count }, (_, i) => i);
        this.boxes = new Float64Array(count * 2 * 6 + 6);
        this.links = new Int32Array(count * 2 * 2 + 2);
        const centers = new Float64Array(count * 3);
        for (let t = 0; t < count; t++) {
            for (let k = 0; k < 3; k++) centers[t * 3 + k] = (corners[t * 9 + k]! + corners[t * 9 + 3 + k]! + corners[t * 9 + 6 + k]!) / 3;
        }
        this.build(0, count, centers);
    }

    private build(first: number, count: number, centers: Float64Array): number {
        const node = this.nodes++;
        const [boxes, order, corners] = [this.boxes, this.order, this.corners];
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        const cLo = [Infinity, Infinity, Infinity], cHi = [-Infinity, -Infinity, -Infinity];
        for (let i = first; i < first + count; i++) {
            const t = order[i]!;
            for (let k = 0; k < 3; k++) {
                for (let c = 0; c < 3; c++) {
                    const x = corners[t * 9 + c * 3 + k]!;
                    if (x < lo[k]!) lo[k] = x;
                    if (x > hi[k]!) hi[k] = x;
                }
                const m = centers[t * 3 + k]!;
                if (m < cLo[k]!) cLo[k] = m;
                if (m > cHi[k]!) cHi[k] = m;
            }
        }
        for (let k = 0; k < 3; k++) { boxes[node * 6 + k] = lo[k]!; boxes[node * 6 + 3 + k] = hi[k]!; }
        const axis = cHi[0]! - cLo[0]! >= cHi[1]! - cLo[1]! && cHi[0]! - cLo[0]! >= cHi[2]! - cLo[2]! ? 0 : cHi[1]! - cLo[1]! >= cHi[2]! - cLo[2]! ? 1 : 2;
        if (count <= LEAF || cHi[axis]! - cLo[axis]! <= 0) {
            this.links[node * 2] = first;
            this.links[node * 2 + 1] = count;
            return node;
        }
        const half = (cLo[axis]! + cHi[axis]!) / 2;
        let split = first;
        for (let i = first; i < first + count; i++) {
            if (centers[order[i]! * 3 + axis]! < half) {
                const swap = order[i]!;
                order[i] = order[split]!;
                order[split] = swap;
                split++;
            }
        }
        this.build(first, split - first, centers);
        this.links[node * 2] = this.build(split, first + count - split, centers);
        this.links[node * 2 + 1] = 0;
        return node;
    }

    /**
     * The hit on the line through @p o along @p d nearest to @p o, within @p reach either way, on a triangle
     * facing along @p d. Answers its triangle, or -1; the place on it goes in @p out as [u, v] for its 2nd and 3rd corners.
     */
    nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, out: Float64Array): number {
        const [boxes, links, order, c, stack] = [this.boxes, this.links, this.order, this.corners, this.stack];
        let best = reach, found = -1, top = 0;
        stack[top++] = 0;
        while (top > 0) {
            const node = stack[--top]!;
            const at = node * 6;
            let near = -best, far = best;
            let inside = true;
            for (let k = 0; k < 3 && inside; k++) {
                const d = k === 0 ? dx : k === 1 ? dy : dz, o = k === 0 ? ox : k === 1 ? oy : oz;
                const lo = boxes[at + k]!, hi = boxes[at + 3 + k]!;
                if (d === 0) { inside = o >= lo && o <= hi; continue; }
                let t0 = (lo - o) / d, t1 = (hi - o) / d;
                if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
                if (t0 > near) near = t0;
                if (t1 < far) far = t1;
                inside = near <= far;
            }
            if (!inside) continue;
            const count = links[node * 2 + 1]!;
            if (count === 0) {
                stack[top++] = links[node * 2]!;
                stack[top++] = node + 1;
                continue;
            }
            const first = links[node * 2]!;
            for (let i = first; i < first + count; i++) {
                const t = order[i]!, p = t * 9;
                const ax = c[p]!, ay = c[p + 1]!, az = c[p + 2]!;
                const e1x = c[p + 3]! - ax, e1y = c[p + 4]! - ay, e1z = c[p + 5]! - az;
                const e2x = c[p + 6]! - ax, e2y = c[p + 7]! - ay, e2z = c[p + 8]! - az;
                const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                const det = e1x * px + e1y * py + e1z * pz;
                // Negative is the line running along the triangle's outward normal: the inner wall of a thin part is not this surface.
                if (det > -1e-14) continue;
                const inv = 1 / det;
                const sx = ox - ax, sy = oy - ay, sz = oz - az;
                const u = (sx * px + sy * py + sz * pz) * inv;
                if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
                const v = (dx * qx + dy * qy + dz * qz) * inv;
                if (v < 0 || u + v > 1) continue;
                const along = (e2x * qx + e2y * qy + e2z * qz) * inv;
                if (Math.abs(along) < best) {
                    best = Math.abs(along);
                    found = t;
                    out[0] = u;
                    out[1] = v;
                }
            }
        }
        return found;
    }

    /** Whether anything lies on the ray from @p o along @p d within @p reach, whichever way it faces. */
    blocked(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): boolean {
        const [boxes, links, order, c, stack] = [this.boxes, this.links, this.order, this.corners, this.stack];
        let top = 0;
        stack[top++] = 0;
        while (top > 0) {
            const node = stack[--top]!;
            const at = node * 6;
            let near = 0, far = reach;
            let inside = true;
            for (let k = 0; k < 3 && inside; k++) {
                const d = k === 0 ? dx : k === 1 ? dy : dz, o = k === 0 ? ox : k === 1 ? oy : oz;
                const lo = boxes[at + k]!, hi = boxes[at + 3 + k]!;
                if (d === 0) { inside = o >= lo && o <= hi; continue; }
                let t0 = (lo - o) / d, t1 = (hi - o) / d;
                if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
                if (t0 > near) near = t0;
                if (t1 < far) far = t1;
                inside = near <= far;
            }
            if (!inside) continue;
            const count = links[node * 2 + 1]!;
            if (count === 0) {
                stack[top++] = links[node * 2]!;
                stack[top++] = node + 1;
                continue;
            }
            const first = links[node * 2]!;
            for (let i = first; i < first + count; i++) {
                const p = order[i]! * 9;
                const ax = c[p]!, ay = c[p + 1]!, az = c[p + 2]!;
                const e1x = c[p + 3]! - ax, e1y = c[p + 4]! - ay, e1z = c[p + 5]! - az;
                const e2x = c[p + 6]! - ax, e2y = c[p + 7]! - ay, e2z = c[p + 8]! - az;
                const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                const det = e1x * px + e1y * py + e1z * pz;
                if (det > -1e-14 && det < 1e-14) continue;
                const inv = 1 / det;
                const sx = ox - ax, sy = oy - ay, sz = oz - az;
                const u = (sx * px + sy * py + sz * pz) * inv;
                if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
                const v = (dx * qx + dy * qy + dz * qz) * inv;
                if (v < 0 || u + v > 1) continue;
                const along = (e2x * qx + e2y * qy + e2z * qz) * inv;
                if (along > 0 && along < reach) return true;
            }
        }
        return false;
    }
}
