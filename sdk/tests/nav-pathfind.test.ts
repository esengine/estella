// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { NavGrid, type Cell } from '../src/ai/nav/NavGrid';
import { findPath, pathToWorld } from '../src/ai/nav/pathfind';

/**
 * Build a grid from an ASCII map. '#' = blocked, anything else walkable.
 * Row 0 is the top line, so `gy` increases downward here purely for test
 * legibility — the grid itself is direction-agnostic.
 */
function gridFromAscii(rows: string[], cellSize = 10): NavGrid {
    const height = rows.length;
    const width = rows[0].length;
    const walkable = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            walkable[y * width + x] = rows[y][x] === '#' ? 0 : 1;
        }
    }
    return new NavGrid({ width, height, cellSize, walkable });
}

function isContiguous(path: Cell[], diagonal: boolean): boolean {
    for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x);
        const dy = Math.abs(path[i].y - path[i - 1].y);
        const step = Math.max(dx, dy);
        if (step !== 1) return false;
        if (!diagonal && dx + dy !== 1) return false;
    }
    return true;
}

describe('NavGrid', () => {
    it('maps cells to world centers and back', () => {
        const grid = new NavGrid({ width: 4, height: 4, cellSize: 32, origin: { x: 100, y: 200 } });
        expect(grid.cellToWorld(0, 0)).toEqual({ x: 100, y: 200, z: 0 });
        expect(grid.cellToWorld(2, 1)).toEqual({ x: 164, y: 232, z: 0 });
        // worldToCell is the inverse of cellToWorld on cell centers.
        expect(grid.worldToCell({ x: 164, y: 232 })).toEqual({ x: 2, y: 1 });
        // Points anywhere inside a cell round to that cell.
        expect(grid.worldToCell({ x: 170, y: 210 })).toEqual({ x: 2, y: 0 });
    });

    // The same grid, laid in the ground plane of a spatial scene: the cells map
    // to x/z and the axis they leave out carries the height of the ground.
    it('maps cells to the ground plane, at the height of each cell', () => {
        const grid = new NavGrid({
            width: 2, height: 2, cellSize: 10, plane: 'xz', origin: { x: 0, y: 0, z: 0 },
            surface: [0, 0, 5, 40],
        });
        expect(grid.cellToWorld(0, 0)).toEqual({ x: 0, y: 0, z: 0 });
        expect(grid.cellToWorld(1, 1)).toEqual({ x: 10, y: 40, z: 10 });
        // The cell is named by x/z; the height is an answer, never a question.
        expect(grid.worldToCell({ x: 10, y: 999, z: 10 })).toEqual({ x: 1, y: 1 });
    });

    // A step an agent can walk up is a route; a wall of the same width is not.
    // With no surface (or no limit) nothing here can say no — a flat grid's rule.
    it('lets a small step through and a tall one not', () => {
        const opts = { width: 2, height: 1, cellSize: 10, plane: 'xz' as const, stepHeight: 10 };
        const kerb = new NavGrid({ ...opts, surface: [0, 6] });
        const wall = new NavGrid({ ...opts, surface: [0, 60] });
        expect(kerb.canStep(0, 0, 1, 0)).toBe(true);
        expect(wall.canStep(0, 0, 1, 0)).toBe(false);
        expect(new NavGrid({ ...opts, surface: [0, 60], stepHeight: 0 }).canStep(0, 0, 1, 0)).toBe(true);
        expect(new NavGrid(opts).canStep(0, 0, 1, 0)).toBe(true);
    });

    it('reports bounds and walkability', () => {
        const grid = new NavGrid({ width: 3, height: 3, cellSize: 10 });
        expect(grid.isWalkable(0, 0)).toBe(true);
        expect(grid.inBounds(-1, 0)).toBe(false);
        expect(grid.isWalkable(3, 3)).toBe(false);
        grid.setWalkable(1, 1, false);
        expect(grid.isWalkable(1, 1)).toBe(false);
    });

    it('snaps to the nearest walkable cell', () => {
        const grid = gridFromAscii([
            '###',
            '#.#',
            '###',
        ]);
        expect(grid.nearestWalkable(0, 0)).toEqual({ x: 1, y: 1 });
        expect(grid.nearestWalkable(1, 1)).toEqual({ x: 1, y: 1 });
    });

    it('returns null when nothing is walkable in range', () => {
        const grid = gridFromAscii(['###', '###', '###']);
        expect(grid.nearestWalkable(1, 1, 4)).toBeNull();
    });
});

describe('findPath', () => {
    it('finds a straight path on an open grid', () => {
        const grid = new NavGrid({ width: 5, height: 1, cellSize: 10 });
        const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 })!;
        expect(path).not.toBeNull();
        expect(path[0]).toEqual({ x: 0, y: 0 });
        expect(path[path.length - 1]).toEqual({ x: 4, y: 0 });
        expect(isContiguous(path, true)).toBe(true);
    });

    it('returns a single cell when start equals goal', () => {
        const grid = new NavGrid({ width: 5, height: 5, cellSize: 10 });
        expect(findPath(grid, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
    });

    it('routes around a wall', () => {
        // A vertical wall with a gap at the bottom row forces a detour.
        const grid = gridFromAscii([
            '.....',
            '..#..',
            '..#..',
            '..#..',
            '.....',
        ]);
        const path = findPath(grid, { x: 0, y: 2 }, { x: 4, y: 2 }, { diagonal: true })!;
        expect(path).not.toBeNull();
        expect(isContiguous(path, true)).toBe(true);
        // Path must not step on any blocked cell.
        for (const c of path) expect(grid.isWalkable(c.x, c.y)).toBe(true);
    });

    it('returns null for an unreachable goal', () => {
        const grid = gridFromAscii([
            '..#..',
            '..#..',
            '..#..',
            '..#..',
            '..#..',
        ]);
        expect(findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, { snapRadius: 0 })).toBeNull();
    });

    it('does not cut diagonal corners', () => {
        // From (0,0) to (1,1) the diagonal is blocked because both shared
        // orthogonals are walls; the only route is the long way around.
        const grid = gridFromAscii([
            '.#',
            '#.',
        ]);
        // With a 2x2 fully pinched map there is no path at all.
        expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, { snapRadius: 0 })).toBeNull();
    });

    it('4-connected paths never move diagonally', () => {
        const grid = new NavGrid({ width: 5, height: 5, cellSize: 10 });
        const path = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 2 }, { diagonal: false })!;
        expect(path).not.toBeNull();
        expect(isContiguous(path, false)).toBe(true);
        // Manhattan distance 3+2=5 → 6 cells including both endpoints.
        expect(path.length).toBe(6);
    });

    it('snaps a blocked start/goal onto walkable cells', () => {
        const grid = gridFromAscii([
            '#....',
            '.....',
            '....#',
        ]);
        // Start on the top-left wall, goal on the bottom-right wall.
        const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 2 })!;
        expect(path).not.toBeNull();
        expect(grid.isWalkable(path[0].x, path[0].y)).toBe(true);
        expect(grid.isWalkable(path[path.length - 1].x, path[path.length - 1].y)).toBe(true);
    });

    it('projects a path to world waypoints at cell centers', () => {
        const grid = new NavGrid({ width: 3, height: 1, cellSize: 20, origin: { x: 5, y: 5 } });
        const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })!;
        expect(pathToWorld(grid, path)).toEqual([
            { x: 5, y: 5, z: 0 }, { x: 25, y: 5, z: 0 }, { x: 45, y: 5, z: 0 },
        ]);
    });

    // A ledge is not a wall — every cell here is walkable — but it is not a route
    // either, and only the step limit can tell the search that.
    it('routes around a ledge it cannot climb, and over one it can', () => {
        // A tall ridge down the middle column, open along the top row:
        //   row 2: . . .   row 1: . ^ .   row 0: S ^ G
        const ridge = () => [
            0, 90, 0,
            0, 90, 0,
            0, 0, 0,
        ];
        const spatial = { width: 3, height: 3, cellSize: 10, plane: 'xz' as const };
        const blocked = new NavGrid({ ...spatial, surface: ridge(), stepHeight: 20 });
        const path = findPath(blocked, { x: 0, y: 0 }, { x: 2, y: 0 }, { diagonal: false })!;
        expect(path).not.toBeNull();
        // It went the long way: through the open row rather than over the ridge.
        expect(path.some(c => c.y === 2)).toBe(true);

        // The same ridge, an agent that can climb it: straight across.
        const climbable = new NavGrid({ ...spatial, surface: ridge(), stepHeight: 100 });
        const over = findPath(climbable, { x: 0, y: 0 }, { x: 2, y: 0 }, { diagonal: false })!;
        expect(over).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    });

    it('reports no route when the ledge cuts the grid in two', () => {
        const grid = new NavGrid({
            width: 3, height: 1, cellSize: 10, plane: 'xz',
            surface: [0, 90, 0], stepHeight: 20,
        });
        expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    });
});
