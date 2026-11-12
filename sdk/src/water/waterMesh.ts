// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    waterMesh.ts
 * @brief   The geometry of a zone's water: rings of coarsening grids that follow the camera.
 *
 * @details It lies in the xz plane facing up, with the uv the position itself (so the Water shader's surface space is x and z, plus
 *          `u_origin`), and the vertex colour's red the number of the ring the vertex is in, in sevenths (`cell * 2^(red * 7)`
 *          is its cell size: the Water shader's vertex hook fades the waves a coarse ring cannot draw by it).
 *
 *          The surface is rings, each a grid of the same number of cells with twice the cell size of the one inside it and a hole where that one
 *          sits. Where two rings meet the coarse one has half the vertices along the edge, so the surfaces can part there by what the waves
 *          do between its vertices; the fade keeps that to waves the coarse ring can already draw.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';

/** One grid of water: its half-extent, its cell size, the hole in its middle (half-extent, 0 for none) and its ring number. */
interface Grid {
    half: number;
    cell: number;
    hole: number;
    ring: number;
}

/**
 * An ocean of `rings` rings of `cells` cells a side (a multiple of four), the innermost with `cellSize` cells. It reaches
 * `cells * cellSize * 2^(rings - 1) / 2` out from its centre, and with `skirt` a flat apron runs on from there to that
 * half-extent: the sea out to the horizon, at the cost of one cell's quads along each side.
 */
export function buildOceanMesh(cells: number, rings: number, cellSize: number, skirt = 0): MeshData {
    const n = Math.max(4, Math.round(cells / 4) * 4);
    const levels = Math.min(8, Math.max(1, Math.floor(rings)));
    const grids: Grid[] = [];
    for (let ring = 0; ring < levels; ring++) {
        const cell = cellSize * 2 ** ring;
        grids.push({ half: (n * cell) / 2, cell, hole: ring === 0 ? 0 : (n * cell) / 4, ring });
    }
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (const grid of grids) {
        const base = positions.length / 3;
        const stride = n + 1;
        for (let j = 0; j <= n; j++) {
            for (let i = 0; i <= n; i++) {
                positions.push(-grid.half + i * grid.cell, 0, -grid.half + j * grid.cell);
                colors.push(grid.ring / 7, 1, 0, 1);
            }
        }
        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {
                // A cell whose middle is in the hole belongs to the finer ring inside.
                const cx = -grid.half + (i + 0.5) * grid.cell, cz = -grid.half + (j + 0.5) * grid.cell;
                if (grid.hole > 0 && Math.abs(cx) < grid.hole && Math.abs(cz) < grid.hole) continue;
                quad(indices, base + j * stride + i, base + (j + 1) * stride + i, base + j * stride + i + 1, base + (j + 1) * stride + i + 1);
            }
        }
    }
    const outer = grids[grids.length - 1]!;
    if (skirt > outer.half) {
        // Each cell of the outermost ring's edge is carried out to the apron's edge along its own side; the corners take a quad each.
        const base = positions.length / 3, k = skirt / outer.half;
        const edge: Array<[number, number]> = [];
        for (let i = 0; i <= n; i++) edge.push([-outer.half + i * outer.cell, -outer.half]);
        for (let i = 1; i <= n; i++) edge.push([outer.half, -outer.half + i * outer.cell]);
        for (let i = 1; i <= n; i++) edge.push([outer.half - i * outer.cell, outer.half]);
        for (let i = 1; i < n; i++) edge.push([-outer.half, outer.half - i * outer.cell]);
        // Green 0 marks the apron: the Water shader lays it at the open sea's level whatever water its inner edge stands over.
        for (const [x, z] of edge) { positions.push(x, 0, z); colors.push(outer.ring / 7, 0, 0, 1); }
        for (const [x, z] of edge) { positions.push(x * k, 0, z * k); colors.push(outer.ring / 7, 0, 0, 1); }
        const m = edge.length;
        for (let i = 0; i < m; i++) {
            const a = base + i, b = base + ((i + 1) % m), c = base + m + i, d = base + m + ((i + 1) % m);
            // The edge runs clockwise seen from above (+x, then +z): the apron is on its left, and faces up in this order.
            indices.push(a, b, c, b, d, c);
        }
    }
    return pack(positions, colors, indices);
}

/** The outer half-extent of an ocean built with these numbers. */
export function oceanReach(cells: number, rings: number, cellSize: number): number {
    const n = Math.max(4, Math.round(cells / 4) * 4);
    return (n * cellSize * 2 ** (Math.min(8, Math.max(1, Math.floor(rings))) - 1)) / 2;
}

/** The cell size of the coarsest ring: the lattice an ocean follows its camera on, so every ring stays aligned. */
export function oceanSnap(rings: number, cellSize: number): number {
    return cellSize * 2 ** (Math.min(8, Math.max(1, Math.floor(rings))) - 1);
}

/** Two triangles over a cell, facing up (+y) for the vertex order `p00, p01 (+z), p10 (+x), p11`. */
function quad(indices: number[], p00: number, p01: number, p10: number, p11: number): void {
    indices.push(p00, p01, p10, p10, p01, p11);
}

function pack(positions: number[], colors: number[], indices: number[]): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = positions.length / 3;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    const posAt = channels[0]!.offset, uvAt = channels[1]!.offset, colorAt = channels[2]!.offset, normalAt = channels[3]!.offset;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertexCount; i++) {
        const base = i * vertexStride;
        for (let k = 0; k < 3; k++) {
            const value = positions[i * 3 + k]!;
            view.setFloat32(base + posAt + k * 4, value, true);
            if (value < min[k]!) min[k] = value;
            if (value > max[k]!) max[k] = value;
        }
        view.setFloat32(base + normalAt, 0, true);
        view.setFloat32(base + normalAt + 4, 1, true);
        view.setFloat32(base + normalAt + 8, 0, true);
        view.setFloat32(base + uvAt, positions[i * 3]!, true);
        view.setFloat32(base + uvAt + 4, positions[i * 3 + 2]!, true);
        for (let k = 0; k < 4; k++) view.setUint8(base + colorAt + k, Math.round(Math.min(Math.max(colors[i * 4 + k]!, 0), 1) * 255));
    }
    return { channels, vertexStride, vertexCount, vertices, indices: new Uint32Array(indices), aabbMin: min, aabbMax: max };
}
