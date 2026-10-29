// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A 2D generated world: the 3D plan read flat over x and y, cut into chunks that agree, with what players changed laid over them.
 */
import { describe, expect, it } from 'vitest';
import { makePlanePlan } from '../src/worldgen/planePlan';
import { Zones } from '../src/worldgen/zones';
import { PlacementDiffs } from '../src/worldgen/diffs';
import { world2dChunk, placement2D } from '../src/worldgen/world2d';
import type { WorldRules } from '../src/worldgen/rules';

const rules: WorldRules = {
    id: 'test:2d', versions: [1],
    biomes: [
        { id: 'forest', conditions: [{ field: 'moisture', min: 0.5, blend: 0.1 }], transition: 30, recipes: [{ recipe: 'grove', layer: 'trees', density: 0.8 }] },
        { id: 'meadow', conditions: [{ field: 'moisture', max: 0.5, blend: 0.1 }], transition: 30, recipes: [{ recipe: 'rock', layer: 'trees', density: 0.4 }] },
    ],
    recipes: [
        { id: 'grove', version: 1, tags: ['tree'], anchor: { id: 'oak', footprint: 14, interactive: 'tree' },
            members: [{ id: 'sapling', count: [1, 3], ring: [30, 60], footprint: 6 }] },
        { id: 'rock', version: 1, anchor: { id: 'boulder', footprint: 10 } },
    ],
    layers: [{ id: 'trees', spacing: 90, drawDistance: 600 }],
};

const plan = (zones = new Zones()) => makePlanePlan({
    rules, farRules: null, seed: 7, world: 'w', ground: null, flatY: 0, water: null, layers: [], zones,
}).plan;

const SIZE = 512;

describe('a chunk of a 2D world', () => {
    it('is the same whenever it is asked for, and whatever was asked first', () => {
        const a = world2dChunk(plan(), new PlacementDiffs(), 2, -1, SIZE, 16);
        const p = plan();
        world2dChunk(p, new PlacementDiffs(), 9, 9, SIZE, 16);
        const b = world2dChunk(p, new PlacementDiffs(), 2, -1, SIZE, 16);
        expect(b.chunk.placements).toEqual(a.chunk.placements);
        expect(b.chunk.biomeGrid).toEqual(a.chunk.biomeGrid);
        expect(a.chunk.placements.length).toBeGreaterThan(5);
    });

    it('stands things on the plane by x and y, anchors inside the chunk and no id in two chunks', () => {
        const diffs = new PlacementDiffs();
        const p = plan();
        const seen = new Map<string, string>();
        let anchors = 0;
        for (let cy = -2; cy <= 1; cy++) for (let cx = -2; cx <= 1; cx++) {
            const { chunk } = world2dChunk(p, diffs, cx, cy, SIZE, 16);
            for (const t of chunk.placements) {
                expect(seen.has(t.id)).toBe(false);
                seen.set(t.id, `${cx},${cy}`);
                if (t.member === 'oak' || t.member === 'boulder') {
                    anchors++;
                    expect(t.x).toBeGreaterThanOrEqual(chunk.x0);
                    expect(t.x).toBeLessThan(chunk.x0 + SIZE);
                    expect(t.y).toBeGreaterThanOrEqual(chunk.y0);
                    expect(t.y).toBeLessThan(chunk.y0 + SIZE);
                }
            }
        }
        expect(anchors).toBeGreaterThan(20);
    });

    it('paints its ground by the biome that holds each cell, indexed into the rules', () => {
        const { chunk } = world2dChunk(plan(), new PlacementDiffs(), 0, 0, SIZE, 8);
        expect(chunk.biomes).toEqual(['forest', 'meadow']);
        expect(chunk.biomeGrid.length).toBe(64);
        for (const cell of chunk.biomeGrid) expect([0, 1, 255]).toContain(cell);
        const p = plan();
        const step = SIZE / 8;
        const expected = p.biomeAt(0.5 * step, 0.5 * step);
        expect(chunk.biomes[chunk.biomeGrid[0]!]).toBe(expected);
    });

    it('lays what players changed over the plan: a felled thing is gone, a moved one is where it was put, and both are still listed by id', () => {
        const diffs = new PlacementDiffs();
        const first = world2dChunk(plan(), diffs, 1, 1, SIZE, 8);
        const tree = first.chunk.placements.find((t) => t.interactive === 'tree')!;
        const other = first.chunk.placements.find((t) => t.id !== tree.id && t.member === 'oak')!;
        diffs.remove(tree.id);
        diffs.change(other.id, { x: 5000, z: -3, scale: 2 });
        const next = world2dChunk(plan(), diffs, 1, 1, SIZE, 8);
        expect(next.chunk.placements.some((t) => t.id === tree.id)).toBe(false);
        expect(next.ids).toContain(tree.id);
        const moved = next.chunk.placements.find((t) => t.id === other.id)!;
        expect(moved.x).toBe(5000);
        expect(moved.y).toBe(-3);
        expect(moved.scale).toBe(2);
        diffs.restore(tree.id);
        expect(world2dChunk(plan(), diffs, 1, 1, SIZE, 8).chunk.placements.some((t) => t.id === tree.id)).toBe(true);
    });

    it('keeps out of a zone planned by hand, whose z is world y', () => {
        const zones = new Zones();
        zones.set({ id: 'camp', kind: 'home', shape: { type: 'circle', x: 700, z: 700, radius: 250 }, falloff: 0, priority: 1, excludes: ['*'] });
        const { chunk } = world2dChunk(plan(zones), new PlacementDiffs(), 1, 1, SIZE, 8);
        for (const t of chunk.placements) expect(Math.hypot(t.x - 700, t.y - 700)).toBeGreaterThan(250 - t.footprint);
        expect(world2dChunk(plan(), new PlacementDiffs(), 1, 1, SIZE, 8).chunk.placements.length).toBeGreaterThan(chunk.placements.length);
    });

    it('reads a placement as the screen plane does', () => {
        const t = placement2D({ id: 'i', group: 'g', layer: 'l', recipe: 'r', recipeVersion: 1, member: 'm', biome: 'b', zone: null, x: 3, y: 99, z: 4, yaw: 1, scale: 2, normal: [0, 1, 0],
            attach: 'upright', mesh: 0, material: 0, plant: null, interactive: null, footprint: 1, canopy: 2, far: null });
        expect(t).toMatchObject({ x: 3, y: 4, yaw: 1, scale: 2 });
    });
});
