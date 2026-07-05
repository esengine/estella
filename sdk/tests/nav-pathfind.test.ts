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
        expect(grid.cellToWorld(0, 0)).toEqual({ x: 100, y: 200 });
        expect(grid.cellToWorld(2, 1)).toEqual({ x: 164, y: 232 });
        // worldToCell is the inverse of cellToWorld on cell centers.
        expect(grid.worldToCell(164, 232)).toEqual({ x: 2, y: 1 });
        // Points anywhere inside a cell round to that cell.
        expect(grid.worldToCell(170, 210)).toEqual({ x: 2, y: 0 });
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
            { x: 5, y: 5 }, { x: 25, y: 5 }, { x: 45, y: 5 },
        ]);
    });
});
