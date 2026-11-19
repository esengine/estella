// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cluster-lod.test.ts
 * @brief   Verify that a cluster hierarchy keeps the source mesh, and that every view's pick of it is one closed surface.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { decodeMesh, encodeMesh, MeshChannel, MeshChannelType, type MeshData } from 'esengine';
import { buildClusterLod, canClusterMesh, selectClusters, CLUSTER_BOUNDS_FLOATS, CLUSTER_MAX_TRIANGLES, type ClusterLod }
    from '../src/assets/clusterLod';
import { clusterMeshes, generateLods, type ImportedMesh } from '../src/assets/modelImport';

/**
 * A torus with a rippled surface: closed, with position, normal and a UV set whose two seams are doubled vertices,
 * as a real unwrapped mesh has them.
 */
function torus(rings: number, segments: number): MeshData {
    const stride = 12 + 12 + 8;
    const n = (rings + 1) * (segments + 1);
    const vertices = new Uint8Array(n * stride);
    const view = new DataView(vertices.buffer);
    let v = 0;
    for (let r = 0; r <= rings; r++) {
        for (let s = 0; s <= segments; s++, v++) {
            const u = ((r % rings) / rings) * Math.PI * 2, w = ((s % segments) / segments) * Math.PI * 2;
            const tube = 3 + 0.15 * Math.sin(u * 9) * Math.cos(w * 7);
            const normal = [Math.cos(w) * Math.cos(u), Math.sin(w), Math.cos(w) * Math.sin(u)];
            const position = [Math.cos(u) * 10 + normal[0]! * tube, normal[1]! * tube, Math.sin(u) * 10 + normal[2]! * tube];
            const at = v * stride;
            for (let k = 0; k < 3; k++) {
                view.setFloat32(at + k * 4, position[k]!, true);
                view.setFloat32(at + 12 + k * 4, normal[k]!, true);
            }
            view.setFloat32(at + 24, r / rings, true);
            view.setFloat32(at + 28, s / segments, true);
        }
    }
    const indices = new Uint32Array(rings * segments * 6);
    let at = 0;
    for (let r = 0; r < rings; r++) {
        for (let s = 0; s < segments; s++) {
            const a = r * (segments + 1) + s, b = a + segments + 1;
            indices.set([a, b, a + 1, a + 1, b, b + 1], at);
            at += 6;
        }
    }
    return {
        channels: [
            { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32, offset: 0 },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32, offset: 12 },
            { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32, offset: 24 },
        ],
        vertexStride: stride, vertexCount: n, vertices, indices, aabbMin: [-14, -4, -14], aabbMax: [14, 4, 14],
    };
}

/** Position of vertex `i`, as a key two doubled vertices share. */
function positionKey(data: MeshData, i: number): string {
    const view = new DataView(data.vertices.buffer, data.vertices.byteOffset);
    const at = i * data.vertexStride;
    return `${view.getFloat32(at, true)},${view.getFloat32(at + 4, true)},${view.getFloat32(at + 8, true)}`;
}

/** Edges of the picked clusters that are not shared by exactly two of their triangles: none on a closed surface. */
function openEdges(data: MeshData, lod: ClusterLod, picked: number[]): number {
    const ids = new Map<string, number>();
    const weld = (i: number) => {
        const key = positionKey(data, i);
        let id = ids.get(key);
        if (id === undefined) { id = ids.size; ids.set(key, id); }
        return id;
    };
    const uses = new Map<number, number>();
    for (const c of picked) {
        const first = lod.ranges[c * 2]!, count = lod.ranges[c * 2 + 1]!;
        for (let t = first; t < first + count; t += 3) {
            for (let e = 0; e < 3; e++) {
                const a = weld(lod.indices[t + e]!), b = weld(lod.indices[t + (e + 1) % 3]!);
                const key = a < b ? a * data.vertexCount + b : b * data.vertexCount + a;
                uses.set(key, (uses.get(key) ?? 0) + 1);
            }
        }
    }
    let open = 0;
    for (const n of uses.values()) if (n !== 2) open++;
    return open;
}

function triangles(lod: ClusterLod, picked: number[]): number {
    return picked.reduce((n, c) => n + lod.ranges[c * 2 + 1]! / 3, 0);
}

/** An eye's measure of an error: its size over the distance to the sphere's surface, as a perspective view sees it. */
const from = (eye: [number, number, number]) => (x: number, y: number, z: number, radius: number, error: number) =>
    error / Math.max(Math.hypot(x - eye[0], y - eye[1], z - eye[2]) - radius, 1e-6);

describe('buildClusterLod', () => {
    const mesh = torus(300, 200);
    let lod: ClusterLod;
    beforeAll(async () => { lod = (await buildClusterLod(mesh))!; });

    it('refuses what cannot be cut: a small mesh, a skinned one', () => {
        expect(canClusterMesh(torus(8, 8))).toBe(false);
        expect(canClusterMesh({ ...mesh, inverseBindMatrices: new Float32Array(16) })).toBe(false);
    });

    it('keeps the source triangles as level 0', () => {
        expect(lod.leafIndexCount).toBe(mesh.indices.length);
        const key = (ix: Uint32Array, t: number) => [ix[t]!, ix[t + 1]!, ix[t + 2]!].sort((a, b) => a - b).join(',');
        const source = new Set<string>();
        for (let t = 0; t < mesh.indices.length; t += 3) source.add(key(mesh.indices, t));
        let strangers = 0;
        for (let t = 0; t < lod.leafIndexCount; t += 3) if (!source.delete(key(lod.indices, t))) strangers++;
        expect(strangers).toBe(0);
        expect(source.size).toBe(0);
    });

    it('holds each cluster to the triangle limit and names only the mesh\'s vertices', () => {
        for (let c = 0; c < lod.clusterCount; c++) {
            expect(lod.ranges[c * 2 + 1]! / 3).toBeLessThanOrEqual(CLUSTER_MAX_TRIANGLES);
        }
        expect(lod.indices.reduce((most, i) => Math.max(most, i), 0)).toBeLessThan(mesh.vertexCount);
    });

    it('gives every cluster a group whose sphere holds its own and whose error is no smaller', () => {
        const b = lod.bounds;
        for (let c = 0; c < lod.clusterCount; c++) {
            const at = c * CLUSTER_BOUNDS_FLOATS;
            expect(b[at + 9]!).toBeGreaterThanOrEqual(b[at + 4]!);
            if (b[at + 9] === Infinity) continue;
            const apart = Math.hypot(b[at]! - b[at + 5]!, b[at + 1]! - b[at + 6]!, b[at + 2]! - b[at + 7]!);
            expect(apart + b[at + 3]!).toBeLessThanOrEqual(b[at + 8]! * (1 + 1e-5) + 1e-5);
        }
    });

    it('draws the source mesh where no error is allowed', () => {
        const picked = selectClusters(lod, 0, from([0, 0, 0]));
        expect(triangles(lod, picked)).toBe(mesh.indices.length / 3);
        expect(openEdges(mesh, lod, picked)).toBe(0);
    });

    it('picks one closed surface from every eye, with fewer triangles the farther it stands', () => {
        const threshold = 0.002;
        let last = Infinity;
        for (const distance of [14, 20, 40, 120, 500, 4000]) {
            const picked = selectClusters(lod, threshold, from([distance, distance * 0.3, 0]));
            expect(openEdges(mesh, lod, picked), `open edges at ${distance}`).toBe(0);
            const count = triangles(lod, picked);
            expect(count).toBeLessThanOrEqual(last);
            last = count;
        }
        expect(last).toBeLessThan(mesh.indices.length / 3 * 0.02);
    });

    it('mixes levels across one surface when the eye is beside it', () => {
        const picked = selectClusters(lod, 0.002, from([14.5, 0, 0]));
        const leaves = picked.filter(c => lod.bounds[c * CLUSTER_BOUNDS_FLOATS + 4] === 0).length;
        expect(leaves).toBeGreaterThan(0);
        expect(leaves).toBeLessThan(picked.length);
        expect(openEdges(mesh, lod, picked)).toBe(0);
    });
});

describe('clusterMeshes', () => {
    const imported = (data: MeshData): ImportedMesh =>
        ({ name: 'torus', data, vertexCount: data.vertexCount, triangleCount: data.indices.length / 3 });

    it('gives a dense mesh a hierarchy that survives the file, and leaves it without stand-ins', async () => {
        const source = torus(160, 100);
        const mesh = imported(source);
        expect(await clusterMeshes([mesh])).toEqual([]);
        expect(mesh.data.indices.length).toBe(source.indices.length);
        await generateLods([mesh], { levels: 3, minTriangles: 0 });
        expect(mesh.lods).toBeUndefined();

        const back = decodeMesh(encodeMesh(mesh.data));
        const clusters = back.clusters!;
        const indices = new Uint32Array(back.indices.length + clusters.coarseIndices.length);
        indices.set(back.indices);
        indices.set(clusters.coarseIndices, back.indices.length);
        const lod: ClusterLod = {
            indices, ranges: clusters.ranges, bounds: clusters.bounds, clusterCount: clusters.ranges.length / 2,
            leafIndexCount: back.indices.length, levels: 0,
        };
        const picked = selectClusters(lod, 0.002, from([60, 10, 0]));
        expect(openEdges(back, lod, picked)).toBe(0);
        expect(triangles(lod, picked)).toBeLessThan(source.indices.length / 3 / 4);
    });

    it('says which dense mesh it had to leave drawn whole, and nothing of a small one', async () => {
        const skinned = imported({ ...torus(160, 100), inverseBindMatrices: new Float32Array(16) });
        expect(await clusterMeshes([skinned, imported(torus(8, 8))])).toEqual([
            'torus: skinned or morphing, so Cluster LOD left its 32000 triangles drawn whole',
        ]);
        expect(skinned.data.clusters).toBeUndefined();
    });
});
