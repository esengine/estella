// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Foliage's density map: how many of the plants stand where, the same whichever cell or thread asks.
 */
import { describe, expect, it } from 'vitest';
import { cellGround, densityAt, type CellSurroundings, type DensityMap, type FoliageCellSpec } from '../src/foliage/cellBuild';
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
