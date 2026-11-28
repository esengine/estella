// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { SurfaceTile } from './surface';

type Vertex = [number, number, number];

function clipEdge(vertices: Vertex[], axis: 0 | 2, edge: number, lower: boolean): Vertex[] {
    const clipped: Vertex[] = [];
    let previous = vertices[vertices.length - 1]!;
    for (const current of vertices) {
        const before = previous[axis] - edge, after = current[axis] - edge;
        if ((before < 0 && after > 0) || (before > 0 && after < 0)) {
            const t = before / (before - after);
            const cut: Vertex = [
                previous[0] + t * (current[0] - previous[0]),
                previous[1] + t * (current[1] - previous[1]),
                previous[2] + t * (current[2] - previous[2]),
            ];
            cut[axis] = edge;
            clipped.push(cut);
        }
        if (lower ? after >= 0 : after <= 0) clipped.push(current);
        previous = current;
    }
    return clipped;
}

/** Clip the existing surface planes to the area, using the tile's local coordinates. */
export function clipSurfaceTile(tile: SurfaceTile, bounds: readonly [number, number, number, number]): SurfaceTile | null {
    const minX = bounds[0] - tile.x0, minZ = bounds[1] - tile.z0;
    const maxX = bounds[2] - tile.x0, maxZ = bounds[3] - tile.z0;
    const outside = new Uint8Array(tile.positions.length / 3);
    const remap = new Uint32Array(outside.length);
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i < outside.length; i++) {
        const x = tile.positions[i * 3]!, z = tile.positions[i * 3 + 2]!;
        const mask = (x < minX ? 1 : x > maxX ? 2 : 0) | (z < minZ ? 4 : z > maxZ ? 8 : 0);
        outside[i] = mask;
        if (!mask) {
            remap[i] = positions.length / 3;
            positions.push(x, tile.positions[i * 3 + 1]!, z);
        }
    }
    const read = (i: number): Vertex => [tile.positions[i * 3]!, tile.positions[i * 3 + 1]!, tile.positions[i * 3 + 2]!];
    for (let i = 0; i < tile.indices.length; i += 3) {
        const a = tile.indices[i]!, b = tile.indices[i + 1]!, c = tile.indices[i + 2]!;
        const ma = outside[a]!, mb = outside[b]!, mc = outside[c]!;
        const cuts = ma | mb | mc;
        if (!cuts) {
            indices.push(remap[a]!, remap[b]!, remap[c]!);
            continue;
        }
        if (ma & mb & mc) continue;
        let polygon = [read(a), read(b), read(c)];
        if (cuts & 1) polygon = clipEdge(polygon, 0, minX, true);
        if (cuts & 2) polygon = clipEdge(polygon, 0, maxX, false);
        if (cuts & 4) polygon = clipEdge(polygon, 2, minZ, true);
        if (cuts & 8) polygon = clipEdge(polygon, 2, maxZ, false);
        if (polygon.length < 3) continue;
        const first = positions.length / 3;
        for (const point of polygon) positions.push(...point);
        for (let j = 1; j + 1 < polygon.length; j++) indices.push(first, first + j, first + j + 1);
    }
    return indices.length ? { ...tile, positions: Float32Array.from(positions), indices: Uint32Array.from(indices) } : null;
}
