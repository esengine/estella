// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    clipGeometry.ts
 * @brief   What a frame draws, in the forms two builds can be compared in.
 *
 * @details A triangle digest answers "the same list"; some changes are allowed
 *          to produce a different list of the same geometry, and then the
 *          question becomes which geometry. Area and the vertex set answer that
 *          — a convex polygon fanned from another corner has the same both.
 */

export interface DrawnGeometry {
    /** Every triangle's three vertices, in draw order — the strict form. */
    digest: string;
    triangles: number;
    /** Summed |signed area| over the triangles. */
    area: number;
    /** Every distinct emitted vertex as `x,y,u,v`, sorted. */
    vertices: string[];
}

function fnv1a(seed: number, bytes: Uint8Array): number {
    let hash = seed;
    for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 0x01000193) >>> 0;
    return hash >>> 0;
}

export interface BatchReader {
    batches: number;
    vertexCount(batch: number): number;
    indexCount(batch: number): number;
    /** `[vertices (x,y,u,v,r,g,b,a per vertex), indices]` for one batch. */
    read(batch: number): { vertices: Float32Array; indices: Uint16Array };
}

export function drawnGeometry(reader: BatchReader): DrawnGeometry {
    let hash = 0x811c9dc5;
    let triangles = 0;
    let area = 0;
    const vertices = new Set<string>();
    for (let b = 0; b < reader.batches; b++) {
        const { vertices: data, indices } = reader.read(b);
        for (let i = 0; i + 2 < indices.length; i += 3) {
            const at = [indices[i], indices[i + 1], indices[i + 2]].map((v) => v * 8);
            const [ax, ay] = [data[at[0]], data[at[0] + 1]];
            const [bx, by] = [data[at[1]], data[at[1] + 1]];
            const [cx, cy] = [data[at[2]], data[at[2] + 1]];
            area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
            triangles++;
        }
        for (let i = 0; i < indices.length; i++) {
            const at = indices[i] * 8;
            hash = fnv1a(hash, new Uint8Array(data.buffer, data.byteOffset + at * 4, 8 * 4));
            vertices.add([data[at], data[at + 1], data[at + 2], data[at + 3]].join(','));
        }
    }
    return {
        digest: (hash >>> 0).toString(16).padStart(8, '0'),
        triangles,
        area,
        vertices: [...vertices].sort(),
    };
}
