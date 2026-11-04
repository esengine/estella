// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A simplified mesh is a smaller copy of the same surface, made of the same vertices.
 */
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { canSimplify, simplifyMesh } from '../src/assets/meshSimplify';
import { assembleModelPrefab, generateLods, lodName, type ImportedMesh } from '../src/assets/modelImport';

/** A UV sphere: position, normal, one UV set, and a packed colour — the channels a real mesh carries. */
function sphere(rings: number, segments: number): MeshData {
    const stride = 12 + 12 + 8 + 4;
    const n = (rings + 1) * (segments + 1);
    const vertices = new Uint8Array(n * stride);
    const view = new DataView(vertices.buffer);
    let v = 0;
    for (let r = 0; r <= rings; r++) {
        for (let s = 0; s <= segments; s++, v++) {
            const phi = (r / rings) * Math.PI, theta = (s / segments) * Math.PI * 2;
            const p = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
            const at = v * stride;
            p.forEach((c, k) => { view.setFloat32(at + k * 4, c * 50, true); view.setFloat32(at + 12 + k * 4, c, true); });
            view.setFloat32(at + 24, s / segments, true);
            view.setFloat32(at + 28, r / rings, true);
            vertices.set([200, 100, 50, 255], at + 32);
        }
    }
    const indices: number[] = [];
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segments; s++) {
            const a = r * (segments + 1) + s, b = a + segments + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
            { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32, offset: 24 },
            { semantic: MeshChannel.Color, components: 4, type: MeshChannelType.UNorm8, offset: 32 },
        ],
        vertexStride: stride, vertexCount: n, vertices, indices: Uint32Array.from(indices),
        aabbMin: [-50, -50, -50], aabbMax: [50, 50, 50],
    };
}

describe('simplifyMesh', () => {
    it('collapses further across borders and seams when the level is only seen small', async () => {
        const src = sphere(32, 48);
        const near = (await simplifyMesh(src, { ratio: 0.05, maxError: 0.5, flags: ['LockBorder'] }))!;
        const far = (await simplifyMesh(src, { ratio: 0.05, maxError: 0.5, flags: ['Prune', 'Permissive'] }))!;
        // Border and seam vertices that a near level holds still are free to go: the target is reached, not stopped short of.
        expect(far.triangles).toBeLessThan(near.triangles * 0.85);
    });

    it('keeps about the share of triangles it was asked for, and fewer vertices', async () => {
        const src = sphere(32, 48);
        const out = (await simplifyMesh(src, { ratio: 0.25, maxError: 0.5 }))!;
        expect(out).not.toBeNull();
        const asked = src.indices.length / 3 * 0.25;
        expect(out.triangles).toBeLessThan(asked * 1.5);
        expect(out.triangles).toBeGreaterThan(asked * 0.5);
        expect(out.data.vertexCount).toBeLessThan(src.vertexCount);
        expect(out.data.indices.length % 3).toBe(0);
    });

    it('refers only to vertices it carries, and carries every vertex it refers to unchanged', async () => {
        const src = sphere(24, 36);
        const out = (await simplifyMesh(src, { ratio: 0.3, maxError: 0.5 }))!;
        expect(Math.max(...out.data.indices)).toBeLessThan(out.data.vertexCount);
        expect(out.data.vertices.length).toBe(out.data.vertexCount * out.data.vertexStride);
        // Each surviving vertex record is one the source had: colour, UV and normal came with it.
        const records = new Set<string>();
        for (let v = 0; v < src.vertexCount; v++) {
            records.add(Buffer.from(src.vertices.subarray(v * src.vertexStride, (v + 1) * src.vertexStride)).toString('hex'));
        }
        for (let v = 0; v < out.data.vertexCount; v++) {
            const rec = Buffer.from(out.data.vertices.subarray(v * out.data.vertexStride, (v + 1) * out.data.vertexStride)).toString('hex');
            expect(records.has(rec)).toBe(true);
        }
    });

    it('does not move the surface beyond what it was allowed', async () => {
        const src = sphere(32, 48);
        const out = (await simplifyMesh(src, { ratio: 0.2, maxError: 0.02 }))!;
        const view = new DataView(out.data.vertices.buffer);
        let worst = 0;
        for (let v = 0; v < out.data.vertexCount; v++) {
            const at = v * out.data.vertexStride;
            const r = Math.hypot(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));
            worst = Math.max(worst, Math.abs(r - 50));
        }
        expect(worst).toBeLessThan(0.5); // every vertex still sits on the sphere
        expect(out.error).toBeLessThanOrEqual(0.02 + 1e-6);
    });

    it('leaves skinned and morphing geometry alone', async () => {
        const src = sphere(8, 8);
        const skinned: MeshData = {
            ...src, channels: [...src.channels, { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16, offset: 36 }],
        };
        expect(canSimplify(skinned)).toBe(false);
        expect(await simplifyMesh(skinned, { ratio: 0.5 })).toBeNull();
        expect(canSimplify({ ...src, morph: { names: ['a'], hasNormals: false, deltas: new Float32Array(0) } })).toBe(false);
    });

    it('answers null when there is nothing to take out', async () => {
        const src = sphere(4, 4);
        expect(await simplifyMesh(src, { ratio: 1 })).toBeNull();
    });
});

describe('generateLods', () => {
    const imported = (name: string, data: MeshData): ImportedMesh =>
        ({ name, data, vertexCount: data.vertexCount, triangleCount: data.indices.length / 3 });

    it('writes levels that each shed triangles, and points a LODGroup at them', async () => {
        const mesh = imported('rock', sphere(40, 60));
        await generateLods([mesh], { levels: 3, minTriangles: 256 });
        expect(mesh.lods!.length).toBe(3);
        const counts = [mesh.triangleCount, ...mesh.lods!.map((l) => l.triangleCount)];
        for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThan(counts[i - 1]!);
        const sizes = mesh.lods!.map((l) => l.size);
        expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);

        const prefab = assembleModelPrefab('rock', [mesh], { refs: { prefix: 'assets/' } });
        const group = prefab.entities.flatMap((e) => e.components).find((c) => c.type === 'LODGroup')!;
        expect(group.data.lod1).toBe(`assets/${lodName(mesh, 1)}.esmesh`);
        expect(group.data.lod3).toBe('assets/rock_lod3.esmesh');
        expect(group.data.lod1Size).toBe(sizes[0]);
    });

    it('leaves a small mesh and an off setting alone', async () => {
        const small = imported('pebble', sphere(4, 4));
        const big = imported('rock', sphere(40, 60));
        await generateLods([small, big], { levels: 0, minTriangles: 256 });
        expect(small.lods).toBeUndefined();
        expect(big.lods).toBeUndefined();
        await generateLods([small], { levels: 3, minTriangles: 256 });
        expect(small.lods).toBeUndefined();
        const prefab = assembleModelPrefab('pebble', [small]);
        expect(prefab.entities.flatMap((e) => e.components).some((c) => c.type === 'LODGroup')).toBe(false);
    });
});
