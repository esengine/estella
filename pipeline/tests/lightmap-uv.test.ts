// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A model's own second UV set is kept as its lightmap layout only where a
 *        bake could use it.
 */
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, unwrapLightmapUV, type MeshData } from 'esengine';
import { applyLightmapUV, lightmapUVLayout, type ImportedMesh } from '../src/assets/modelImport';

function floor(half: number): MeshData {
    const p = [[-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half]];
    const vertices = new Uint8Array(p.length * 12);
    const view = new DataView(vertices.buffer);
    p.forEach((q, i) => q.forEach((v, k) => view.setFloat32(i * 12 + k * 4, v, true)));
    return {
        channels: [{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 }],
        vertexStride: 12, vertexCount: 4, vertices,
        indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
        aabbMin: [-half, 0, -half], aabbMax: [half, 0, half],
    };
}

/** A mesh whose second UV set sits in a sliver of its square, as ORCA Bistro's road does. */
function sparse(): MeshData {
    const mesh = unwrapLightmapUV(floor(10)).mesh;
    const uv1 = mesh.channels.find((c) => c.semantic === MeshChannel.TexCoord1)!;
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
    for (let i = 0; i < mesh.vertexCount; i++) {
        for (let k = 0; k < 2; k++) {
            const at = i * mesh.vertexStride + uv1.offset + k * 4;
            view.setFloat32(at, view.getFloat32(at, true) * 0.1, true);
        }
    }
    return mesh;
}

/** Two quads laid over the same UVs, as a curb repeated along a street shares one strip. */
function stacked(): MeshData {
    const one = unwrapLightmapUV(floor(10)).mesh;
    const vertices = new Uint8Array(one.vertices.length * 2);
    vertices.set(one.vertices, 0);
    vertices.set(one.vertices, one.vertices.length);
    const view = new DataView(vertices.buffer);
    const pos = one.channels.find((c) => c.semantic === MeshChannel.Position)!;
    for (let i = one.vertexCount; i < one.vertexCount * 2; i++) {
        const at = i * one.vertexStride + pos.offset;
        view.setFloat32(at, view.getFloat32(at, true) + 30, true);
    }
    const indices = Uint32Array.from([...one.indices, ...Array.from(one.indices, (v) => v + one.vertexCount)]);
    return { ...one, vertices, vertexCount: one.vertexCount * 2, indices };
}

const imported = (name: string, data: MeshData): ImportedMesh =>
    ({ name, data, vertexCount: data.vertexCount, triangleCount: data.indices.length / 3 });

describe('a source\'s own lightmap UVs', () => {
    it('are kept where they cover their square, and unwrapped over where they do not', () => {
        const good = imported('Square', unwrapLightmapUV(floor(10)).mesh);
        const road = imported('Road', sparse());
        expect(lightmapUVLayout(road.data).coverage).toBeLessThan(0.05);

        const warnings = applyLightmapUV([good, road]);
        expect(warnings).toContain('Square: already carries a second UV set, which is kept');
        expect(warnings.find((w) => w.startsWith('Road:'))).toMatch(/covers \d\.\d% of its square.*unwrapped in its place/);
        expect(lightmapUVLayout(road.data).coverage).toBeGreaterThan(0.05);
    });

    it('are unwrapped over where they lie on themselves', () => {
        const curb = imported('Curb', stacked());
        expect(lightmapUVLayout(curb.data).overlap).toBeGreaterThan(1.9);
        const warnings = applyLightmapUV([curb]);
        expect(warnings.find((w) => w.startsWith('Curb:'))).toMatch(/2\.0 layers deep.*unwrapped in its place/);
        expect(lightmapUVLayout(curb.data).overlap).toBeLessThan(1.1);
    });
});
