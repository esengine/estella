// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { riverBedModifiers } from '../src/water/riverBed';
import type { RiverStation } from '../src/water/zone';

/** A straight river along x at z = 0, its surface at 10, 20 wide, a station every 4. */
const stations: RiverStation[] = Array.from({ length: 101 }, (_, i) => ({ x: i * 4, z: 0, y: 10, half: 10, dx: 1, dz: 0, speed: 1 }));
const mods = riverBedModifiers('bed:', stations, 3);
const ground = (x: number, z: number, h: number): number => {
    for (const m of mods) {
        const [x0, z0, x1, z1] = m.bounds;
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) h = m.apply(x, z, h);
    }
    return h;
};

describe('riverBedModifiers', () => {
    it('cuts a trough depth under the surface at the middle and at the surface at the edge', () => {
        expect(ground(200, 0, 12)).toBeCloseTo(7, 5);
        expect(ground(200, 10, 12)).toBeCloseTo(10, 5);
        expect(ground(200, 5, 12)).toBeCloseTo(10 - 3 * 0.75, 5);
    });

    it('gives the ground back across its banks, smoothly, and leaves lower ground alone', () => {
        expect(ground(200, 40, 12)).toBe(12);
        let prev = ground(200, 0, 12);
        for (let z = 0.5; z <= 30; z += 0.5) {
            const h = ground(200, z, 12);
            expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
            expect(h - prev).toBeLessThan(0.5);
            prev = h;
        }
        expect(ground(200, 0, 5)).toBe(5);
    });

    it('rolls over where its bank meets the ground instead of folding, so the cells of a terrain draw no saw along it, and keeps its waterline', () => {
        // Ground 10 over the river: the bank (slope 2 x depth / half = 0.6) meets it 16.7 out from the edge. Its slope there turns
        // gradually, not at once: no step between two neighbouring samples' slopes is more than a share of the whole turn.
        const step = 0.25;
        let worst = 0;
        for (let z = 10; z < 40; z += step) {
            const a = ground(200, z - step, 20), b = ground(200, z, 20), c = ground(200, z + step, 20);
            worst = Math.max(worst, Math.abs((c - b) - (b - a)) / step);
        }
        expect(worst).toBeLessThan(0.6 * 0.1);
        // Never under the surface where the ground stood over it: the waterline stays at the edge.
        for (let z = 10; z < 40; z += 0.5) expect(ground(200, z, 10.5)).toBeGreaterThanOrEqual(10 - 1e-9);
    });

    it('is laid as stretches, each bounded round its own', () => {
        expect(mods.length).toBe(Math.ceil(100 / 24));
        expect(new Set(mods.map((m) => m.id)).size).toBe(mods.length);
        expect(mods[0]!.bounds[2]).toBeLessThan(400);
        expect(riverBedModifiers('x', stations, 0)).toEqual([]);
    });
});
