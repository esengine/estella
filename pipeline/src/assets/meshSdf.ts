// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    meshSdf.ts
 * @brief   A mesh's signed distance field, baked at import: what the dynamic GI traces rays against.
 *
 * @details The field is a regular grid over the mesh's bounds (padded by a few cells) holding the signed distance, in the mesh's
 *          own units, from each cell's centre to the surface: negative inside. See docs/GI_LUMEN_DESIGN.md, 3.1.
 *
 *          Three steps, none of them clever, all of them exact where it matters:
 *            1. every triangle writes the exact point-triangle distance into the cells within a narrow band of it, keeping the
 *               smallest, and the sign of the face it is closest to;
 *            2. the cells the band missed take their distance from a two-direction sweep over their neighbours (a chamfer: the
 *               true distance to within a few percent, which is plenty for a ray that only needs to know how far it may step);
 *            3. the sign of those cells comes from a flood fill from the grid's border: what the border can reach is outside,
 *               the rest is inside. The band's own sign (from the face normal) is what keeps a wall thinner than a cell
 *               negative at its centre.
 *
 *          The result is then grown by `inflate` cells (default half a cell) so that a structure thinner than the grid still
 *          blocks a ray: a 10 cm wall in a 40 cm cell is a wall to a trace, not a gap. That makes everything up to half a cell
 *          fatter, which is the price of the field being coarse and is stated here, not hidden.
 */
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';

export interface MeshSdfOptions {
    /** The grid's target cell size in mesh units; raised when the longest side would need more than `maxDim` cells. */
    cellSize: number;
    /** The most cells along the longest side. */
    maxDim?: number;
    /** Cells of padding round the bounds, so a ray just outside still reads a distance. */
    pad?: number;
    /** How far the surface is grown, in cells. */
    inflate?: number;
}

export interface MeshSdf {
    dims: [number, number, number];
    /** Edge of one cell, in mesh units. */
    cell: number;
    /** The world-space position of the first cell's CORNER; cell (i, j, k) is centred at `origin + (i + 0.5, j + 0.5, k + 0.5) * cell`. */
    origin: [number, number, number];
    /** Signed distance per cell, x fastest, in mesh units. */
    distance: Float32Array;
    /** The growth already applied, in mesh units. */
    inflate: number;
}

const BAND = 3;
const INF = 1e30;

/** The positions of a mesh as a flat float array, or null where it has no float position channel. */
export function meshPositions(data: MeshData): Float32Array | null {
    const channel = data.channels.find((c) => c.semantic === MeshChannel.Position && c.components >= 3 && c.type === MeshChannelType.Float32);
    if (!channel) return null;
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
    const out = new Float32Array(data.vertexCount * 3);
    for (let v = 0; v < data.vertexCount; v++) {
        for (let k = 0; k < 3; k++) out[v * 3 + k] = view.getFloat32(v * data.vertexStride + channel.offset + k * 4, true);
    }
    return out;
}

/** The point on triangle (a, b, c) nearest to p (Ericson, Real-Time Collision Detection 5.1.5), written into `out`. */
function closestOnTriangle(p: number[], a: number[], b: number[], c: number[], out: number[]): void {
    const abx = b[0]! - a[0]!, aby = b[1]! - a[1]!, abz = b[2]! - a[2]!;
    const acx = c[0]! - a[0]!, acy = c[1]! - a[1]!, acz = c[2]! - a[2]!;
    const apx = p[0]! - a[0]!, apy = p[1]! - a[1]!, apz = p[2]! - a[2]!;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const set = (x: number, y: number, z: number) => { out[0] = x; out[1] = y; out[2] = z; };
    if (d1 <= 0 && d2 <= 0) return set(a[0]!, a[1]!, a[2]!);
    const bpx = p[0]! - b[0]!, bpy = p[1]! - b[1]!, bpz = p[2]! - b[2]!;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return set(b[0]!, b[1]!, b[2]!);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return set(a[0]! + abx * v, a[1]! + aby * v, a[2]! + abz * v);
    }
    const cpx = p[0]! - c[0]!, cpy = p[1]! - c[1]!, cpz = p[2]! - c[2]!;
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return set(c[0]!, c[1]!, c[2]!);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return set(a[0]! + acx * w, a[1]! + acy * w, a[2]! + acz * w);
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        return set(b[0]! + (c[0]! - b[0]!) * w, b[1]! + (c[1]! - b[1]!) * w, b[2]! + (c[2]! - b[2]!) * w);
    }
    const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
    set(a[0]! + abx * v + acx * w, a[1]! + aby * v + acy * w, a[2]! + abz * v + acz * w);
}

/** Bakes the field of one mesh, or null for a mesh with no triangles to measure. */
export function bakeMeshSdf(data: MeshData, options: MeshSdfOptions): MeshSdf | null {
    const positions = meshPositions(data);
    if (!positions || data.indices.length < 3) return null;
    const maxDim = options.maxDim ?? 64, pad = options.pad ?? 2, inflateCells = options.inflate ?? 0.5;
    const extent = [0, 1, 2].map((k) => data.aabbMax[k]! - data.aabbMin[k]!);
    const longest = Math.max(...extent, 1e-6);
    // The cell cannot be so small that the longest side needs more than maxDim cells (padding included).
    const cell = Math.max(options.cellSize, longest / Math.max(maxDim - 2 * pad, 1));
    const dims = extent.map((e) => Math.max(Math.ceil(e / cell), 1) + 2 * pad) as [number, number, number];
    const origin = [0, 1, 2].map((k) => data.aabbMin[k]! - pad * cell) as [number, number, number];
    const [nx, ny, nz] = dims, total = nx * ny * nz;
    const dist = new Float32Array(total).fill(INF);
    const sign = new Int8Array(total);  // -1 inside by a face normal, +1 outside, 0 unknown
    const near = new Uint8Array(total);

    const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], p = [0, 0, 0], q = [0, 0, 0];
    for (let t = 0; t < data.indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const i = data.indices[t + k]! * 3;
            (k === 0 ? a : k === 1 ? b : c).splice(0, 3, positions[i]!, positions[i + 1]!, positions[i + 2]!);
        }
        const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        const fl = Math.hypot(fx, fy, fz);
        if (fl < 1e-20) continue;
        fx /= fl; fy /= fl; fz /= fl;
        const lo = [0, 1, 2].map((k) => Math.max(Math.floor((Math.min(a[k]!, b[k]!, c[k]!) - origin[k]!) / cell) - BAND, 0));
        const hi = [0, 1, 2].map((k) => Math.min(Math.floor((Math.max(a[k]!, b[k]!, c[k]!) - origin[k]!) / cell) + BAND, dims[k]! - 1));
        for (let z = lo[2]!; z <= hi[2]!; z++) {
            for (let y = lo[1]!; y <= hi[1]!; y++) {
                for (let x = lo[0]!; x <= hi[0]!; x++) {
                    p[0] = origin[0] + (x + 0.5) * cell; p[1] = origin[1] + (y + 0.5) * cell; p[2] = origin[2] + (z + 0.5) * cell;
                    closestOnTriangle(p, a, b, c, q);
                    const dx = p[0] - q[0]!, dy = p[1] - q[1]!, dz = p[2] - q[2]!;
                    const d = Math.hypot(dx, dy, dz), i = x + y * nx + z * nx * ny;
                    if (d >= dist[i]!) continue;
                    dist[i] = d;
                    near[i] = 1;
                    // Which side of the face the cell is on; a cell on the surface itself keeps the last known side.
                    const side = dx * fx + dy * fy + dz * fz;
                    if (Math.abs(side) > 1e-6 * cell) sign[i] = side > 0 ? 1 : -1;
                }
            }
        }
    }

    // Cells the band missed: a chamfer sweep over the 13 forward then the 13 backward neighbours.
    const offsets: Array<[number, number, number, number]> = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0 && dz === 0) continue;
        offsets.push([dx, dy, dz, Math.hypot(dx, dy, dz) * cell]);
    }
    const sweep = (forward: boolean) => {
        const relevant = offsets.filter(([dx, dy, dz]) => {
            const lead = dz !== 0 ? dz : dy !== 0 ? dy : dx;
            return forward ? lead < 0 : lead > 0;
        });
        for (let n = 0; n < total; n++) {
            const idx = forward ? n : total - 1 - n;
            const x = idx % nx, y = Math.floor(idx / nx) % ny, z = Math.floor(idx / (nx * ny));
            if (near[idx]) continue;
            let best = dist[idx]!;
            for (const [dx, dy, dz, w] of relevant) {
                const X = x + dx, Y = y + dy, Z = z + dz;
                if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
                const d = dist[X + Y * nx + Z * nx * ny]! + w;
                if (d < best) best = d;
            }
            dist[idx] = best;
        }
    };
    sweep(true); sweep(false); sweep(true); sweep(false);

    // Far cells: outside when the border reaches them without crossing a banded cell, inside otherwise.
    const outside = new Uint8Array(total);
    const stack: number[] = [];
    const seed = (x: number, y: number, z: number) => {
        const i = x + y * nx + z * nx * ny;
        if (!near[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
    };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) seed(x, y, z);
    }
    while (stack.length > 0) {
        const i = stack.pop()!;
        const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
        if (x > 0) seed(x - 1, y, z);
        if (x < nx - 1) seed(x + 1, y, z);
        if (y > 0) seed(x, y - 1, z);
        if (y < ny - 1) seed(x, y + 1, z);
        if (z > 0) seed(x, y, z - 1);
        if (z < nz - 1) seed(x, y, z + 1);
    }

    const inflate = inflateCells * cell;
    const out = new Float32Array(total);
    for (let i = 0; i < total; i++) {
        const negative = near[i] ? sign[i]! < 0 : !outside[i];
        out[i] = (negative ? -dist[i]! : dist[i]!) - inflate;
    }
    return { dims, cell, origin, distance: out, inflate };
}

/** The value a half-float holds nearest to `v` (IEEE 754 binary16, round to nearest even, no NaN). */
export function toHalf(v: number): number {
    if (!(Math.abs(v) < 65504)) return v < 0 ? 0xfbff : 0x7bff;
    const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0]!;
    const sign = (u >>> 16) & 0x8000;
    let exp = ((u >>> 23) & 0xff) - 127 + 15;
    let man = u & 0x7fffff;
    if (exp <= 0) {
        if (exp < -10) return sign;
        man = (man | 0x800000) >>> (1 - exp);
        return sign | ((man + 0x1000) >>> 13);
    }
    const rounded = (man + 0xfff + ((man >>> 13) & 1)) >>> 13;
    return sign | (((exp << 10) + rounded) & 0xffff);
}

export function fromHalf(h: number): number {
    const sign = h & 0x8000 ? -1 : 1, exp = (h >>> 10) & 0x1f, man = h & 0x3ff;
    if (exp === 0) return sign * man * 2 ** -24;
    if (exp === 31) return sign * 65504;
    return sign * (1 + man / 1024) * 2 ** (exp - 15);
}

/** `.esmeshsdf`: 'ESDF', version 1, dims x3 (u32), cell, origin x3, inflate (f32), then the distances as half floats, x fastest. */
export const MESH_SDF_MAGIC = 0x46445345;
export const MESH_SDF_HEADER_BYTES = 4 * (2 + 3 + 1 + 3 + 1);

export function encodeMeshSdf(sdf: MeshSdf): Uint8Array {
    const count = sdf.distance.length, bytes = new Uint8Array(MESH_SDF_HEADER_BYTES + count * 2 + (count & 1) * 2);
    const view = new DataView(bytes.buffer);
    let o = 0;
    const u32 = (v: number) => { view.setUint32(o, v, true); o += 4; };
    const f32 = (v: number) => { view.setFloat32(o, v, true); o += 4; };
    u32(MESH_SDF_MAGIC); u32(1);
    sdf.dims.forEach(u32);
    f32(sdf.cell);
    sdf.origin.forEach(f32);
    f32(sdf.inflate);
    for (let i = 0; i < count; i++) view.setUint16(o + i * 2, toHalf(sdf.distance[i]!), true);
    return bytes;
}

export function decodeMeshSdf(bytes: Uint8Array): MeshSdf {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MESH_SDF_MAGIC) throw new Error('not a mesh distance field');
    if (view.getUint32(4, true) !== 1) throw new Error(`unsupported mesh distance field version ${view.getUint32(4, true)}`);
    const dims: [number, number, number] = [view.getUint32(8, true), view.getUint32(12, true), view.getUint32(16, true)];
    const cell = view.getFloat32(20, true);
    const origin: [number, number, number] = [view.getFloat32(24, true), view.getFloat32(28, true), view.getFloat32(32, true)];
    const inflate = view.getFloat32(36, true);
    const count = dims[0] * dims[1] * dims[2], distance = new Float32Array(count);
    for (let i = 0; i < count; i++) distance[i] = fromHalf(view.getUint16(MESH_SDF_HEADER_BYTES + i * 2, true));
    return { dims, cell, origin, distance, inflate };
}

/**
 * The field's value at a point: trilinear between cell centres inside the grid, and beyond its edge the edge value plus how far the point
 * is from the grid (the nearest surface is at least that much further, so a trace may step that far).
 */
export function sampleMeshSdf(sdf: MeshSdf, point: readonly [number, number, number]): number {
    const g = [0, 1, 2].map((k) => Math.min(Math.max((point[k]! - sdf.origin[k]!) / sdf.cell - 0.5, 0), sdf.dims[k]! - 1 - 1e-6));
    const i0 = g.map(Math.floor) as number[], f = g.map((v, k) => v - i0[k]!);
    const beyond = Math.hypot(...[0, 1, 2].map((k) => Math.max(sdf.origin[k]! + 0.5 * sdf.cell - point[k]!, point[k]! - (sdf.origin[k]! + (sdf.dims[k]! - 0.5) * sdf.cell), 0)));
    const at = (x: number, y: number, z: number) => sdf.distance[x + y * sdf.dims[0] + z * sdf.dims[0] * sdf.dims[1]]!;
    let sum = 0;
    for (let c = 0; c < 8; c++) {
        const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
        const w = (dx ? f[0]! : 1 - f[0]!) * (dy ? f[1]! : 1 - f[1]!) * (dz ? f[2]! : 1 - f[2]!);
        sum += w * at(i0[0]! + dx, i0[1]! + dy, i0[2]! + dz);
    }
    return sum + beyond;
}
