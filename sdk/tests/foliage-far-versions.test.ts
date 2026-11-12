// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Foliage cell's far versions: the same plants, fewer and larger, chosen by each plant's own number so the version that takes
 *        over at a distance holds exactly the plants the shader still draws there.
 */
import { describe, expect, it } from 'vitest';
import { buildInstancedMesh, rankedPlants, type Plant } from '../src/foliage/builder';
import { buildFoliageCell, type CellSurroundings, type FoliageCellSpec } from '../src/foliage/cellBuild';
import { MeshChannel, MeshChannelType, packChannels } from '../src/asset/meshFormat';
import type { MeshData } from '../src/asset/meshFormat';

const plants: Plant[] = Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0, z: 0, yaw: 0, scale: 1, phase: ((i * 0.6180339887) % 1), shade: 1 }));
const around: CellSurroundings = { ground: null, flatY: 0, water: null, zones: null };
const spec = (far: FoliageCellSpec['far']): FoliageCellSpec => ({
    centerX: 0, centerZ: 0, size: 10, count: 600, seed: 5, cellKey: 7, minScale: 1, maxScale: 1, minUp: 0, heightMin: -10, heightMax: 10,
    waterDepth: 0, zonePadding: 0, tags: ['foliage', 'grass'], baseY: 0, paint: null, far, look: { kind: 'grass', bladeHeight: 1, bladeWidth: 0.1 },
});
/** One triangle of a plant: 0.1 wide along x, 0.2 along z, 1 tall. */
const STALK: MeshData = (() => {
    const { channels, vertexStride } = packChannels([
        { semantic: MeshChannel.Position, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.Normal, components: 3, type: MeshChannelType.Float32 },
        { semantic: MeshChannel.TexCoord0, components: 2, type: MeshChannelType.Float32 },
    ]);
    const vertices = new Uint8Array(3 * vertexStride), view = new DataView(vertices.buffer);
    const at = channels.find((c) => c.semantic === MeshChannel.Position)!.offset, normal = channels.find((c) => c.semantic === MeshChannel.Normal)!.offset;
    [[0.1, 0, 0], [0, 1, 0], [0, 0, 0.2]].forEach((p, i) => {
        p.forEach((v, k) => view.setFloat32(i * vertexStride + at + k * 4, v, true));
        view.setFloat32(i * vertexStride + normal + 4, 1, true);
    });
    return { channels, vertexStride, vertexCount: 3, vertices, indices: new Uint32Array([0, 1, 2]), aabbMin: [0, 0, 0], aabbMax: [0.1, 1, 0.2] };
})();
const alphaOf = (mesh: MeshData): number => mesh.vertices[mesh.channels.find((c) => c.semantic === MeshChannel.Color)!.offset + 3]!;

describe('the plants a far version keeps', () => {
    it('are those whose own number is under the share, with the slack the switch needs, each grown to cover what was left out', () => {
        const half = rankedPlants(plants, 0.5, 4, 1);
        expect(half.length).toBeGreaterThan(470);
        expect(half.length).toBeLessThan(530);
        for (const p of half) expect(plants[p.x]!.phase).toBeLessThan(0.5);
        // Across the ground only: a clump of flowers is no taller than a flower.
        expect(half[0]!.scale).toBe(1);
        expect(half[0]!.spread).toBeCloseTo(Math.SQRT2, 9);
        // With slack, a few more: none of them a plant the share itself would not reach by a quarter.
        const slack = rankedPlants(plants, 0.5, 4);
        expect(slack.length).toBeGreaterThan(half.length);
        for (const p of slack) expect(plants[p.x]!.phase).toBeLessThan(0.625);
    });

    it('are a part of what the version before it kept: nothing comes back further out', () => {
        const a = new Set(rankedPlants(plants, 0.5, 4).map((p) => p.x)), b = rankedPlants(plants, 0.25, 4);
        for (const p of b) expect(a.has(p.x)).toBe(true);
        expect(rankedPlants(plants, 1, 4)).toBe(plants);
    });

    it('are grown no more than the most allowed', () => {
        expect(rankedPlants(plants, 0.01, 3)[0]!.spread).toBe(3);
        expect(rankedPlants(plants, 0.25, 1)[0]!.spread).toBe(1);
    });

    it('give their height the share of the growth asked, and the ground they cover is the same whatever that share', () => {
        const every = rankedPlants(plants, 0.25, 4, 1, 1)[0]!, half = rankedPlants(plants, 0.25, 4, 1, 0.5)[0]!;
        expect([every.scale, every.spread]).toEqual([2, 1]);
        expect(half.scale).toBeCloseTo(1.5, 9);
        expect(half.scale * half.spread!).toBeCloseTo(2, 9);
    });

    it('are drawn as wide as they have grown and as tall as they were', () => {
        const stalk = buildInstancedMesh(STALK, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, phase: 0, shade: 0 }]);
        const grown = buildInstancedMesh(STALK, [{ x: 0, y: 0, z: 0, yaw: 0, scale: 1, spread: 3, phase: 0, shade: 0 }]);
        expect(grown.aabbMax[1]).toBeCloseTo(stalk.aabbMax[1], 6);
        expect(grown.aabbMax[0]).toBeCloseTo(stalk.aabbMax[0] * 3, 6);
        expect(grown.aabbMax[2]).toBeCloseTo(stalk.aabbMax[2] * 3, 6);
    });
});

describe('a cell of grass', () => {
    it('holds its near version and each far one, fewer blades in each, where one entity picks among them', () => {
        const meshes = buildFoliageCell(spec({ levels: 3, keep: 0.5, grow: 4, cards: false }), around, null);
        expect(meshes).toHaveLength(4);
        for (let i = 1; i < meshes.length; i++) expect(meshes[i]!.indices.length).toBeLessThan(meshes[i - 1]!.indices.length);
        // No band: a version drawn by a LODGroup is drawn wherever it is picked.
        for (const m of meshes) expect(alphaOf(m)).toBe(255);
    });

    it('is one version alone, marked with its band, where each version is a layer of its own', () => {
        const far = { levels: 3, keep: 0.5, grow: 4, cards: false };
        const all = buildFoliageCell(spec(far), around, null);
        for (let level = 0; level <= 3; level++) {
            const one = buildFoliageCell(spec({ ...far, only: level }), around, null);
            expect(one).toHaveLength(1);
            expect(one[0]!.vertexCount).toBe(all[level]!.vertexCount);
            expect(alphaOf(one[0]!)).toBe([0, 85, 170, 255][level]);
        }
    });

    it('leaves a blade its own width where each version is a layer: the shader widens them all, at every distance, as they thin', () => {
        const far = { levels: 2, keep: 0.25, grow: 4, cards: false };
        const rootWidth = (mesh: MeshData): number => {
            const at = mesh.channels.find((c) => c.semantic === MeshChannel.Position)!.offset;
            const view = new DataView(mesh.vertices.buffer, mesh.vertices.byteOffset);
            const x = (v: number, k: number): number => view.getFloat32(v * mesh.vertexStride + at + k * 4, true);
            return Math.hypot(x(1, 0) - x(0, 0), x(1, 2) - x(0, 2));
        };
        expect(rootWidth(buildFoliageCell(spec({ ...far, only: 2 }), around, null)[0]!)).toBeCloseTo(0.1, 5);
        // Picked by a LODGroup, with no shader to widen it, a far blade is made wider once: by the root of what it stands for.
        expect(rootWidth(buildFoliageCell(spec(far), around, null)[2]!)).toBeCloseTo(0.4, 5);
    });

    it('has no far version past the last plant, and none at all where nothing grows', () => {
        const few = { ...spec({ levels: 3, keep: 0.1, grow: 4, cards: false }), count: 6 };
        const meshes = buildFoliageCell(few, around, null);
        expect(meshes.length).toBeGreaterThanOrEqual(1);
        expect(meshes.length).toBeLessThan(4);
        expect(buildFoliageCell({ ...few, far: { ...few.far, only: 3 } }, around, null)).toEqual([]);
        expect(buildFoliageCell({ ...few, heightMin: 5 }, around, null)).toEqual([]);
    });
});
