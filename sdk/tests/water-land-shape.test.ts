// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a body of water does to the ground: a lake cuts its floor under its outline and only cuts; an island raises the ground inside
 *        its outline and eases back down outside it, and only raises.
 */
import { describe, expect, it } from 'vitest';
import { islandModifier, lakeFloorModifier, type OutlineSpace } from '../src/water/landShape';
import { ModifiedSource, type TerrainModifier, type TerrainSource } from '../src/terrain/source';

/** A square `half` either side of (cx, cz), its plane the world's, at `scale`. */
const square = (cx: number, cz: number, half: number, scale = 1): OutlineSpace => ({
    outline: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }],
    toLocal: (x, z) => [(x - cx) / scale, (z - cz) / scale],
    toWorld: (x, z) => [x * scale + cx, z * scale + cz],
    scale,
});

describe('a lake floor', () => {
    const floor = lakeFloorModifier('f', square(0, 0, 20), 2, 6, 10);

    it('is the depth under the surface from the ramp in, sloping up to the surface at the shore', () => {
        expect(floor.apply(0, 0, 5)).toBeCloseTo(-4, 6);
        expect(floor.apply(19.5, 0, 5)).toBeGreaterThan(-4);
        expect(floor.apply(19.5, 0, 5)).toBeLessThan(2);
        expect(floor.apply(5, 0, 5)).toBeCloseTo(-4, 6);
    });

    it('only cuts: ground already lower stays, and nothing outside the outline changes', () => {
        expect(floor.apply(0, 0, -10)).toBe(-10);
        expect(floor.apply(25, 0, 5)).toBe(5);
        expect(floor.bounds).toEqual([-20, -20, 20, 20]);
    });
});

describe('an island', () => {
    const island = islandModifier('i', square(0, 0, 20), 10, 8);

    it('raises the ground inside its outline to its top', () => {
        expect(island.apply(0, 0, -30)).toBe(10);
        expect(island.apply(19, 19, -30)).toBe(10);
    });

    it('eases back down to the ground over its falloff, and reaches no further', () => {
        const a = island.apply(22, 0, 0), b = island.apply(26, 0, 0);
        expect(a).toBeLessThan(10);
        expect(b).toBeLessThan(a);
        expect(b).toBeGreaterThan(0);
        expect(island.apply(28.5, 0, 0)).toBe(0);
        expect(island.bounds).toEqual([-28, -28, 28, 28]);
    });

    it('only raises: ground already higher stays', () => {
        expect(island.apply(0, 0, 40)).toBe(40);
        expect(island.apply(24, 0, 40)).toBe(40);
    });

    it('measures its falloff in world units on a scaled body', () => {
        const big = islandModifier('b', square(0, 0, 10, 2), 10, 8);
        expect(big.apply(19, 0, 0)).toBe(10);
        expect(big.apply(29, 0, 0)).toBe(0);
        expect(big.apply(24, 0, 0)).toBeGreaterThan(0);
    });
});

describe('the ground they are laid over', () => {
    it('grows its height range to what they make, so an island over the highest hill or a floor under the lowest valley is not cut off', () => {
        // Flat ground whose own range is a hundredth of a unit: what the terrain held every height to before.
        const flat: TerrainSource = { infinite: false, bounds: [-100, -100, 100, 100], minHeight: 0, maxHeight: 0.01,
            height: () => 0, normal: () => [0, 1, 0], paint: () => [1, 0, 0, 0] };
        const mods: TerrainModifier[] = [islandModifier('i', square(-50, 0, 10), 12, 5), lakeFloorModifier('l', square(50, 0, 20), 4, 6, 5)];
        const ground = new ModifiedSource(flat, () => mods, { x: 0, y: 0, z: 0 }, 1);
        expect(ground.height(-50, 0)).toBe(12);
        expect(ground.height(50, 0)).toBeCloseTo(-2, 6);
        expect(ground.minHeight).toBeCloseTo(-2, 6);
        expect(ground.maxHeight).toBe(12);
        mods.length = 0;
        expect(ground.maxHeight).toBe(0.01);
    });
});
