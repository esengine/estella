// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A custom body of water is the shape of its mesh seen from above: an L is an L and not the square round it, a seam split for
 *        texture coordinates is not a rim, and the water stands at the mesh's top.
 */
import { describe, expect, it } from 'vitest';
import { Footprint } from '../src/water/footprint';
import { WaterField, type ZoneGrid, type ZoneLake } from '../src/water/zone';

/** Unit squares on the xz plane at height `y`, each its own four corners (split, as a mesh with texture coordinates is), two triangles each. */
function squares(cells: Array<[number, number]>, y = 0): { xyz: number[]; indices: number[] } {
    const xyz: number[] = [], indices: number[] = [];
    for (const [i, j] of cells) {
        const v = xyz.length / 3;
        xyz.push(i, y, j, i + 1, y, j, i + 1, y, j + 1, i, y, j + 1);
        indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    return { xyz, indices };
}

// An L three squares on a side: the square at (1..3, 1..3) is its notch.
const L = squares([[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]].flatMap(([i, j]) => [[i! * 2, j! * 2], [i! * 2 + 1, j! * 2], [i! * 2, j! * 2 + 1], [i! * 2 + 1, j! * 2 + 1]] as Array<[number, number]>), 3);

describe('a mesh seen from above', () => {
    const shape = Footprint.of(L.xyz, L.indices)!;

    it('is the shape of its triangles, not the hull round them', () => {
        expect(shape.contains(1, 1)).toBe(true);
        expect(shape.contains(5, 1)).toBe(true);
        expect(shape.contains(1, 5)).toBe(true);
        expect(shape.contains(4, 4)).toBe(false);
        expect(shape.sdf(4, 4)).toBeLessThan(0);
        expect(shape.hull.length).toBeGreaterThanOrEqual(3);
    });

    it('measures from its rim only: a seam between squares split for texture coordinates is inside, not an edge', () => {
        // (1, 1) is on the corner of four split squares, a unit in from the rim at x = 0 and z = 0.
        expect(shape.sdf(1, 1)).toBeCloseTo(1, 6);
        expect(shape.sdf(3, 1)).toBeCloseTo(1, 6);
        expect(shape.sdf(-0.5, 1)).toBeCloseTo(-0.5, 6);
    });

    it('stands its water at the mesh\'s top', () => {
        expect(shape.top).toBe(3);
    });

    it('takes its shape from what faces up: a closed box seen from above is its lid, not its lid and floor laid one on the other', () => {
        // A 4-unit box: a lid at 2 wound to face up, a floor at 0 wound to face down; their rims coincide from above.
        const xyz = [0, 2, 0, 0, 2, 4, 4, 2, 4, 4, 2, 0, 0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4];
        const box = Footprint.of(xyz, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])!;
        expect(box.sdf(2, 2)).toBeCloseTo(2, 6);
        expect(box.sdf(5, 2)).toBeCloseTo(-1, 6);
        expect(box.top).toBe(2);
    });

    it('has no shape without triangles', () => {
        expect(Footprint.of([0, 0, 0, 1, 0, 0], [])).toBeNull();
    });
});

describe('a custom body baked into the zone', () => {
    it('is water over its mesh and dry in the notch of the L, which the hull would have flooded', () => {
        const shape = Footprint.of(L.xyz, L.indices)!;
        const grid: ZoneGrid = { minX: -4, minZ: -4, sizeX: 14, sizeZ: 14, nx: 141, nz: 141 };
        const body: ZoneLake = {
            kind: 'lake', key: 5, level: shape.top, waveHeight: 0, shoreWidth: 0, outline: shape.hull,
            toLocal: (x, z) => [x, z], toWorld: (x, z) => [x, z], inside: (x, z) => shape.sdf(x, z),
        };
        const field = WaterField.bake(grid, [body], () => -10);
        expect(field.sample(1, 1)?.key).toBe(5);
        expect(field.sample(5, 1)?.key).toBe(5);
        expect(field.sample(1, 5)?.key).toBe(5);
        expect(field.sample(1, 1)!.height).toBeCloseTo(3, 3);
        expect(field.sample(4.5, 4.5)).toBeNull();
    });
});
