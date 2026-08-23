// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { NavGrid, type Cell } from '../src/ai/nav/NavGrid';
import { findPath, pathToWorld, shortenPath } from '../src/ai/nav/pathfind';

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

    // A goal nothing can reach is answered with the route to the nearest cell that
    // can be. Whether it got there is the caller's to see: it named the goal, and
    // the last cell either is that goal or is not.
    it('stops at the wall when the goal is on the far side of it', () => {
        const grid = gridFromAscii([
            '..#..',
            '..#..',
            '..#..',
            '..#..',
            '..#..',
        ]);
        const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, { snapRadius: 0 })!;
        expect(path).not.toBeNull();
        expect(path[path.length - 1]).toEqual({ x: 1, y: 0 }); // against the wall
        for (const c of path) expect(grid.isWalkable(c.x, c.y)).toBe(true);
    });

    it('does not cut diagonal corners', () => {
        // From (0,0) to (1,1) the diagonal is blocked because both shared
        // orthogonals are walls; the only route is the long way around.
        const grid = gridFromAscii([
            '.#',
            '#.',
        ]);
        // With a 2x2 fully pinched map there is nowhere to go: the route is the
        // cell it started on and nothing more.
        expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 }, { snapRadius: 0 }))
            .toEqual([{ x: 0, y: 0 }]);
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
});

/**
 * A route over cells comes back as a staircase; a route over polygons comes back
 * taut. Both are `NavSurface.findWorldPath`, so a game moving from a tilemap to
 * geometry should not find its agents walking differently.
 */
describe('shortenPath', () => {
    it('crosses open ground in one straight line', () => {
        const grid = new NavGrid({ width: 10, height: 10, cellSize: 10 });
        const path = findPath(grid, { x: 0, y: 0 }, { x: 9, y: 9 })!;
        expect(path.length).toBe(10); // the staircase A* actually walks
        expect(shortenPath(grid, path)).toEqual([{ x: 0, y: 0 }, { x: 9, y: 9 }]);
    });

    it('keeps the turn it has to make, and no others', () => {
        //   . . . . .
        //   S # # # G   ← the wall forces one way round
        //   . . . . .
        const grid = new NavGrid({ width: 5, height: 3, cellSize: 10 });
        for (let x = 1; x <= 3; x++) grid.setWalkable(x, 1, false);
        const raw = findPath(grid, { x: 0, y: 1 }, { x: 4, y: 1 })!;
        const short = shortenPath(grid, raw);
        expect(short.length).toBeLessThan(raw.length);
        expect(short.length).toBeGreaterThan(2);
        expect(short[0]).toEqual({ x: 0, y: 1 });
        expect(short[short.length - 1]).toEqual({ x: 4, y: 1 });
    });

    // Swept over scattered walls rather than one drawing: which shortcuts a greedy
    // walk even gets to CONSIDER depends on the shape it is cutting, and one
    // picture leaves most of the rule untested.
    it('never cuts a line the agent could not walk', () => {
        let seed = 12345;
        const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
        let shortened = 0;
        for (let trial = 0; trial < 200; trial++) {
            const grid = new NavGrid({ width: 12, height: 12, cellSize: 10 });
            for (let i = 0; i < 24; i++) {
                grid.setWalkable(Math.floor(next() * 12), Math.floor(next() * 12), false);
            }
            const raw = findPath(grid, { x: 0, y: 0 }, { x: 11, y: 11 });
            if (!raw) continue;
            const short = shortenPath(grid, raw);
            expect(everySegmentWalkable(grid, short)).toBe(true);
            expect(short.length).toBeLessThanOrEqual(raw.length);
            if (short.length < raw.length) shortened++;
        }
        // A sweep where nothing was ever shortened would prove nothing at all.
        expect(shortened).toBeGreaterThan(50);
    });

    // A diagonal past a blocked corner is a squeeze the search itself refuses; a
    // shortcut that took it would plan the agent through the corner of a wall.
    it('will not cut a diagonal past a blocked corner', () => {
        const grid = new NavGrid({ width: 2, height: 2, cellSize: 10 });
        grid.setWalkable(1, 0, false);
        const raw = findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })!;
        expect(shortenPath(grid, raw)).toEqual(raw);
    });

    it('will not cut a line a body that wide does not fit down', () => {
        //  A one-cell gap in a wall: a point fits through, a body does not.
        const grid = new NavGrid({ width: 7, height: 7, cellSize: 10 });
        for (let y = 0; y < 7; y++) if (y !== 3) grid.setWalkable(3, y, false);
        const raw = findPath(grid, { x: 0, y: 3 }, { x: 6, y: 3 })!;
        expect(shortenPath(grid, raw, 0)).toEqual([{ x: 0, y: 3 }, { x: 6, y: 3 }]);
        // With a body two cells wide nothing on that line fits, so nothing is cut.
        const wide = shortenPath(grid, raw, 2);
        expect(wide.length).toBeGreaterThan(2);
    });

    it('leaves a path with nothing to drop alone', () => {
        const grid = new NavGrid({ width: 3, height: 1, cellSize: 10 });
        expect(shortenPath(grid, [{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
        expect(shortenPath(grid, [{ x: 0, y: 0 }, { x: 1, y: 0 }]))
            .toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    });
});

/** Whether every cell the route passes between its waypoints is walkable. */
function everySegmentWalkable(grid: NavGrid, path: Cell[]): boolean {
    for (let i = 1; i < path.length; i++) {
        let x = path[i - 1]!.x;
        let y = path[i - 1]!.y;
        const to = path[i]!;
        const dx = Math.abs(to.x - x);
        const dy = Math.abs(to.y - y);
        const sx = x < to.x ? 1 : -1;
        const sy = y < to.y ? 1 : -1;
        let err = dx - dy;
        for (;;) {
            if (!grid.isWalkable(x, y)) return false;
            if (x === to.x && y === to.y) break;
            const e2 = err * 2;
            if (e2 > -dy) { err -= dy; x += sx; }
            if (e2 < dx) { err += dx; y += sy; }
        }
    }
    return true;
}
