// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { MeshChannel, MeshChannelType, packChannels, type MeshData } from '../src/asset/meshFormat';
import {
    mergeMeshes, planStaticBatches, worldMatrix, layoutRefusal, staticBatchKey, channelSignature, STATIC_BATCH_DEFAULTS,
} from '../src/render/staticBatch';

const F = MeshChannelType.Float32;
const { channels, vertexStride } = packChannels([
    { semantic: MeshChannel.Position, components: 3, type: F },
    { semantic: MeshChannel.Normal, components: 3, type: F },
    { semantic: MeshChannel.TexCoord0, components: 2, type: F },
]);

/** A single triangle in the XY plane facing +Z. */
function triangle(): MeshData {
    const vertices = new Uint8Array(3 * vertexStride);
    const dv = new DataView(vertices.buffer);
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    corners.forEach((p, i) => {
        const at = i * vertexStride;
        p.forEach((v, k) => dv.setFloat32(at + channels[0]!.offset + k * 4, v, true));
        [0, 0, 1].forEach((v, k) => dv.setFloat32(at + channels[1]!.offset + k * 4, v, true));
        [i === 1 ? 1 : 0, i === 2 ? 1 : 0].forEach((v, k) => dv.setFloat32(at + channels[2]!.offset + k * 4, v, true));
    });
    return { channels, vertexStride, vertexCount: 3, vertices, indices: Uint32Array.of(0, 1, 2), aabbMin: [0, 0, 0], aabbMax: [1, 1, 0] };
}

const IDENT_Q = { x: 0, y: 0, z: 0, w: 1 };
const read = (m: MeshData, vertex: number, channel: number, k: number): number =>
    new DataView(m.vertices.buffer, m.vertices.byteOffset).getFloat32(vertex * m.vertexStride + m.channels[channel]!.offset + k * 4, true);

describe('mergeMeshes', () => {
    it('concatenates parts in world space and offsets their indices', () => {
        const a = { mesh: triangle(), world: worldMatrix({ x: 10, y: 0, z: 0 }, IDENT_Q, { x: 1, y: 1, z: 1 }) };
        const b = { mesh: triangle(), world: worldMatrix({ x: 0, y: 5, z: 0 }, IDENT_Q, { x: 2, y: 2, z: 2 }) };
        const merged = mergeMeshes([a, b]);
        expect(merged.vertexCount).toBe(6);
        expect(Array.from(merged.indices)).toEqual([0, 1, 2, 3, 4, 5]);
        expect([read(merged, 1, 0, 0), read(merged, 1, 0, 1)]).toEqual([11, 0]);
        expect([read(merged, 4, 0, 0), read(merged, 4, 0, 1)]).toEqual([2, 5]);
        expect(merged.aabbMin).toEqual([0, 0, 0]);
        expect(merged.aabbMax).toEqual([11, 7, 0]);
    });

    it('keeps UVs and leaves the source untouched', () => {
        const source = triangle();
        const before = Uint8Array.from(source.vertices);
        const merged = mergeMeshes([{ mesh: source, world: worldMatrix({ x: 3, y: 3, z: 3 }, IDENT_Q, { x: 1, y: 1, z: 1 }) }]);
        expect(read(merged, 1, 2, 0)).toBe(1);
        expect(Array.from(source.vertices)).toEqual(Array.from(before));
    });

    it('rotates normals with the part and unscales them under a non-uniform scale', () => {
        // 90 degrees about X: +Z becomes -Y.
        const s = Math.SQRT1_2;
        const rotated = mergeMeshes([{ mesh: triangle(), world: worldMatrix({ x: 0, y: 0, z: 0 }, { x: s, y: 0, z: 0, w: s }, { x: 1, y: 1, z: 1 }) }]);
        expect(read(rotated, 0, 1, 1)).toBeCloseTo(-1, 5);
        expect(read(rotated, 0, 1, 2)).toBeCloseTo(0, 5);
        // Stretching X must not tilt a +Z normal.
        const stretched = mergeMeshes([{ mesh: triangle(), world: worldMatrix({ x: 0, y: 0, z: 0 }, IDENT_Q, { x: 8, y: 1, z: 1 }) }]);
        expect(read(stretched, 0, 1, 2)).toBeCloseTo(1, 5);
        expect(read(stretched, 0, 1, 0)).toBeCloseTo(0, 5);
    });

    it('a mirrored part keeps facing the way it did: winding reverses, the normal stays outward', () => {
        const merged = mergeMeshes([{ mesh: triangle(), world: worldMatrix({ x: 0, y: 0, z: 0 }, IDENT_Q, { x: -1, y: 1, z: 1 }) }]);
        expect(Array.from(merged.indices)).toEqual([0, 2, 1]);
        // Mirroring X leaves a +Z normal pointing +Z.
        expect(read(merged, 0, 1, 2)).toBeCloseTo(1, 5);
    });

    it('refuses parts with different layouts rather than guessing', () => {
        const other = packChannels([{ semantic: MeshChannel.Position, components: 3, type: F }]);
        const flat: MeshData = {
            channels: other.channels, vertexStride: other.vertexStride, vertexCount: 1,
            vertices: new Uint8Array(other.vertexStride), indices: Uint32Array.of(0), aabbMin: [0, 0, 0], aabbMax: [0, 0, 0],
        };
        const w = worldMatrix({ x: 0, y: 0, z: 0 }, IDENT_Q, { x: 1, y: 1, z: 1 });
        expect(() => mergeMeshes([{ mesh: triangle(), world: w }, { mesh: flat, world: w }])).toThrow(/different vertex layouts/);
    });
});

describe('layoutRefusal', () => {
    it('accepts a plain float layout and names why it refuses the rest', () => {
        expect(layoutRefusal(triangle())).toBeNull();
        expect(layoutRefusal({ ...triangle(), inverseBindMatrices: new Float32Array(16) })).toBe('skinned');
        expect(layoutRefusal({ ...triangle(), morph: { names: ['a'], hasNormals: false, deltas: new Float32Array(9) } })).toBe('morph');
        const packed = packChannels([
            { semantic: MeshChannel.Position, components: 3, type: F },
            { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.UNorm8 },
        ]);
        expect(layoutRefusal({ ...triangle(), channels: packed.channels, vertexStride: packed.vertexStride })).toBe('layout');
    });
});

describe('planStaticBatches', () => {
    const state = { material: 1, texture: 2, normalMap: 0, color: { r: 1, g: 1, b: 1, a: 1 }, layer: 0, cullBackfaces: true, lit: true, castShadows: true, parallax: { x: 0, y: 0 }, group: '' };
    const layout = channelSignature(channels, vertexStride);
    const key = (over: Partial<typeof state> = {}) => staticBatchKey({ ...state, ...over }, layout);
    const at = (entity: number, x: number, k = key(), vertices = 100) => ({ entity, key: k, center: [x, 0, 0] as const, vertices });

    it('merges what shares a draw state and sits in one cell, and leaves a lone mesh alone', () => {
        const plan = planStaticBatches([at(1, 0), at(2, 100), at(3, 200), at(4, 100, key({ material: 9 }))]);
        expect(plan.batches.map((b) => b.entities)).toEqual([[1, 2, 3]]);
        expect(plan.alone).toEqual([4]);
    });

    it('keeps shadow casters separate from otherwise identical non-casters', () => {
        const plan = planStaticBatches([at(1, 0), at(2, 10), at(3, 20, key({ castShadows: false })), at(4, 30, key({ castShadows: false }))]);
        expect(plan.batches.map(batch => batch.entities).sort((a, b) => a[0]! - b[0]!)).toEqual([[1, 2], [3, 4]]);
    });

    it('preserves the default shadow policy when an older caller omits it', () => {
        const { castShadows: _, ...legacy } = state;
        expect(staticBatchKey(legacy, layout)).toBe(key());
    });

    it('keeps cells apart so culling still works, and caps a batch at the vertex limit', () => {
        const cell = STATIC_BATCH_DEFAULTS.cellSize;
        const far = planStaticBatches([at(1, 0), at(2, 10), at(3, cell * 3), at(4, cell * 3 + 10)]);
        expect(far.batches.map((b) => b.entities)).toEqual([[1, 2], [3, 4]]);
        const capped = planStaticBatches([at(1, 0, key(), 60), at(2, 1, key(), 60), at(3, 2, key(), 60), at(4, 3, key(), 60)], { cellSize: 1000, maxVertices: 130 });
        expect(capped.batches.map((b) => b.entities)).toEqual([[1, 2], [3, 4]]);
    });

    it('is deterministic whatever order candidates arrive in', () => {
        const list = [at(5, 0), at(2, 1), at(9, 2), at(1, 3)];
        expect(planStaticBatches([...list].reverse())).toEqual(planStaticBatches(list));
    });

    it('the author\'s group keeps otherwise identical meshes in separate batches', () => {
        const plan = planStaticBatches([at(1, 0, key({ group: 'a' })), at(2, 1, key({ group: 'a' })), at(3, 2, key({ group: 'b' })), at(4, 3, key({ group: 'b' }))]);
        expect(plan.batches.map((b) => b.entities)).toEqual([[1, 2], [3, 4]]);
    });
});
