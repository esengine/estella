// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    surfaceNets.ts
 * @brief   The skin of one chunk of a volume: Naive Surface Nets over its samples.
 *
 * @details One vertex for each cell the surface passes through, at the mean of where it crosses that cell's edges, and one quad for each
 *          grid edge it crosses. An edge belongs to the chunk its first sample is in, so no quad is made twice; a vertex and its normal are
 *          worked out from the eight corners of its cell alone, and those corners are in both chunks' samples at a border, so the two
 *          agree exactly and no crack can open between them, however the chunks were edited.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';

/** A chunk's skin, relative to the chunk's first corner. */
export interface VoxelSurface {
    positions: Float32Array;
    normals: Float32Array;
    /** Four bytes a vertex: how much of each material it is, summing to about 255. */
    weights: Uint8Array;
    indices: Uint32Array;
}

let cellVertex = new Int32Array(0);
let positions = new Float32Array(1 << 14);
let normals = new Float32Array(1 << 14);
let weights = new Uint8Array(1 << 14);
let indices = new Uint32Array(1 << 15);

function growVertices(): void {
    const p = new Float32Array(positions.length * 2); p.set(positions); positions = p;
    const m = new Float32Array(normals.length * 2); m.set(normals); normals = m;
    const w = new Uint8Array(weights.length * 2); w.set(weights); weights = w;
}

/** The skin of a chunk of `cells` a side, with samples from -1 to `cells`; null where the surface does not pass. */
export function surfaceNets(distances: Int8Array, materials: Uint8Array, cells: number, cellSize: number): VoxelSurface | null {
    const s = cells + 2, s2 = s * s, c = cells + 1;
    if (cellVertex.length < c * c * c) cellVertex = new Int32Array(c * c * c);
    cellVertex.fill(-1, 0, c * c * c);
    let vertices = 0, count = 0;
    const tally = [0, 0, 0, 0];

    /** The vertex of the cell whose low corner is at sample (x, y, z), each from 0 to `cells`. */
    const vertexOf = (x: number, y: number, z: number): number => {
        const id = x + y * c + z * c * c;
        const had = cellVertex[id]!;
        if (had >= 0) return had;
        const base = x + y * s + z * s2;
        let sx = 0, sy = 0, sz = 0, crossings = 0;
        for (let a = 0; a < 8; a++) {
            const ia = base + (a & 1) + ((a >> 1) & 1) * s + ((a >> 2) & 1) * s2;
            const da = distances[ia]!;
            for (let axis = 0; axis < 3; axis++) {
                const bit = 1 << axis;
                if (a & bit) continue;
                const ib = ia + (axis === 0 ? 1 : axis === 1 ? s : s2);
                const db = distances[ib]!;
                if ((da < 0) === (db < 0)) continue;
                const t = da / (da - db);
                sx += (a & 1) + (axis === 0 ? t : 0);
                sy += ((a >> 1) & 1) + (axis === 1 ? t : 0);
                sz += ((a >> 2) & 1) + (axis === 2 ? t : 0);
                crossings++;
            }
        }
        const v = vertices++;
        if ((v + 1) * 3 > positions.length) growVertices();
        const d = (dx: number, dy: number, dz: number): number => distances[base + dx + dy * s + dz * s2]!;
        const nx = d(1, 0, 0) - d(0, 0, 0) + d(1, 1, 0) - d(0, 1, 0) + d(1, 0, 1) - d(0, 0, 1) + d(1, 1, 1) - d(0, 1, 1);
        const ny = d(0, 1, 0) - d(0, 0, 0) + d(1, 1, 0) - d(1, 0, 0) + d(0, 1, 1) - d(0, 0, 1) + d(1, 1, 1) - d(1, 0, 1);
        const nz = d(0, 0, 1) - d(0, 0, 0) + d(1, 0, 1) - d(1, 0, 0) + d(0, 1, 1) - d(0, 1, 0) + d(1, 1, 1) - d(1, 1, 0);
        const len = Math.hypot(nx, ny, nz) || 1;
        // Samples start one before the chunk's corner.
        positions[v * 3] = (x - 1 + sx / crossings) * cellSize;
        positions[v * 3 + 1] = (y - 1 + sy / crossings) * cellSize;
        positions[v * 3 + 2] = (z - 1 + sz / crossings) * cellSize;
        normals[v * 3] = nx / len;
        normals[v * 3 + 1] = ny / len;
        normals[v * 3 + 2] = nz / len;
        tally[0] = tally[1] = tally[2] = tally[3] = 0;
        let solid = 0;
        for (let a = 0; a < 8; a++) {
            const ia = base + (a & 1) + ((a >> 1) & 1) * s + ((a >> 2) & 1) * s2;
            if (distances[ia]! < 0) { tally[materials[ia]! & 3]!++; solid++; }
        }
        for (let m = 0; m < 4; m++) weights[v * 4 + m] = Math.round(tally[m]! / solid * 255);
        cellVertex[id] = v;
        return v;
    };

    const quad = (a: number, b: number, c2: number, d: number, flip: boolean): void => {
        if (count + 6 > indices.length) { const g = new Uint32Array(indices.length * 2); g.set(indices); indices = g; }
        if (flip) { indices[count++] = a; indices[count++] = c2; indices[count++] = b; indices[count++] = a; indices[count++] = d; indices[count++] = c2; }
        else { indices[count++] = a; indices[count++] = b; indices[count++] = c2; indices[count++] = a; indices[count++] = c2; indices[count++] = d; }
    };

    // Each edge starts at a sample of this chunk: samples 1..cells in the arrays, the 0th being the margin before it.
    for (let z = 1; z <= cells; z++) {
        for (let y = 1; y <= cells; y++) {
            for (let x = 1; x <= cells; x++) {
                const i = x + y * s + z * s2;
                const inside = distances[i]! < 0;
                if (inside !== (distances[i + 1]! < 0)) {
                    quad(vertexOf(x, y - 1, z - 1), vertexOf(x, y, z - 1), vertexOf(x, y, z), vertexOf(x, y - 1, z), !inside);
                }
                if (inside !== (distances[i + s]! < 0)) {
                    quad(vertexOf(x - 1, y, z - 1), vertexOf(x - 1, y, z), vertexOf(x, y, z), vertexOf(x, y, z - 1), !inside);
                }
                if (inside !== (distances[i + s2]! < 0)) {
                    quad(vertexOf(x - 1, y - 1, z), vertexOf(x, y - 1, z), vertexOf(x, y, z), vertexOf(x - 1, y, z), !inside);
                }
            }
        }
    }
    if (count === 0) return null;
    return {
        positions: positions.slice(0, vertices * 3), normals: normals.slice(0, vertices * 3),
        weights: weights.slice(0, vertices * 4), indices: indices.slice(0, count),
    };
}

/** A skin as geometry for the engine. */
export function voxelMesh(surface: VoxelSurface): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        // Read by nothing here, and left zero; but a WebGPU pipeline fails with a mesh lacking an attribute its vertex stage takes.
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    ]);
    const at = (semantic: number): number => channels.find((c) => c.semantic === semantic)!.offset;
    const posAt = at(MeshChannel.Position), normalAt = at(MeshChannel.Normal), colorAt = at(MeshChannel.Color);
    const vertexCount = surface.positions.length / 3;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vertexCount; v++) {
        const base = v * vertexStride;
        for (let k = 0; k < 3; k++) {
            const p = surface.positions[v * 3 + k]!;
            view.setFloat32(base + posAt + k * 4, p, true);
            view.setFloat32(base + normalAt + k * 4, surface.normals[v * 3 + k]!, true);
            if (p < min[k]!) min[k] = p;
            if (p > max[k]!) max[k] = p;
        }
        for (let k = 0; k < 4; k++) vertices[base + colorAt + k] = surface.weights[v * 4 + k]!;
    }
    return { channels, vertexStride, vertexCount, vertices, indices: surface.indices, aabbMin: min, aabbMax: max };
}
