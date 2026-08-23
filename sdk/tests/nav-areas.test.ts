// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Ground that costs more or less to cross.
 *
 * A mesh answers where an agent CAN walk; a priced patch is where a scene says
 * what it would rather walk on. Which makes every claim here about a route that
 * is LONGER than the one distance alone would have chosen — and about the one
 * that is not, when the price is the only way through.
 */
import { describe, it, expect } from 'vitest';
import { buildNavMesh } from '../src/ai/nav/navmesh/build';
import { NavMesh } from '../src/ai/nav/NavMesh';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { updateAreas, type AreaState } from '../src/ai/nav/NavPlugin';
import { FIRST_AREA, applyAreasToGrid, type NavAreaBox } from '../src/ai/nav/navObstacles';
import { findPath } from '../src/ai/nav/pathfind';
import type { Vec3 } from '../src/types';

const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };

function floor(half = 500): { verts: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        verts.push(x!, 0, z!);
    }
    return { verts: Float32Array.from(verts), indices: Uint32Array.from([0, 2, 1, 0, 3, 2]) };
}

const BOX = {
    min: { x: -600, y: -100, z: -600 },
    max: { x: 600, y: 400, z: 600 },
    cellSize: 25,
    cellHeight: 10,
    agentHeight: 180,
    agentRadius: 30,
    stepHeight: 40,
};

/** A swamp straight across the middle of the floor, wide but not endless. */
const SWAMP: NavAreaBox = {
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 150, y: 200, z: 250 },
    rotation: NO_TURN,
    area: FIRST_AREA,
};

const bake = (areas: NavAreaBox[] = []): NavMesh => {
    const f = floor();
    return buildNavMesh(f.verts, f.indices, { ...BOX, areas });
};

const FROM = { x: -400, y: 0, z: 0 };
const TO = { x: 400, y: 0, z: 0 };

/** How far a route goes off the straight line between its ends. */
function detour(path: Vec3[]): number {
    return Math.max(...path.map(p => Math.abs(p.z)));
}

describe('priced ground in a mesh', () => {
    it('is walked straight across when it costs what open ground costs', () => {
        const mesh = bake([SWAMP]);
        const path = mesh.findWorldPath(FROM, TO)!;
        expect(path).not.toBeNull();
        expect(detour(path)).toBeLessThan(60);
    });

    it('is walked round when it costs more', () => {
        const mesh = bake([SWAMP]);
        mesh.setAreaCost(FIRST_AREA, 8);
        const path = mesh.findWorldPath(FROM, TO)!;
        expect(detour(path)).toBeGreaterThan(200);
    });

    // A price is not a wall. An agent with nowhere else to go wades through, which
    // is the difference between a swamp and a fence.
    it('is still crossed when there is no way round', () => {
        const wall: NavAreaBox = { ...SWAMP, halfExtents: { x: 150, y: 200, z: 600 } };
        const mesh = bake([wall]);
        mesh.setAreaCost(FIRST_AREA, 40);
        const path = mesh.findWorldPath(FROM, TO)!;
        expect(path[path.length - 1]!.x).toBeGreaterThan(300);
    });

    it('costs nothing extra to change its price', () => {
        const mesh = bake([SWAMP]);
        mesh.setAreaCost(FIRST_AREA, 8);
        const round = detour(mesh.findWorldPath(FROM, TO)!);
        mesh.setAreaCost(FIRST_AREA, 1);
        const across = detour(mesh.findWorldPath(FROM, TO)!);
        expect(round).toBeGreaterThan(200);
        expect(across).toBeLessThan(60);
    });
});

describe('priced ground on a grid', () => {
    const open = (): NavGrid => new NavGrid({ width: 21, height: 21, cellSize: 10 });
    const swamp = (cost: number): NavAreaBox & { cost: number } => ({
        center: { x: 100, y: 100, z: 0 },
        halfExtents: { x: 30, y: 60, z: 10 },
        rotation: NO_TURN,
        area: FIRST_AREA,
        cost,
    });

    it('makes a route go round what it would have walked over', () => {
        const cheap = open();
        applyAreasToGrid(cheap, [swamp(1)]);
        const straight = findPath(cheap, { x: 0, y: 10 }, { x: 20, y: 10 }, { diagonal: false })!;
        expect(straight.every(c => c.y === 10)).toBe(true);

        const dear = open();
        applyAreasToGrid(dear, [swamp(20)]);
        const round = findPath(dear, { x: 0, y: 10 }, { x: 20, y: 10 }, { diagonal: false })!;
        expect(round.some(c => c.y !== 10)).toBe(true);
        // And it never walked into the swamp it was going round.
        for (const c of round) {
            if (c.x >= 7 && c.x <= 13) expect(c.y).not.toBe(10);
        }
    });

    // String-pulling shortens a route by distance. Straightening one back through
    // the mud it just went round would undo the only reason it went round.
    it('is not straightened back through by the string-pull', () => {
        const grid = open();
        applyAreasToGrid(grid, [swamp(20)]);
        const path = grid.findWorldPath({ x: 0, y: 100, z: 0 }, { x: 200, y: 100, z: 0 })!;
        // Sampled ALONG the route, not at its corners: a shortcut clips the mud
        // between two waypoints that are both clear of it.
        for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]!;
            const b = path[i]!;
            const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
            for (let t = 0; t <= steps; t++) {
                const cell = grid.worldToCell({
                    x: a.x + (b.x - a.x) * (t / steps),
                    y: a.y + (b.y - a.y) * (t / steps),
                });
                expect(grid.costAt(cell.x, cell.y)).toBe(1);
            }
        }
    });

    it('gives the ground back its open price when the patch goes', () => {
        const grid = open();
        applyAreasToGrid(grid, [swamp(20)]);
        expect(grid.costAt(10, 10)).toBe(20);
        applyAreasToGrid(grid, []);
        expect(grid.costAt(10, 10)).toBe(1);
    });
});

describe('updateAreas', () => {
    const state = (): AreaState => ({ digest: 0 });

    it('tells a mesh the prices without rebuilding it', () => {
        const nav = new Navigation();
        const mesh = bake([SWAMP]);
        nav.setSurface(mesh);
        const s = state();
        updateAreas(nav, [{ ...SWAMP, cost: 8 }], s);
        expect(mesh.costOf(mesh.findPoly({ x: 0, y: 0, z: 0 }))).toBe(8);
        // A price the scene changed is a price, not a bake: same mesh, new answer.
        updateAreas(nav, [{ ...SWAMP, cost: 2 }], s);
        expect(mesh.costOf(mesh.findPoly({ x: 0, y: 0, z: 0 }))).toBe(2);
        expect(nav.surface).toBe(mesh);
    });

    it('asks for a rebuild when a patch moves, and not when only its price does', () => {
        const nav = new Navigation();
        nav.setSurface(bake([SWAMP]));
        const s = state();
        updateAreas(nav, [{ ...SWAMP, cost: 8 }], s);
        expect(updateAreas(nav, [{ ...SWAMP, cost: 3 }], s)).toBe(false);
        expect(updateAreas(nav, [{
            ...SWAMP, cost: 3, center: { x: 200, y: 0, z: 0 },
        }], s)).toBe(true);
    });
});
