// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: a few vertices bound to a joint no clip moves are bound as the vertices beside them are; a joint that holds
 * much of the mesh, or a model with no clips, is left alone.
 */
import { describe, expect, it } from 'vitest';
import { MeshChannel, MeshChannelType, packChannels } from 'esengine';
import { rebindStrayVertices } from '../src/assets/strayJoints';
import type { ImportedMesh, ImportedNode } from '../src/assets/modelImport';

const node = (index: number, name: string, children: ImportedNode[] = []): ImportedNode => ({
    index, name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], meshes: [], children,
});

/** Armature(0) > Hips(1) > Head(2), and a Neutral(3) beside the hips. */
const nodes = [node(0, 'Armature', [node(1, 'Hips', [node(2, 'Head')]), node(3, 'Neutral')])];
const clip = { tracks: [{ childPath: 'Hips' }, { childPath: 'Hips/Head' }] };

/** `count` vertices in a strip of triangles, each bound wholly to the joint slot `bound(v)` says. */
function mesh(count: number, bound: (v: number) => number): ImportedMesh {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
        { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(count * vertexStride);
    const view = new DataView(vertices.buffer);
    const [p, j, w] = channels;
    for (let v = 0; v < count; v++) {
        view.setFloat32(v * vertexStride + p!.offset, v, true);
        view.setUint16(v * vertexStride + j!.offset, bound(v), true);
        view.setFloat32(v * vertexStride + w!.offset, 1, true);
    }
    const indices: number[] = [];
    for (let v = 0; v + 2 < count; v++) indices.push(v, v + 1, v + 2);
    return {
        name: 'Body', skinJoints: [1, 2, 3],
        data: { channels, vertexStride, vertexCount: count, vertices, indices: new Uint32Array(indices), aabbMin: [0, 0, 0], aabbMax: [count, 0, 0] },
    } as unknown as ImportedMesh;
}

const slotOf = (m: ImportedMesh, v: number): number => {
    const j = m.data.channels.find((c) => c.semantic === MeshChannel.Joints)!;
    return new DataView(m.data.vertices.buffer).getUint16(v * m.data.vertexStride + j.offset, true);
};

describe('a vertex bound to a joint no clip moves', () => {
    it('is bound as its neighbour is, and the import says so', () => {
        const m = mesh(200, (v) => (v === 120 ? 2 : v < 100 ? 0 : 1));
        const notes = rebindStrayVertices([m], nodes, [clip]);
        expect(slotOf(m, 120)).toBe(1);
        expect(notes[0]).toMatch(/1 vertices were bound to Neutral/);
    });

    it('is left where much of the mesh is bound to that joint: it is a part that does not move', () => {
        const m = mesh(200, (v) => (v < 50 ? 2 : 0));
        expect(rebindStrayVertices([m], nodes, [clip])).toEqual([]);
        expect(slotOf(m, 10)).toBe(2);
    });

    it('is left in a model with no clips, where no joint moves', () => {
        const m = mesh(200, (v) => (v === 120 ? 2 : 0));
        expect(rebindStrayVertices([m], nodes, [])).toEqual([]);
        expect(slotOf(m, 120)).toBe(2);
    });
});
