// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { WaterField, WaterZone } from '../src/water/zone';
import {
    buildWaterTiles,
    selectWaterTiles,
    waterCoverage,
    waterMaterialMeshes,
    waterTileLayout,
    waterViewPlanes,
} from '../src/water/waterTiles';

const settings = { ...WaterZone._default, tileSize: 10, extentInTiles: { x: 7, y: 5 }, tessellationFactor: 2, lodScale: 1 };
const layout = waterTileLayout(settings);
const wet = () => 'wet' as const;
const eye: [number, number, number] = [42, 0, 55];

describe('water zone tiles', () => {
    it('covers the exact rectangular extents and stitches every interior triangle edge at mixed densities', () => {
        const tiles = selectWaterTiles(layout, 0, 0, eye, 0, 0, wet);
        expect(new Set(tiles.map((t) => t.level)).size).toBeGreaterThan(1);
        expect(tiles.reduce((sum, t) => sum + 4 ** t.level, 0)).toBe(14 * 10);
        const mesh = buildWaterTiles(layout, tiles, false, false);
        const bytes = new DataView(mesh.vertices.buffer),
            edges = new Map<string, number>();
        const pos = (id: number) => [
            bytes.getFloat32(id * mesh.vertexStride, true),
            bytes.getFloat32(id * mesh.vertexStride + 8, true),
        ];
        let area = 0;
        for (let i = 0; i < mesh.indices.length; i += 3) {
            const ids = Array.from(mesh.indices.slice(i, i + 3)),
                [a, b, c] = ids.map(pos);
            const cross = (b![1]! - a![1]!) * (c![0]! - a![0]!) - (b![0]! - a![0]!) * (c![1]! - a![1]!);
            expect(cross).toBeGreaterThan(0);
            area += cross / 2;
            for (let j = 0; j < 3; j++) {
                const x = ids[j]!,
                    y = ids[(j + 1) % 3]!,
                    key = [Math.min(x, y), Math.max(x, y)].join(',');
                edges.set(key, (edges.get(key) ?? 0) + 1);
            }
        }
        expect(area).toBeCloseTo(140 * 100);
        for (const [edge, count] of edges)
            if (count !== 2) {
                const [a, b] = edge.split(',').map((v) => pos(Number(v)));
                expect(count).toBe(1);
                expect(
                    (a![0] === b![0] && (a![0] === 0 || a![0] === 140)) ||
                        (a![1] === b![1] && (a![1] === 0 || a![1] === 100)),
                ).toBe(true);
            }
        const batches = waterMaterialMeshes(mesh, (x, z) => (x > 80 ? 2 : z > 55 ? 1 : 0));
        expect(batches.size).toBe(3);
        expect([...batches.values()].reduce((sum, m) => sum + m.indices.length, 0)).toBe(mesh.indices.length);
    });

    it('changes density independently from tile extents and rejects cells outside the view or the water', () => {
        const tiles = selectWaterTiles(layout, 0, 0, eye, 0, 0, wet);
        const fine = waterTileLayout({ ...settings, tessellationFactor: 3 });
        expect(selectWaterTiles(fine, 0, 0, eye, 0, 0, wet)).toEqual(tiles);
        expect(buildWaterTiles(fine, tiles, false, false).indices.length).toBeGreaterThan(
            3 * buildWaterTiles(layout, tiles, false, false).indices.length,
        );
        const more = selectWaterTiles({ ...layout, lodScale: 3 }, 0, 0, eye, 0, 0, wet);
        expect(more.length).toBeGreaterThan(tiles.length);
        const planes = waterViewPlanes(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
        expect(selectWaterTiles(layout, 10, 10, eye, 0, 0, wet, planes)).toHaveLength(0);
        const field = WaterField.bake({ minX: 0, minZ: 0, sizeX: 140, sizeZ: 100, nx: 71, nz: 51 }, [
            {
                kind: 'lake',
                key: 1,
                level: 0,
                waveHeight: 1,
                shoreWidth: 0,
                toLocal: (x, z) => [x, z],
                toWorld: (x, z) => [x, z],
                outline: [
                    { x: 30, y: 20 },
                    { x: 50, y: 20 },
                    { x: 50, y: 50 },
                    { x: 30, y: 50 },
                ],
            },
        ]);
        const mask = waterCoverage(field, 0);
        expect(mask(5, 60, 10)).toBe('dry');
        expect(mask(35, 25, 8)).toBe('wet');
        const shore = selectWaterTiles(layout, 0, 0, eye, 0, 0, mask);
        expect(shore.length).toBeGreaterThan(0);
        expect(shore.every((t) => t.x < 6 && t.z < 6)).toBe(true);
    });
});
