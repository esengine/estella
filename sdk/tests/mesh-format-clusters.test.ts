// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A mesh's cluster hierarchy is written behind everything else in the file, and reads back the same.
 */
import { describe, it, expect } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';

const version = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true);

function mesh(extra: Partial<MeshData> = {}): MeshData {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
    ]);
    const vertexCount = 6;
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const view = new DataView(vertices.buffer);
    for (let v = 0; v < vertexCount; v++) view.setFloat32(v * vertexStride, v, true);
    return {
        channels, vertexStride, vertexCount, vertices, indices: Uint32Array.from([0, 1, 2, 2, 3, 4, 3, 4, 5]),
        aabbMin: [0, 0, 0], aabbMax: [vertexCount, 0, 0], ...extra,
    };
}

/** Two clusters of the mesh's own triangles and one above them that stands for both. */
const clusters = () => ({
    coarseIndices: Uint32Array.from([0, 2, 5]),
    ranges: Uint32Array.from([0, 3, 3, 6, 9, 3]),
    bounds: Float32Array.from([
        1, 0, 0, 1, 0, 2.5, 0, 0, 2.5, 0.25,
        4, 0, 0, 1, 0, 2.5, 0, 0, 2.5, 0.25,
        2.5, 0, 0, 2.5, 0.25, 2.5, 0, 0, 2.5, Infinity,
    ]),
});

describe('.esmesh cluster hierarchy', () => {
    it('reads back the clusters it was written with, the top one still replaced by nothing', () => {
        const src = mesh({ clusters: clusters() });
        const bytes = encodeMesh(src);
        expect(version(bytes)).toBe(5);
        const back = decodeMesh(bytes);
        expect(Array.from(back.indices)).toEqual(Array.from(src.indices));
        expect(Array.from(back.clusters!.coarseIndices)).toEqual([0, 2, 5]);
        expect(Array.from(back.clusters!.ranges)).toEqual([0, 3, 3, 6, 9, 3]);
        expect(Array.from(back.clusters!.bounds)).toEqual(Array.from(src.clusters!.bounds));
        expect(back.clusters!.bounds[29]).toBe(Infinity);
    });

    it('leaves a mesh without clusters on the version it had, byte for byte', () => {
        const plain = encodeMesh(mesh());
        expect(version(plain)).toBe(4);
        expect(decodeMesh(plain).clusters).toBeUndefined();
        const clustered = encodeMesh(mesh({ clusters: clusters() }));
        expect(Array.from(clustered.subarray(6, plain.length).filter((_, i) => i !== 50 - 6)))
            .toEqual(Array.from(plain.subarray(6).filter((_, i) => i !== 50 - 6)));
    });

    it('follows the bind pose and the morph targets when a file carries them', () => {
        const src = mesh({
            inverseBindMatrices: new Float32Array(16).fill(1),
            morph: { names: ['smile'], hasNormals: false, deltas: new Float32Array(18).fill(0.5) },
            clusters: clusters(),
        });
        const back = decodeMesh(encodeMesh(src));
        expect(back.morph!.names).toEqual(['smile']);
        expect(Array.from(back.clusters!.ranges)).toEqual([0, 3, 3, 6, 9, 3]);
    });

    it('refuses a cluster whose run is outside the indices, and a section cut short', () => {
        const broken = clusters();
        broken.ranges[4] = 12;
        expect(() => decodeMesh(encodeMesh(mesh({ clusters: broken })))).toThrow(/cluster 2 names indices/);
        const bytes = encodeMesh(mesh({ clusters: clusters() }));
        expect(() => decodeMesh(bytes.subarray(0, bytes.length - 4))).toThrow(/truncated/);
    });
});
