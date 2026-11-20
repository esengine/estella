// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A skinned mesh's GPU form: influences cut to the limit, a skin past one draw's bones split into chunks, and the
 *        skin channels narrowed to a byte. What must hold through all of it is that every vertex is still moved by the
 *        same joints with the same weights, read back through its chunk.
 */
import { describe, it, expect } from 'vitest';
import { encodeMesh, decodeMesh, packChannels, MeshChannel, MeshChannelType, componentBytes, type MeshData } from '../src/asset/meshFormat';
import { buildSkinnedMesh, fitSkinToBudget, SKIN_INFLUENCES } from '../src/asset/skinChunks';

/**
 * A strip of `triangles` triangles over `joints` joints: vertex v is moved by joints v, v+1 (mod joints) with weights
 * 0.7 / 0.3, so neighbouring triangles share bones and a run of them names a widening set. Optional morph target.
 */
function strip(triangles: number, joints: number, morph = false): MeshData {
    const vertexCount = triangles + 2;
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Joints, components: 4, type: MeshChannelType.UInt16 },
        { semantic: MeshChannel.Weights, components: 4, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(vertexCount * vertexStride);
    const dv = new DataView(vertices.buffer);
    for (let v = 0; v < vertexCount; v++) {
        const b = v * vertexStride;
        dv.setFloat32(b, v, true);
        dv.setUint16(b + channels[1]!.offset, v % joints, true);
        dv.setUint16(b + channels[1]!.offset + 2, (v + 1) % joints, true);
        dv.setFloat32(b + channels[2]!.offset, 0.7, true);
        dv.setFloat32(b + channels[2]!.offset + 4, 0.3, true);
    }
    const indices = new Uint32Array(triangles * 3);
    for (let t = 0; t < triangles; t++) indices.set([t, t + 1, t + 2], t * 3);
    const mesh: MeshData = {
        channels, vertexStride, vertexCount, vertices, indices, aabbMin: [0, 0, 0], aabbMax: [vertexCount, 0, 0],
        inverseBindMatrices: new Float32Array(joints * 16),
    };
    if (morph) mesh.morph = { names: ['m'], hasNormals: false, deltas: Float32Array.from({ length: vertexCount * 3 }, (_, i) => i) };
    return mesh;
}

/** Each index's vertex as (position x, global joints with weights): what skinning reads, chunk maps applied. */
function skinnedCorners(mesh: MeshData): { x: number; influences: string }[] {
    const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);
    const jc = mesh.channels.find((c) => c.semantic === MeshChannel.Joints)!;
    const wc = mesh.channels.find((c) => c.semantic === MeshChannel.Weights)!;
    const chunks = mesh.skinChunks;
    const chunkOfIndex = (i: number): number => {
        if (!chunks) return -1;
        for (let c = 0; c < chunks.boneCounts.length; c++) if (i < chunks.ranges[c * 2]! + chunks.ranges[c * 2 + 1]!) return c;
        return -1;
    };
    const out: { x: number; influences: string }[] = [];
    for (let i = 0; i < mesh.indices.length; i++) {
        const v = mesh.indices[i]!;
        const b = v * mesh.vertexStride;
        const c = chunkOfIndex(i);
        const start = chunks && c >= 0 ? chunks.boneCounts.slice(0, c).reduce((a, n) => a + n, 0) : 0;
        const parts: string[] = [];
        for (let k = 0; k < SKIN_INFLUENCES; k++) {
            const wb = componentBytes(wc.type), jb = componentBytes(jc.type);
            const w = wc.type === MeshChannelType.Float32 ? view.getFloat32(b + wc.offset + k * 4, true)
                : wc.type === MeshChannelType.UNorm16 ? view.getUint16(b + wc.offset + k * wb, true) / 65535
                    : view.getUint8(b + wc.offset + k * wb) / 255;
            if (w <= 0) continue;
            const local = jb === 1 ? view.getUint8(b + jc.offset + k) : view.getUint16(b + jc.offset + k * 2, true);
            const joint = chunks && c >= 0 ? chunks.bones[start + local]! : local;
            parts.push(`${joint}:${w.toFixed(2)}`);
        }
        out.push({ x: view.getFloat32(b, true), influences: parts.sort().join(',') });
    }
    return out;
}

describe('buildSkinnedMesh', () => {
    it('a skin one draw can pose stays one chunk, its joints a byte and its weights a byte summing to 255', () => {
        const source = strip(10, 40);
        const { mesh, report } = buildSkinnedMesh(source);
        expect(report.chunks).toBe(1);
        expect(mesh.skinChunks).toBeUndefined();
        expect(mesh.channels.find((c) => c.semantic === MeshChannel.Joints)!.type).toBe(MeshChannelType.UInt8);
        expect(mesh.channels.find((c) => c.semantic === MeshChannel.Weights)!.type).toBe(MeshChannelType.UNorm8);
        // Position (12) + joints (4) + weights (4): what was 12 + 8 + 16.
        expect(mesh.vertexStride).toBe(20);
        const view = new DataView(mesh.vertices.buffer);
        const wc = mesh.channels.find((c) => c.semantic === MeshChannel.Weights)!;
        for (let v = 0; v < mesh.vertexCount; v++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) sum += view.getUint8(v * mesh.vertexStride + wc.offset + k);
            expect(sum).toBe(255);
        }
        expect(skinnedCorners(mesh)).toEqual(skinnedCorners(source));
    });

    it('a skin past one draw is split into chunks no bigger than the budget, every vertex moved as before', () => {
        const source = strip(600, 400);
        const { mesh, report } = buildSkinnedMesh(source, { maxBonesPerChunk: 256 });
        expect(report.chunks).toBeGreaterThan(1);
        expect(report.maxBonesInChunk).toBeLessThanOrEqual(256);
        expect([...mesh.skinChunks!.boneCounts].every((n) => n <= 256)).toBe(true);
        expect(report.duplicatedVertices).toBeGreaterThan(0);
        expect(skinnedCorners(mesh)).toEqual(skinnedCorners(source));
        // The file keeps the chunks.
        const back = decodeMesh(encodeMesh(mesh));
        expect([...back.skinChunks!.ranges]).toEqual([...mesh.skinChunks!.ranges]);
        expect([...back.skinChunks!.bones]).toEqual([...mesh.skinChunks!.bones]);
        expect(skinnedCorners(back)).toEqual(skinnedCorners(source));
    });

    it('a chunked mesh is chunked again for a smaller budget, from the joints its chunks name', () => {
        const source = strip(600, 400);
        const first = buildSkinnedMesh(source, { maxBonesPerChunk: 256 }).mesh;
        const { mesh, report } = buildSkinnedMesh(first, { maxBonesPerChunk: 75 });
        expect(report.maxBonesInChunk).toBeLessThanOrEqual(75);
        expect(skinnedCorners(mesh)).toEqual(skinnedCorners(source));
    });

    it('the influence limit keeps the heaviest joints and makes the weights whole again', () => {
        const source = strip(4, 10);
        const { mesh, report } = buildSkinnedMesh(source, { influenceLimit: 1 });
        expect(report.limitedVertices).toBe(source.vertexCount);
        for (const corner of skinnedCorners(mesh)) expect(corner.influences).toMatch(/^\d+:1\.00$/);
    });

    it('high precision weights are 16 bits', () => {
        const { mesh } = buildSkinnedMesh(strip(4, 10), { highPrecisionWeights: true });
        expect(mesh.channels.find((c) => c.semantic === MeshChannel.Weights)!.type).toBe(MeshChannelType.UNorm16);
        expect(skinnedCorners(mesh)).toEqual(skinnedCorners(strip(4, 10)));
    });

    it("a morph target's deltas follow a vertex written into two chunks", () => {
        const source = strip(300, 300, true);
        const { mesh } = buildSkinnedMesh(source, { maxBonesPerChunk: 64 });
        const view = new DataView(mesh.vertices.buffer);
        for (let v = 0; v < mesh.vertexCount; v++) {
            const x = view.getFloat32(v * mesh.vertexStride, true);
            expect(mesh.morph!.deltas[v * 3]).toBe(x * 3);
        }
    });

    it('an export for a smaller bone budget re-splits the file, and leaves one that already fits alone', () => {
        const source = strip(600, 400);
        const bytes = encodeMesh(buildSkinnedMesh(source).mesh);
        expect(fitSkinToBudget(bytes, 256)).toBeNull();
        const fitted = decodeMesh(fitSkinToBudget(bytes, 75)!);
        expect(Math.max(...fitted.skinChunks!.boneCounts)).toBeLessThanOrEqual(75);
        expect(skinnedCorners(fitted)).toEqual(skinnedCorners(source));
    });

    it('a mesh that is not skinned comes back as it was', () => {
        const { channels, vertexStride } = packChannels([{ semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 }]);
        const plain: MeshData = { channels, vertexStride, vertexCount: 3, vertices: new Uint8Array(36), indices: Uint32Array.from([0, 1, 2]), aabbMin: [0, 0, 0], aabbMax: [1, 1, 1] };
        expect(buildSkinnedMesh(plain).mesh).toBe(plain);
    });
});
