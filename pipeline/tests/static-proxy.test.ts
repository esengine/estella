// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    static-proxy.test.ts
 * @brief   Verify static proxy placement, draw boundaries, error budgets and reproducibility.
 */
import { describe, expect, it } from 'vitest';
import { builtinMeshTemplate, composeTRS, encodeMesh, MeshChannel, type MeshData } from 'esengine';
import { bakeStaticProxy, type StaticProxySource } from '../src/world/staticProxy';

const cube = builtinMeshTemplate('builtin:cube')!.build();
const sphere = builtinMeshTemplate('builtin:sphere')!.build();
const placed = (entity: number, x = 0, scale = 1, mesh: MeshData = cube): StaticProxySource => ({
    entity, mesh, world: composeTRS({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, { x: scale, y: scale, z: scale }),
    state: { material: 1, texture: 0, normalMap: 0, color: { r: 1, g: 1, b: 1, a: 1 },
        layer: 0, cullBackfaces: true, lit: true, castShadows: true, parallax: { x: 1, y: 1 }, group: '' },
    motion: 'static', blended: false,
});
const options = { origin: [0, 0, 0] as const, ratio: 0.15, maxWorldError: 0.5 };

describe('bakeStaticProxy', () => {
    it('bakes translated and mirrored parts relative to the cluster origin without changing sources', async () => {
        const a = placed(2, 1010), b = placed(1, 1020, -2);
        const before = encodeMesh(cube).slice();
        const result = await bakeStaticProxy([a, b], { ...options, origin: [1000, 0, 0], ratio: 1 });
        expect(result.groups).toHaveLength(1);
        const group = result.groups[0]!;
        expect(group.sources).toEqual([1, 2]);
        expect(group.mesh.aabbMin).toEqual([-80, -100, -100]);
        expect(group.mesh.aabbMax).toEqual([120, 100, 100]);
        expect(group.mesh.indices.length).toBe(cube.indices.length * 2);
        expect(encodeMesh(cube)).toEqual(before);
        expect(a.world[12]).toBe(1010);
        expect(result.origin).toEqual([1000, 0, 0]);
    });

    it.each(['material', 'texture', 'normalMap', 'layer', 'castShadows', 'lit', 'cullBackfaces', 'color', 'parallax', 'group'] as const)(
        'keeps %s differences in separate draw groups', async field => {
            const a = placed(1), b = placed(2, 100);
            const changed = { material: 2, texture: 2, normalMap: 2, layer: 2, castShadows: false,
                lit: false, cullBackfaces: false, color: { r: 1, g: 0, b: 0, a: 1 }, parallax: { x: 2, y: 1 }, group: 'other' };
            Object.assign(b.state, { [field]: changed[field] });
            const result = await bakeStaticProxy([a, b], { ...options, ratio: 1 });
            expect(result.groups).toHaveLength(2);
        },
    );

    it('uses an absolute error budget even for a cluster with widely separated parts', async () => {
        const result = await bakeStaticProxy([placed(1, 0, 1, sphere), placed(2, 50000, 2, sphere)], options);
        expect(result.groups).toHaveLength(1);
        const group = result.groups[0]!;
        expect(group.trianglesAfter).toBeLessThan(group.trianglesBefore);
        expect(group.worldError).toBeLessThanOrEqual(options.maxWorldError + 1e-5);
        const data = group.mesh, position = data.channels.find(c => c.semantic === MeshChannel.Position)!;
        const view = new DataView(data.vertices.buffer, data.vertices.byteOffset, data.vertices.byteLength);
        let left = 0, right = 0;
        for (const index of data.indices) {
            const x = view.getFloat32(index * data.vertexStride + position.offset, true);
            if (x < 1000) left++; else right++;
        }
        expect(left).toBeGreaterThan(12);
        expect(right).toBeGreaterThan(12);
    });

    it('reports surfaces that cannot be represented by fixed merged geometry', async () => {
        const sources = Array.from({ length: 8 }, (_, i) => placed(i));
        sources[0]!.motion = 'dynamic'; sources[1]!.motion = 'deformed'; sources[2]!.motion = 'billboard';
        sources[3]!.blended = true; sources[4]!.baked = true; sources[5]!.enabled = false;
        sources[6]!.mesh = { ...cube, inverseBindMatrices: new Float32Array(16) };
        sources[7]!.mesh = { ...cube, morph: { names: ['shape'], hasNormals: false, deltas: new Float32Array(0) } };
        const result = await bakeStaticProxy(sources, options);
        expect(result.groups).toEqual([]);
        expect(result.refused.map(row => row.reason)).toEqual(['moves', 'deformed', 'billboard', 'blended', 'baked', 'disabled', 'skinned', 'morph']);
    });

    it('refuses nonfinite, singular and projective transforms', async () => {
        const sources = [placed(1, NaN), placed(2, 0, 0), placed(3)];
        const projective = Array.from(sources[2]!.world); projective[3] = 1; sources[2]!.world = projective;
        const result = await bakeStaticProxy(sources, options);
        expect(result.groups).toEqual([]);
        expect(result.refused.map(row => row.reason)).toEqual(['transform', 'transform', 'transform']);
    });

    it('keeps reproducible bytes and fingerprints regardless of collection order', async () => {
        const sources = [placed(7, 160), placed(2, -160), placed(4)];
        const first = await bakeStaticProxy(sources, options);
        const second = await bakeStaticProxy([...sources].reverse(), options);
        expect(second.groups.map(group => group.fingerprint)).toEqual(first.groups.map(group => group.fingerprint));
        expect(encodeMesh(second.groups[0]!.mesh)).toEqual(encodeMesh(first.groups[0]!.mesh));
        sources[0]!.state.castShadows = false;
        const changed = await bakeStaticProxy(sources, options);
        expect(changed.groups.map(group => group.fingerprint)).not.toEqual(first.groups.map(group => group.fingerprint));
    });

    it('splits groups at the vertex budget while simplifying singleton groups too', async () => {
        const result = await bakeStaticProxy([placed(1, 0, 1, sphere), placed(2, 300, 1, sphere)],
            { ...options, maxVertices: sphere.vertexCount });
        expect(result.groups).toHaveLength(2);
        expect(result.groups.every(group => group.trianglesAfter < group.trianglesBefore)).toBe(true);
    });

    it('retains protected geometry even when disconnected pruning is requested', async () => {
        const part = placed(1, 0, 1, sphere); part.preserveGeometry = true;
        const result = await bakeStaticProxy([part, placed(2, 200, 1, sphere)], { ...options, pruneDisconnected: true });
        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]!.preservedGeometry).toBe(true);
        expect(result.groups[0]!.trianglesAfter).toBe(result.groups[0]!.trianglesBefore);
        expect(result.groups[0]!.worldError).toBe(0);
    });

    it('rejects ambiguous source ownership and invalid budgets', async () => {
        await expect(bakeStaticProxy([placed(1), placed(1)], options)).rejects.toThrow('unique');
        await expect(bakeStaticProxy([placed(1)], { ...options, ratio: 0 })).rejects.toThrow('ratio');
        await expect(bakeStaticProxy([placed(1)], { ...options, maxWorldError: NaN })).rejects.toThrow('world error');
    });
});
