// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    footprint.ts
 * @brief   The shape a mesh makes seen from above: what a custom body of water is the shape of (a fountain's bowl, a pool, a trough).
 *
 * @details The mesh's triangles are laid flat on its own xz plane. A point is inside where it is inside any of them, so a pool of any
 *          outline (an L, a ring round an island, a basin with a hole) is its own shape and not the hull round it. How far inside or
 *          outside is the distance to the nearest edge on the rim: an edge only one triangle has. Corners the mesh splits to give them
 *          more than one texture coordinate are joined first, so a seam is not taken for a rim. Only the triangles that face up are
 *          the shape: the surface water lies on. A closed mesh (a cylinder) seen from above is its top and its bottom laid one on the other,
 *          and every edge of its rim would be shared; its top alone has one.
 */
import { MeshChannel, MeshChannelType, type MeshData } from '../asset/meshFormat';
import type { Point2 } from './shore';

/** Cells a side of the grid triangles are found by. */
const GRID = 32;

/** A mesh's shape on its own xz plane. */
export class Footprint {
    /** The convex outline round it, on the same plane: where it is, for the region the water is baked over. */
    readonly hull: Point2[];
    /** The highest point of the mesh, on its own y: the height the water stands to. */
    readonly top: number;
    private readonly tris: Float64Array;
    private readonly rims: Float64Array;
    private readonly cells: number[][];
    private readonly minX: number;
    private readonly minZ: number;
    private readonly cellX: number;
    private readonly cellZ: number;

    /** Of positions `xyz` (three numbers a vertex) and triangles `indices`; null where there is no triangle to take a shape from. */
    static of(xyz: ArrayLike<number>, indices: ArrayLike<number>): Footprint | null {
        if (indices.length < 3 || xyz.length < 9) return null;
        return new Footprint(xyz, indices);
    }

    /** Of a mesh's own geometry: its float positions, or null where it has none. */
    static ofMesh(mesh: MeshData): Footprint | null {
        const pos = mesh.channels.find((c) => c.semantic === MeshChannel.Position);
        if (!pos || pos.type !== MeshChannelType.Float32 || pos.components < 3) return null;
        const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
        const xyz = new Float64Array(mesh.vertexCount * 3);
        for (let v = 0; v < mesh.vertexCount; v++) {
            const b = v * mesh.vertexStride + pos.offset;
            xyz[v * 3] = view.getFloat32(b, true);
            xyz[v * 3 + 1] = view.getFloat32(b + 4, true);
            xyz[v * 3 + 2] = view.getFloat32(b + 8, true);
        }
        return Footprint.of(xyz, mesh.indices);
    }

    private constructor(xyz: ArrayLike<number>, indices: ArrayLike<number>) {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, top = -Infinity;
        for (let v = 0; v < xyz.length; v += 3) {
            minX = Math.min(minX, xyz[v]!); maxX = Math.max(maxX, xyz[v]!);
            minZ = Math.min(minZ, xyz[v + 2]!); maxZ = Math.max(maxZ, xyz[v + 2]!);
            top = Math.max(top, xyz[v + 1]!);
        }
        this.top = top;
        // Corners at one place are one corner: a split for texture coordinates is not a rim.
        const span = Math.max(maxX - minX, maxZ - minZ, 1e-9), snap = span * 1e-6;
        const ids = new Map<string, number>(), corner: number[] = [];
        for (let v = 0; v < xyz.length / 3; v++) {
            const key = `${Math.round(xyz[v * 3]! / snap)}:${Math.round(xyz[v * 3 + 2]! / snap)}`;
            let id = ids.get(key);
            if (id === undefined) { id = ids.size; ids.set(key, id); }
            corner.push(id);
        }
        // The triangles that face up; or, where none does (a plane wound the other way), every one that is not edge-on from above.
        const all = Math.floor(indices.length / 3), facing = (t: number): number => {
            const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
            const ux = xyz[b]! - xyz[a]!, uz = xyz[b + 2]! - xyz[a + 2]!, vx = xyz[c]! - xyz[a]!, vz = xyz[c + 2]! - xyz[a + 2]!;
            return uz * vx - ux * vz;
        };
        const flat = span * span * 1e-9;
        let kept: number[] = [];
        for (let t = 0; t < all; t++) if (facing(t) > flat) kept.push(t);
        if (kept.length === 0) for (let t = 0; t < all; t++) if (Math.abs(facing(t)) > flat) kept.push(t);
        if (kept.length === 0) kept = Array.from({ length: all }, (_, t) => t);
        const count = kept.length;
        this.tris = new Float64Array(count * 6);
        const edges = new Map<string, { a: number; b: number; uses: number }>();
        for (let t = 0; t < count; t++) {
            const at = kept[t]!, vs = [indices[at * 3]!, indices[at * 3 + 1]!, indices[at * 3 + 2]!];
            for (let k = 0; k < 3; k++) {
                this.tris[t * 6 + k * 2] = xyz[vs[k]! * 3]!;
                this.tris[t * 6 + k * 2 + 1] = xyz[vs[k]! * 3 + 2]!;
                const p = corner[vs[k]!]!, q = corner[vs[(k + 1) % 3]!]!;
                if (p === q) continue;
                const key = p < q ? `${p}:${q}` : `${q}:${p}`;
                const had = edges.get(key);
                if (had) had.uses++;
                else edges.set(key, { a: vs[k]!, b: vs[(k + 1) % 3]!, uses: 1 });
            }
        }
        const rims: number[] = [];
        for (const e of edges.values()) {
            if (e.uses !== 1) continue;
            rims.push(xyz[e.a * 3]!, xyz[e.a * 3 + 2]!, xyz[e.b * 3]!, xyz[e.b * 3 + 2]!);
        }
        this.rims = Float64Array.from(rims);
        // The triangles by the grid cells their bounds cross: a point asks only the few over it.
        this.minX = minX; this.minZ = minZ;
        this.cellX = Math.max((maxX - minX) / GRID, 1e-9);
        this.cellZ = Math.max((maxZ - minZ) / GRID, 1e-9);
        this.cells = Array.from({ length: GRID * GRID }, () => []);
        for (let t = 0; t < count; t++) {
            const xs = [this.tris[t * 6]!, this.tris[t * 6 + 2]!, this.tris[t * 6 + 4]!], zs = [this.tris[t * 6 + 1]!, this.tris[t * 6 + 3]!, this.tris[t * 6 + 5]!];
            const i0 = this.cellOf(Math.min(...xs), this.minX, this.cellX), i1 = this.cellOf(Math.max(...xs), this.minX, this.cellX);
            const j0 = this.cellOf(Math.min(...zs), this.minZ, this.cellZ), j1 = this.cellOf(Math.max(...zs), this.minZ, this.cellZ);
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * GRID + i]!.push(t);
        }
        this.hull = convexHull(xyz);
    }

    private cellOf(v: number, min: number, size: number): number {
        return Math.min(Math.max(Math.floor((v - min) / size), 0), GRID - 1);
    }

    /** Whether (x, z) on the mesh's plane is inside any of its triangles. */
    contains(x: number, z: number): boolean {
        const fx = (x - this.minX) / this.cellX, fz = (z - this.minZ) / this.cellZ;
        if (fx < 0 || fz < 0 || fx > GRID || fz > GRID) return false;
        const t = this.tris;
        for (const k of this.cells[Math.min(Math.floor(fz), GRID - 1) * GRID + Math.min(Math.floor(fx), GRID - 1)]!) {
            const ax = t[k * 6]!, az = t[k * 6 + 1]!, bx = t[k * 6 + 2]!, bz = t[k * 6 + 3]!, cx = t[k * 6 + 4]!, cz = t[k * 6 + 5]!;
            const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
            const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
            const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
            const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
            if (!(neg && pos)) return true;
        }
        return false;
    }

    /** How far inside the shape (x, z) is, on the mesh's plane: positive inside, negative outside, zero on its rim. */
    sdf(x: number, z: number): number {
        let best = Infinity;
        const r = this.rims;
        for (let e = 0; e < r.length; e += 4) {
            const ax = r[e]!, az = r[e + 1]!, ex = r[e + 2]! - ax, ez = r[e + 3]! - az;
            const len2 = ex * ex + ez * ez;
            const u = len2 > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / len2, 0), 1) : 0;
            best = Math.min(best, Math.hypot(x - ax - u * ex, z - az - u * ez));
        }
        if (best === Infinity) best = 0;
        return this.contains(x, z) ? best : -best;
    }
}

/** The convex hull round the points' xz, counter-clockwise, as {@link Point2} (y standing for z). */
function convexHull(xyz: ArrayLike<number>): Point2[] {
    const pts: Point2[] = [];
    for (let v = 0; v < xyz.length; v += 3) pts.push({ x: xyz[v]!, y: xyz[v + 2]! });
    pts.sort((a, b) => a.x - b.x || a.y - b.y);
    if (pts.length < 3) return pts;
    const cross = (o: Point2, a: Point2, b: Point2): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower: Point2[] = [], upper: Point2[] = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
        lower.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]!;
        while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
}
