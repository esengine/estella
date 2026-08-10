// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Room to walk: an agent is a body, not a point.
 *
 * A path planned for a point is a path only the centre of an agent fits
 * through. What that looks like in a game is an enemy that walks confidently
 * into a doorway and stops there forever, because the cell it was routed to is
 * walkable and the half of it hanging over the next one is not.
 */
import { describe, it, expect } from 'vitest';
import { NavGrid } from '../src/ai/nav/NavGrid';
import { findPath } from '../src/ai/nav/pathfind';

/** `#` blocks, `.` is open. Row 0 is the TOP row of the string. */
function gridOf(rows: string[]): NavGrid {
    const height = rows.length;
    const width = rows[0].length;
    const walkable = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) walkable[y * width + x] = rows[y][x] === '#' ? 0 : 1;
    }
    return new NavGrid({ width, height, cellSize: 1, walkable });
}

describe('clearance', () => {
    it('is zero on a wall and grows with distance from one', () => {
        const g = gridOf([
            '#####',
            '#...#',
            '#...#',
            '#...#',
            '#####',
        ]);
        expect(g.clearanceAt(0, 0)).toBe(0);
        expect(g.clearanceAt(1, 1)).toBe(1);
        expect(g.clearanceAt(2, 2)).toBe(2);
    });

    // Off the grid is not somewhere to stand: half an agent outside the world
    // is no better than half of it inside a rock.
    it('counts the edge of the grid as a wall', () => {
        const g = gridOf(['...', '...', '...']);
        expect(g.clearanceAt(0, 1)).toBe(1);
        expect(g.clearanceAt(1, 1)).toBe(2);
    });

    it('is recomputed after walkability changes', () => {
        const g = gridOf(['.....', '.....', '.....']);
        expect(g.clearanceAt(2, 1)).toBe(2);
        g.setWalkable(2, 0, false);
        expect(g.clearanceAt(2, 1)).toBe(1);
    });
});

describe('findPath with clearance', () => {
    // A one-cell gap: a point goes through, a body does not.
    const pinch = gridOf([
        '.......',
        '.......',
        '###.###',
        '.......',
        '.......',
    ]);

    it('takes the pinch when planning for a point', () => {
        expect(findPath(pinch, { x: 3, y: 0 }, { x: 3, y: 4 })).not.toBeNull();
    });

    it('refuses the pinch for a body that does not fit', () => {
        expect(findPath(pinch, { x: 3, y: 0 }, { x: 3, y: 4 }, { clearance: 2 })).toBeNull();
    });

    it('routes a body the long way round when there is one', () => {
        const room = gridOf([
            '..........',
            '..........',
            '..........',
            '####.#####',
            '..........',
            '..........',
            '..........',
        ]);
        const point = findPath(room, { x: 1, y: 1 }, { x: 1, y: 5 });
        const body = findPath(room, { x: 1, y: 1 }, { x: 1, y: 5 }, { clearance: 2 });
        expect(point).not.toBeNull();
        // The only gap is one cell wide, so a two-cell body has nowhere to go.
        expect(body).toBeNull();
    });

    // Goals are where the game put them, which is often against a wall. A body
    // that cannot stand there is walked as close as it can stand instead — the
    // rest is the agent's arrival tolerance, not the planner's business.
    it('walks a goal against a wall as close as the body can stand', () => {
        const g = gridOf([
            '#####',
            '#...#',
            '#...#',
            '#...#',
            '#####',
        ]);
        const path = findPath(g, { x: 3, y: 3 }, { x: 1, y: 1 }, { clearance: 2 });
        expect(path).not.toBeNull();
        const end = path!.at(-1)!;
        expect(Math.max(Math.abs(end.x - 1), Math.abs(end.y - 1))).toBeLessThanOrEqual(1);
    });
});
