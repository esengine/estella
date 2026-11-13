// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Foliage's density map: how many of the plants stand where, the same whichever cell or thread asks.
 */
import { describe, expect, it } from 'vitest';
import { buildFoliageCell, cellGround, densityAt, plantsSized, type CellSurroundings, type DensityMap, type FoliageCellSpec } from '../src/foliage/cellBuild';
import { readsTextureAsNumbers } from '../src/asset/textureUse';

const map = (values: number[], width: number, height: number): DensityMap =>
    ({ width, height, values: new Uint8Array(values), originX: -50, originZ: -50, sizeX: 100, sizeZ: 100 });
const spec = { seed: 3, zonePadding: 0, tags: ['foliage'], waterDepth: 0 } as unknown as FoliageCellSpec;
const around = (density: DensityMap | null): CellSurroundings => ({ ground: null, flatY: 7, water: null, zones: null, density });
const standing = (density: DensityMap | null, from = -50, to = 50): number => {
    const ground = cellGround(spec, around(density));
    let n = 0;
    for (let i = 0; i < 4000; i++) {
        const x = from + ((i * 0.6180339887) % 1) * (to - from), z = -50 + ((i * 0.7548776662) % 1) * 100;
        if (ground(x, z)) n++;
    }
    return n / 4000;
};

describe('a density map', () => {
    it('is read by where a place is on the area, blended between texels, and is nothing off it', () => {
        const m = map([0, 255], 2, 1);
        expect(densityAt(m, -50, 0)).toBeCloseTo(0, 6);
        expect(densityAt(m, 50, 0)).toBeCloseTo(1, 6);
        expect(densityAt(m, 0, 0)).toBeCloseTo(0.5, 6);
        expect(densityAt(m, 51, 0)).toBe(0);
        expect(densityAt(m, 0, -50.5)).toBe(0);
    });

    it('lets every plant stand where it is white, none where it is black, and its share between', () => {
        expect(standing(null)).toBe(1);
        expect(standing(map([255], 1, 1))).toBe(1);
        expect(standing(map([0], 1, 1))).toBe(0);
        expect(standing(map([128], 1, 1))).toBeGreaterThan(0.44);
        expect(standing(map([128], 1, 1))).toBeLessThan(0.56);
        // Black on the left, white on the right: the plants are on the right.
        const split = map([0, 0, 255, 255], 4, 1);
        expect(standing(split, -50, -20)).toBe(0);
        expect(standing(split, 20, 50)).toBe(1);
    });

    it('thins the same plants whichever cell asks: a place keeps its own lot', () => {
        const half = map([128], 1, 1);
        const a = cellGround({ ...spec, cellKey: 1 } as FoliageCellSpec, around(half)), b = cellGround({ ...spec, cellKey: 9 } as FoliageCellSpec, around(half));
        for (let i = 0; i < 200; i++) {
            const x = -40 + i * 0.37, z = 12 - i * 0.21;
            expect(a(x, z) === null).toBe(b(x, z) === null);
        }
        // Another seed is another field's plants.
        const other = cellGround({ ...spec, seed: 4 } as FoliageCellSpec, around(half));
        let differs = 0;
        for (let i = 0; i < 200; i++) if ((a(-40 + i * 0.37, 3) === null) !== (other(-40 + i * 0.37, 3) === null)) differs++;
        expect(differs).toBeGreaterThan(40);
    });

    it('is numbers: a Foliage\'s density map is imported as Data', () => {
        expect(readsTextureAsNumbers('Foliage', 'densityMap')).toBe(true);
        expect(readsTextureAsNumbers('Foliage', 'colorMap')).toBe(false);
    });
});

describe('a scale map', () => {
    const map = (values: number[]): DensityMap => ({ width: 2, height: 1, values: new Uint8Array(values), originX: -10, originZ: -10, sizeX: 20, sizeZ: 20 });
    const plants = [-6, -2, 2, 6].map((x) => ({ x, y: 0, z: 0, yaw: 0, scale: 2, phase: 0.5, shade: 1 }));

    it('makes a plant as large as the map says where it stands, and leaves its place and its turn alone', () => {
        // black on the west, white on the east, read between them
        const sized = plantsSized(plants, map([0, 255]), 0, 0);
        expect(sized.map((p) => p.x)).toEqual([-2, 2, 6]);
        expect(sized[0]!.scale).toBeGreaterThan(0.3);
        expect(sized[0]!.scale).toBeLessThan(sized[1]!.scale);
        expect(sized[2]!.scale).toBeCloseTo(2, 5);
        for (const p of sized) expect([p.yaw, p.phase, p.z]).toEqual([0, 0.5, 0]);
    });

    it('takes a plant it leaves almost nothing of away, and is measured in the world, not in the cell', () => {
        expect(plantsSized(plants, map([0, 0]), 0, 0)).toHaveLength(0);
        expect(plantsSized(plants, map([255, 255]), 0, 0)).toHaveLength(4);
        // the same plants in a cell far to the east all stand on the white half, and in one far to the west on the black
        const wide: DensityMap = { width: 2, height: 1, values: new Uint8Array([0, 255]), originX: -40, originZ: -40, sizeX: 80, sizeZ: 80 };
        expect(plantsSized(plants, wide, 30, 0).map((p) => p.scale)).toEqual([2, 2, 2, 2]);
        expect(plantsSized(plants, wide, -30, 0)).toHaveLength(0);
    });

    it('is numbers, as the density map is, and a cell built with one has smaller grass where it is dark', () => {
        expect(readsTextureAsNumbers('Foliage', 'scaleMap')).toBe(true);
        const spec: FoliageCellSpec = { centerX: 0, centerZ: 0, size: 10, count: 400, seed: 5, cellKey: 7, minScale: 1, maxScale: 1, minUp: 0, heightMin: -10, heightMax: 10,
            waterDepth: 0, zonePadding: 0, tags: ['foliage', 'grass'], baseY: 0, paint: null, far: { levels: 1, keep: 0.5, grow: 2, cards: false, only: 0 },
            look: { kind: 'grass', bladeHeight: 1, bladeWidth: 0.1 } };
        const flat = { ground: null, flatY: 0, water: null, zones: null };
        const full = buildFoliageCell(spec, flat, null)[0]!;
        const half = buildFoliageCell(spec, { ...flat, scale: { width: 1, height: 1, values: new Uint8Array([128]), originX: -10, originZ: -10, sizeX: 20, sizeZ: 20 } }, null)[0]!;
        expect(half.vertexCount).toBe(full.vertexCount);
        expect(half.aabbMax[1]).toBeCloseTo(full.aabbMax[1] * (128 / 255), 2);
    });
});
