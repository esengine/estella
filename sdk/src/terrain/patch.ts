// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    patch.ts
 * @brief   The one patch every quadtree node of the ground is drawn with.
 *
 * @details A flat grid of `cells` by `cells` over 0 to 1 in x and z, its uv the same; its box runs 0 to 1 in y as well, because the
 *          Terrain shader lifts it to the node's page and the node's scale.y is its page's height range, so culling sees the ground's true box.
 */
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../asset/meshFormat';
import { buildPatchIndices } from './patchTopology';

export function buildPatchMesh(cells: number, flipped = false): MeshData {
    const n = Math.max(1, Math.floor(cells));
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
    ]);
    const count = (n + 1) * (n + 1);
    const vertices = new Uint8Array(count * vertexStride);
    const view = new DataView(vertices.buffer);
    const [pos, uv, color, normal] = channels.map((c) => c.offset) as [number, number, number, number];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const base = (j * (n + 1) + i) * vertexStride, x = i / n, z = j / n;
        view.setFloat32(base + pos, x, true);
        view.setFloat32(base + pos + 4, 0, true);
        view.setFloat32(base + pos + 8, z, true);
        view.setFloat32(base + uv, x, true);
        view.setFloat32(base + uv + 4, z, true);
        for (let k = 0; k < 4; k++) view.setUint8(base + color + k, 255);
        view.setFloat32(base + normal + 4, 1, true);
    }
    // A cube face's (u, v, out) frame reverses the winding of flat ground's (x, z, up).
    const indices = buildPatchIndices(n, flipped);
    return { channels, vertexStride, vertexCount: count, vertices, indices, aabbMin: [0, 0, 0], aabbMax: [1, 1, 1] };
}
