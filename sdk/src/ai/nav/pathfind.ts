// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    pathfind.ts
 * @brief   A* over a {@link NavGrid} — pure, allocation-lean, unit-testable.
 *
 * Uniform-cost 4- or 8-connected search with a binary min-heap open set and
 * octile/manhattan heuristics. Diagonal steps never cut corners (both shared
 * orthogonal neighbours must be walkable), so an agent following the path can't
 * clip a wall corner.
 */

import type { NavGrid, Cell } from './NavGrid';
import { MinHeap } from './minHeap';
import type { Vec3 } from '../../types';

export interface PathfindOptions {
    /** Allow 8-connected diagonal moves. Default true. */
    diagonal?: boolean;
    /**
     * When start/goal lands on a blocked cell, snap to the nearest walkable one
     * within this ring radius before searching. 0 disables snapping. Default 8.
     */
    snapRadius?: number;
    /**
     * Cells of room the agent needs on every step — a body has width, and a
     * path planned for a point hands it one that only its centre fits through.
     * 0 (default) plans for a point.
     */
    clearance?: number;
}

const SQRT2 = Math.SQRT2;

// Neighbour offsets: first 4 orthogonal, last 4 diagonal. Diagonals are gated on
// their two shared orthogonal cells to forbid corner-cutting.
const ORTHO: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Find a grid path from `start` to `goal`, inclusive of both endpoints.
 * Returns null if unreachable (or if either endpoint can't be snapped to a
 * walkable cell). A start equal to goal yields a single-cell path.
 */
export function findPath(
    grid: NavGrid,
    start: Cell,
    goal: Cell,
    opts: PathfindOptions = {},
): Cell[] | null {
    const diagonal = opts.diagonal ?? true;
    const snapRadius = opts.snapRadius ?? 8;
    const clearance = Math.max(0, opts.clearance ?? 0);

    const s = resolveEndpoint(grid, start, snapRadius, clearance);
    const g = resolveEndpoint(grid, goal, snapRadius, clearance);
    if (!s || !g) return null;

    const { width, height } = grid;
    const n = width * height;
    const startIdx = s.y * width + s.x;
    const goalIdx = g.y * width + g.x;
    if (startIdx === goalIdx) return [{ x: s.x, y: s.y }];

    const gScore = new Float64Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    gScore[startIdx] = 0;

    const heap = new MinHeap(n);
    heap.push(startIdx, heuristic(s.x, s.y, g.x, g.y, diagonal));

    while (heap.size > 0) {
        const current = heap.pop();
        if (current === goalIdx) return reconstruct(cameFrom, current, width);
        if (closed[current]) continue;
        closed[current] = 1;

        const cx = current % width;
        const cy = (current - cx) / width;
        const baseG = gScore[current];

        for (let i = 0; i < (diagonal ? 8 : 4); i++) {
            const [dx, dy] = i < 4 ? ORTHO[i] : DIAG[i - 4];
            const nx = cx + dx;
            const ny = cy + dy;
            if (!fits(grid, nx, ny, clearance)) continue;
            // No corner-cutting: a diagonal needs both shared orthogonals open.
            if (i >= 4 && (!fits(grid, cx + dx, cy, clearance) || !fits(grid, cx, cy + dy, clearance))) continue;

            const nIdx = ny * width + nx;
            if (closed[nIdx]) continue;

            const step = i < 4 ? 1 : SQRT2;
            const tentative = baseG + step;
            if (tentative < gScore[nIdx]) {
                gScore[nIdx] = tentative;
                cameFrom[nIdx] = current;
                heap.push(nIdx, tentative + heuristic(nx, ny, g.x, g.y, diagonal));
            }
        }
    }

    return null;
}

/** Convert a cell path to world-space waypoints (cell centres, on the grid's plane). */
export function pathToWorld(grid: NavGrid, path: Cell[]): Vec3[] {
    return path.map(c => grid.cellToWorld(c.x, c.y));
}

/** Walkable, and with enough room around it for a body of this size. */
function fits(grid: NavGrid, gx: number, gy: number, clearance: number): boolean {
    if (!grid.isWalkable(gx, gy)) return false;
    return clearance <= 0 || grid.clearanceAt(gx, gy) >= clearance;
}

function resolveEndpoint(grid: NavGrid, c: Cell, snapRadius: number, clearance: number): Cell | null {
    if (fits(grid, c.x, c.y, clearance)) return c;
    if (snapRadius <= 0) return null;
    // An agent already jammed against a wall must still be given a way out, so
    // a start that fits nowhere falls back to merely walkable.
    return grid.nearestWalkable(c.x, c.y, snapRadius, clearance)
        ?? grid.nearestWalkable(c.x, c.y, snapRadius);
}

function heuristic(ax: number, ay: number, bx: number, by: number, diagonal: boolean): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    // Octile for 8-connected (admissible & consistent), manhattan for 4-connected.
    return diagonal ? (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy) : dx + dy;
}

function reconstruct(cameFrom: Int32Array, goalIdx: number, width: number): Cell[] {
    const path: Cell[] = [];
    let node = goalIdx;
    while (node !== -1) {
        const x = node % width;
        path.push({ x, y: (node - x) / width });
        node = cameFrom[node];
    }
    path.reverse();
    return path;
}
