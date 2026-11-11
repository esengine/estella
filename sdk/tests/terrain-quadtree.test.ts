// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { levelRange, parentOf, selectNodes, type QuadtreeParams, type TerrainNode } from '../src/terrain/quadtree';
import { makePage, PageTable, PAGE_SIDE } from '../src/terrain/pages';
import { NoiseSource, noised } from '../src/terrain/source';

const area: QuadtreeParams = { leafSize: 32, levels: 5, range0: 80, bounds: [-256, -256, 256, 256], minHeight: 0, maxHeight: 50 };
const covers = (nodes: TerrainNode[], x: number, z: number): number =>
    nodes.filter((n) => x >= n.x0 && x < n.x0 + n.size && z >= n.z0 && z < n.z0 + n.size).length;

describe('the ground\'s quadtree', () => {
    it('covers every place in the area exactly once', () => {
        const nodes = selectNodes(area, 10, 20, -30);
        for (let x = -250; x < 256; x += 17) for (let z = -250; z < 256; z += 19) expect(covers(nodes, x, z)).toBe(1);
    });

    it('is finest at the eye and coarsens with distance', () => {
        const nodes = selectNodes(area, 0, 5, 0);
        const at = (x: number, z: number) => nodes.find((n) => x >= n.x0 && x < n.x0 + n.size && z >= n.z0 && z < n.z0 + n.size)!;
        expect(at(1, 1).level).toBe(0);
        expect(at(250, 250).level).toBeGreaterThan(at(60, 60).level);
    });

    it('never puts two nodes more than a level apart side by side, so the morph closes every seam', () => {
        const nodes = selectNodes(area, 40, 10, 70);
        for (const a of nodes) for (const b of nodes) {
            const touch = a.x0 <= b.x0 + b.size && b.x0 <= a.x0 + a.size && a.z0 <= b.z0 + b.size && b.z0 <= a.z0 + a.size;
            if (touch) expect(Math.abs(a.level - b.level)).toBeLessThanOrEqual(1);
        }
    });

    it('goes on round the eye for ground without end, as far as its top range', () => {
        const nodes = selectNodes({ ...area, bounds: null }, 5000, 10, -9000);
        expect(covers(nodes, 5000, -9000)).toBe(1);
        expect(covers(nodes, 5000 + levelRange(area, 4) * 0.9, -9000)).toBe(1);
        expect(nodes.every((n) => n.size === 32 * 2 ** n.level)).toBe(true);
    });

    it('finds a node\'s parent', () => {
        expect(parentOf({ level: 0, ix: 3, iz: -1, x0: 96, z0: -32, size: 32 }, 32)).toEqual({ level: 1, ix: 1, iz: -1, x0: 64, z0: -64, size: 64 });
    });
});

describe('ground without end', () => {
    const ground = new NoiseSource({ seed: 4, frequency: 3, octaves: 5, persistence: 0.5, ridged: 0.3, warp: 0.3, erosion: 1, sizeX: 1000, height: 200,
        rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 });

    it('is the same ground for the same seed anywhere, as far out as it is asked', () => {
        const a = ground.height(123456.5, -98765.25), b = new NoiseSource({ ...(ground as unknown as { p: object }).p } as ConstructorParameters<typeof NoiseSource>[0]).height(123456.5, -98765.25);
        expect(a).toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(200);
    });

    it('has a slope that is the derivative of its noise', () => {
        const e = 1e-4;
        for (const [x, y] of [[0.3, 0.7], [5.5, -3.2], [-12.1, 9.9]] as const) {
            const [, dx, dy] = noised(x, y, 7);
            expect(dx).toBeCloseTo((noised(x + e, y, 7)[0] - noised(x - e, y, 7)[0]) / (2 * e), 4);
            expect(dy).toBeCloseTo((noised(x, y + e, 7)[0] - noised(x, y - e, 7)[0]) / (2 * e), 4);
        }
    });
});

describe('the pages', () => {
    const ground = new NoiseSource({ seed: 2, frequency: 2, octaves: 4, persistence: 0.5, ridged: 0, warp: 0, erosion: 0, sizeX: 500, height: 100,
        rockSlope: 0.35, dirtHeight: 0.62, snowHeight: 0.88 });

    it('hold a node\'s heights to a 65535th of the ground\'s range, with a border, and its box', async () => {
        const page = await makePage(ground, 64, -32, 32);
        const n = PAGE_SIDE;
        // The first sample past the border is the node's corner.
        const k = (1 * n + 1) * 4;
        const h = ((page.heights[k]! * 256 + page.heights[k + 1]!) / 65535) * 100;
        expect(h).toBeCloseTo(ground.height(64, -32), 1);
        expect(page.min).toBeLessThanOrEqual(page.max);
        expect(page.heights.length).toBe(n * n * 4);
    });

    it('give a full atlas\'s oldest page up for a new one, but not one drawn this frame', () => {
        const table = new PageTable(PAGE_SIDE * 2);
        expect(table.capacity).toBe(4);
        for (let i = 0; i < 4; i++) expect(table.claim(`p${i}`, 0, 1)).not.toBeNull();
        expect(table.claim('fresh', 0, 1)).toBeNull();
        table.tick();
        table.touch('p1'); table.touch('p2'); table.touch('p3');
        const page = table.claim('fresh', 0, 1)!;
        expect(table.get('p0')).toBeUndefined();
        expect(page.slot).toBeGreaterThanOrEqual(0);
    });

    it('keeps a page the ground changed under, drawn as it was, until it is made again in its own slot', () => {
        const table = new PageTable(PAGE_SIDE * 2);
        const slot = table.claim('a', 0, 1)!.slot;
        table.claim('b', 0, 1);
        table.markStale((key) => key === 'a');
        // Still there to draw: an edit leaves no hole while its pages are rebuilt.
        expect(table.get('a')).toBeDefined();
        expect(table.isStale('a')).toBe(true);
        expect(table.isStale('b')).toBe(false);
        const again = table.claim('a', 0.25, 2)!;
        expect(again.slot).toBe(slot);
        expect(again.min).toBe(0.25);
        expect(again.max).toBe(2);
        expect(table.isStale('a')).toBe(false);
        expect(table.size).toBe(2);
    });
});
