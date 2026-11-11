// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    meshSdfFormat.ts
 * @brief   `.esmeshsdf`: a mesh's baked signed distance field, and how to read one (docs/GI_LUMEN_DESIGN.md, 3.1).
 *
 * @details The baker is the pipeline's (pipeline/src/assets/meshSdf.ts); the runtime reads it here. Distances are in the mesh's own
 *          units, negative inside, already grown by `inflate` so a wall thinner than a cell is still a body.
 */

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
