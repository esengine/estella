// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Things that block without being geometry — a door, a gate, a placed tower.
 *
 * Blocking is a BAKE input, not a filter over the answer: an obstacle marked
 * after the walkable area was eroded would leave routes scraping along its face.
 * So most of what is claimed here is about WHEN it is applied, and the rest is
 * about the cost of applying it again.
 */
import { describe, it, expect } from 'vitest';
import { buildNavMesh } from '../src/ai/nav/navmesh/build';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { Navigation } from '../src/ai/nav/Navigation';
import { updateObstacles, type ObstacleState } from '../src/ai/nav/NavPlugin';
import { applyObstaclesToGrid, navObstacleDigest } from '../src/ai/nav/navObstacles';
import type { NavObstacleBox } from '../src/ai/nav/navmesh/compact';
import type { Vec3 } from '../src/types';

const NO_TURN = { x: 0, y: 0, z: 0, w: 1 };
const QUARTER_TURN = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

/** A floor slab as world triangles, wide enough to have room around a blocker. */
function floor(half = 600): { verts: Float32Array; indices: Uint32Array } {
    const verts: number[] = [];
    for (const [x, z] of [[-half, -half], [half, -half], [half, half], [-half, half]]) {
        verts.push(x!, 0, z!);
    }
    return { verts: Float32Array.from(verts), indices: Uint32Array.from([0, 2, 1, 0, 3, 2]) };
}

const BOX = {
    min: { x: -700, y: -100, z: -700 },
    max: { x: 700, y: 400, z: 700 },
    cellSize: 25,
    cellHeight: 10,
    agentHeight: 180,
    agentRadius: 50,
    stepHeight: 40,
};

const bake = (obstacles: NavObstacleBox[]) => {
    const f = floor();
    return buildNavMesh(f.verts, f.indices, { ...BOX, obstacles });
};

const blocker = (over: Partial<NavObstacleBox> = {}): NavObstacleBox => ({
    center: { x: 0, y: 0, z: 0 },
    halfExtents: { x: 100, y: 200, z: 100 },
    rotation: NO_TURN,
    ...over,
});

describe('an obstacle in a baked mesh', () => {
    it('takes the ground it stands on out of the mesh', () => {
        expect(bake([]).findPoly({ x: 0, y: 0, z: 0 })).toBeGreaterThanOrEqual(0);
        expect(bake([blocker()]).findPoly({ x: 0, y: 0, z: 0 })).toBe(-1);
    });

    // The whole reason it is a bake input. The hole it leaves has to be the box
    // PLUS the agent's width, or an agent 50 wide is routed to stand with its
    // centre against the face of something it would be standing inside.
    it('leaves a hole the agent width wider than itself', () => {
        const mesh = bake([blocker()]);
        let nearest = Infinity;
        for (let i = 0; i < mesh.verts.length; i += 3) {
            const reach = Math.max(Math.abs(mesh.verts[i]!), Math.abs(mesh.verts[i + 2]!));
            if (reach > 400) continue; // the floor's own outline, not the hole's
            nearest = Math.min(nearest, reach);
        }
        // 100 of box + 50 of agent, less a cell of voxel rounding.
        expect(nearest).toBeGreaterThanOrEqual(125);
    });

    it('blocks along its own axes, not the world', () => {
        const long = blocker({ halfExtents: { x: 400, y: 200, z: 60 } });
        const across = bake([long]);
        const turned = bake([{ ...long, rotation: QUARTER_TURN }]);
        // Unturned it lies along x; a quarter turn puts the same slab along z.
        expect(across.findPoly({ x: 300, y: 0, z: 0 })).toBe(-1);
        expect(across.findPoly({ x: 0, y: 0, z: 300 })).toBeGreaterThanOrEqual(0);
        expect(turned.findPoly({ x: 300, y: 0, z: 0 })).toBeGreaterThanOrEqual(0);
        expect(turned.findPoly({ x: 0, y: 0, z: 300 })).toBe(-1);
    });

    // A door across a corridor is the case this exists for: the route is there
    // when it is open and gone when it is shut, with nothing else changed.
    it('closes a route when it blocks and gives it back when it does not', () => {
        const wall = blocker({ halfExtents: { x: 40, y: 200, z: 700 } });
        const shut = bake([wall]);
        const open = bake([]);
        const from = { x: -500, y: 0, z: 0 };
        const to = { x: 500, y: 0, z: 0 };
        expect(reaches(open.findWorldPath(from, to), to)).toBe(true);
        expect(reaches(shut.findWorldPath(from, to), to)).toBe(false);
    });
});

describe('an obstacle on a grid', () => {
    const open = (): NavGrid => new NavGrid({ width: 9, height: 9, cellSize: 10 });

    it('blocks the cells it stands on and no others', () => {
        const grid = open();
        applyObstaclesToGrid(grid, [blocker({
            center: { x: 40, y: 40, z: 0 }, halfExtents: { x: 10, y: 10, z: 10 },
        })]);
        expect(grid.isWalkable(4, 4)).toBe(false);
        expect(grid.isWalkable(3, 4)).toBe(false);
        expect(grid.isWalkable(2, 4)).toBe(true);
    });

    // A door that shuts and opens again must give back exactly the ground that was
    // there — including the ground the map itself said was not walkable.
    it('gives back the map underneath when it is lifted', () => {
        const grid = open();
        grid.setWalkable(4, 4, false);
        const box = [blocker({ center: { x: 30, y: 30, z: 0 }, halfExtents: { x: 20, y: 20, z: 10 } })];
        applyObstaclesToGrid(grid, box);
        expect(grid.isWalkable(3, 3)).toBe(false);
        applyObstaclesToGrid(grid, []);
        expect(grid.isWalkable(3, 3)).toBe(true);
        expect(grid.isWalkable(4, 4)).toBe(false); // the map's own wall, still there
    });

    it('does not answer for a grid lying at another depth', () => {
        const grid = new NavGrid({ width: 9, height: 9, cellSize: 10, origin: { x: 0, y: 0, z: 500 } });
        applyObstaclesToGrid(grid, [blocker({ center: { x: 40, y: 40, z: 0 } })]);
        expect(grid.isWalkable(4, 4)).toBe(true);
    });
});

describe('updateObstacles', () => {
    const state = (): ObstacleState => ({ digest: navObstacleDigest([]), at: 0, deferred: 0, grid: null });

    it('rebuilds nothing while nothing has changed', () => {
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 4, height: 4, cellSize: 10 }));
        const s = state();
        expect(updateObstacles(nav, [], s, 10_000)).toBe(false);
    });

    it('rebuilds when an obstacle appears, and marks the grid', () => {
        const nav = new Navigation();
        const grid = new NavGrid({ width: 9, height: 9, cellSize: 10 });
        nav.setSurface(grid);
        const s = state();
        expect(updateObstacles(nav, [blocker({ center: { x: 40, y: 40, z: 0 } })], s, 10_000)).toBe(true);
        expect(grid.isWalkable(4, 4)).toBe(false);
    });

    // A rebuild is the most expensive thing a running game can ask of navigation,
    // so something that changes every frame must not get one every frame.
    it('will not rebuild twice inside its own interval', () => {
        const nav = new Navigation();
        nav.setSurface(new NavGrid({ width: 9, height: 9, cellSize: 10 }));
        const s = state();
        expect(updateObstacles(nav, [blocker()], s, 10_000)).toBe(true);
        expect(updateObstacles(nav, [blocker({ center: { x: 10, y: 0, z: 0 } })], s, 10_050)).toBe(false);
        expect(updateObstacles(nav, [blocker({ center: { x: 10, y: 0, z: 0 } })], s, 10_400)).toBe(true);
    });

    // The obstacles were already standing there; the grid is the new thing.
    it('marks a grid the game has only just installed', () => {
        const nav = new Navigation();
        const s = state();
        const obstacles = [blocker({ center: { x: 40, y: 40, z: 0 } })];
        updateObstacles(nav, obstacles, s, 10_000);
        const grid = new NavGrid({ width: 9, height: 9, cellSize: 10 });
        nav.setSurface(grid);
        updateObstacles(nav, obstacles, s, 10_050);
        expect(grid.isWalkable(4, 4)).toBe(false);
    });
});

/** Whether a route actually got where it was sent — a route that could not is
 *  answered with the way to the nearest place it could, not with nothing. */
function reaches(path: Vec3[] | null, to: Vec3, slack = 120): boolean {
    if (!path || path.length === 0) return false;
    const end = path[path.length - 1]!;
    return Math.hypot(end.x - to.x, end.y - to.y, end.z - to.z) < slack;
}
