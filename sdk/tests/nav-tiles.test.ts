// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Navigation tiles: baked one square at a time, stitched into one mesh a route crosses without seeing the seam.
 */
import { describe, it, expect } from 'vitest';
import { bakeNavTile, stitchNavTiles, type NavSquare } from '../src/ai/nav/navTiles';
import { StreamedNavigation } from '../src/ai/nav/navStreaming';
import { Navigation } from '../src/ai/nav/Navigation';
import { NavMesh } from '../src/ai/nav/NavMesh';
import type { Vec3 } from '../src/types';

/** World triangles of axis-aligned boxes: each box's top and its four sides, what a static box collider gives. */
function boxes(...list: Array<{ min: Vec3; max: Vec3 }>) {
    return (qmin: Vec3, qmax: Vec3) => {
        const verts: number[] = [], indices: number[] = [];
        for (const b of list) {
            if (b.max.x < qmin.x || b.min.x > qmax.x || b.max.z < qmin.z || b.min.z > qmax.z) continue;
            const c = [
                [b.min.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.min.z], [b.max.x, b.min.y, b.max.z], [b.min.x, b.min.y, b.max.z],
                [b.min.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.min.z], [b.max.x, b.max.y, b.max.z], [b.min.x, b.max.y, b.max.z],
            ];
            const base = verts.length / 3;
            for (const v of c) verts.push(...v);
            for (const [a, b2, c2, d] of [[4, 7, 6, 5], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
                indices.push(base + a!, base + b2!, base + c2!, base + a!, base + c2!, base + d!);
            }
        }
        return { verts: Float32Array.from(verts), indices: Uint32Array.from(indices) };
    };
}

const options = { cellSize: 4, cellHeight: 2, agentRadius: 6, agentHeight: 20, stepHeight: 6 };
const square = (x: number): NavSquare => ({ minX: x, minZ: 0, maxX: x + 100, maxZ: 100 });
const floor = { min: { x: -50, y: -10, z: -50 }, max: { x: 250, y: 0, z: 150 } };
/** How far short of `to` a route ends: a route to somewhere unreachable goes as near as it can. */
const short = (path: Vec3[] | null, to: Vec3) => path ? Math.hypot(path.at(-1)!.x - to.x, path.at(-1)!.z - to.z) : Infinity;
const length = (path: Vec3[] | null) => path ? path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z), 0) : Infinity;

describe('navigation tiles', () => {
    it('meet edge to edge, and a route crosses the seam as if it were not there', () => {
        const ground = boxes(floor);
        const tiles = [bakeNavTile(square(0), -20, 40, ground, options), bakeNavTile(square(100), -20, 40, ground, options)];
        // Each stops on its square: nothing past it, and no gap eroded back from the open edge.
        expect(tiles[0]!.mesh.findPoly({ x: 98, y: 0, z: 50 })).toBeGreaterThanOrEqual(0);
        expect(tiles[1]!.mesh.findPoly({ x: 102, y: 0, z: 50 })).toBeGreaterThanOrEqual(0);
        // Apart, a route stops at the seam; stitched, it crosses straight.
        expect(short(tiles[0]!.mesh.findWorldPath({ x: 20, y: 0, z: 50 }, { x: 180, y: 0, z: 50 }), { x: 180, y: 0, z: 50 })).toBeGreaterThan(70);
        const mesh = stitchNavTiles(tiles, options.stepHeight);
        expect(length(mesh.findWorldPath({ x: 20, y: 0, z: 50 }, { x: 180, y: 0, z: 50 }))).toBeCloseTo(160, 0);
    });

    it('keeps an agent off a wall just past its edge, which the border reads', () => {
        const wall = { min: { x: 104, y: 0, z: 20 }, max: { x: 110, y: 40, z: 80 } };
        const a = bakeNavTile(square(0), -20, 40, boxes(floor, wall), options);
        // Within the agent's radius of the wall, on the near side of the seam, is not somewhere it can stand.
        expect(a.mesh.findPoly({ x: 99, y: 0, z: 50 }, undefined, 0)).toBe(-1);
        expect(a.mesh.findPoly({ x: 99, y: 0, z: 5 }, undefined, 0)).toBeGreaterThanOrEqual(0);
    });

    it('routes round a wall that lies across the seam', () => {
        const wall = { min: { x: 60, y: 0, z: -50 }, max: { x: 140, y: 40, z: 70 } };
        const geometry = boxes(floor, wall);
        const mesh = stitchNavTiles([bakeNavTile(square(0), -20, 40, geometry, options), bakeNavTile(square(100), -20, 40, geometry, options)],
            options.stepHeight);
        const route = length(mesh.findWorldPath({ x: 20, y: 0, z: 30 }, { x: 180, y: 0, z: 30 }));
        expect(route).toBeGreaterThan(160 + 40);
        expect(Number.isFinite(route)).toBe(true);
    });

    it('does not join floors at different heights across a seam', () => {
        const low = { min: { x: -50, y: -10, z: -50 }, max: { x: 100, y: 0, z: 150 } };
        const high = { min: { x: 100, y: 20, z: -50 }, max: { x: 250, y: 30, z: 150 } };
        const geometry = boxes(low, high);
        const mesh = stitchNavTiles([bakeNavTile(square(0), -20, 60, geometry, options), bakeNavTile(square(100), -20, 60, geometry, options)],
            options.stepHeight);
        expect(short(mesh.findWorldPath({ x: 20, y: 0, z: 50 }, { x: 180, y: 30, z: 50 }), { x: 180, y: 30, z: 50 })).toBeGreaterThan(70);
    });
});

describe('a streamed world\'s navigation', () => {
    /** The two things the tiles read of a world: the volume, and where it is. */
    const world = {
        getEntitiesWithComponents: () => [1],
        get: (_e: number, def: { _name: string }) => def._name === 'Transform'
            ? { position: { x: 100, y: 0, z: 50 } }
            : { halfExtents: { x: 100, y: 40, z: 50 }, cellSize: 4, cellHeight: 2, agentRadius: 6, agentHeight: 20, stepHeight: 6,
                maxSlopeDegrees: 45, layers: 0 },
    } as never;
    const cell = (x: number) => ({ name: `w.cell_${x}_0`, path: '', x, z: 0, minX: x * 100, minZ: 0, maxX: x * 100 + 100, maxZ: 100,
        entityCount: 1, rootCount: 1 });
    const manifest = { version: 1, scene: 'w', cellSize: 100, persistentRefs: [], cells: [cell(1)] };
    const settle = (nav: Navigation, tiles: StreamedNavigation, residency: object, geometry: ReturnType<typeof boxes>) => {
        for (let i = 0; i < 10; i++) tiles.update(world, nav, residency as never, (min, max) => geometry(min, max), [], []);
    };

    it('walks only where the world is, and round a wall once the cell holding it arrives', () => {
        // Square 0 has no cell (persistent ground alone); square 1 is cell w.cell_1_0, with a wall across the way.
        const wall = { min: { x: 130, y: 0, z: -50 }, max: { x: 140, y: 40, z: 70 } };
        let resident = false, epoch = 1;
        const residency = { manifest, get residencyEpoch() { return epoch; }, residencyOf: () => resident ? 'resident' : 'unloaded' };
        const nav = new Navigation();
        const tiles = new StreamedNavigation();
        settle(nav, tiles, residency, boxes(floor));
        expect(tiles.tileCount).toBe(1);
        const to = { x: 180, y: 0, z: 30 };
        expect(short((nav.surface as NavMesh).findWorldPath({ x: 20, y: 0, z: 30 }, to), to)).toBeGreaterThan(70);

        resident = true; epoch++;
        settle(nav, tiles, residency, boxes(floor, wall));
        expect(tiles.tileCount).toBe(2);
        const route = (nav.surface as NavMesh).findWorldPath({ x: 20, y: 0, z: 30 }, to);
        expect(short(route, to)).toBeLessThan(1);
        expect(length(route)).toBeGreaterThan(160 + 20);

        resident = false; epoch++;
        settle(nav, tiles, residency, boxes(floor));
        expect(tiles.tileCount).toBe(1);
    });
});

describe('a narrow strip cut off by a tile edge', () => {
    it('is kept, since the ground it is part of goes on in the next tile', () => {
        // Walkable from z 86 to the edge at 100 once the wall's radius is taken: far smaller than a region worth keeping alone.
        const wall = { min: { x: -50, y: 0, z: 70 }, max: { x: 250, y: 40, z: 80 } };
        const tile = bakeNavTile(square(0), -20, 40, boxes(floor, wall), { ...options, minRegionArea: 40 * 40 });
        expect(tile.mesh.findPoly({ x: 50, y: 0, z: 95 }, undefined, 0)).toBeGreaterThanOrEqual(0);
    });
});
