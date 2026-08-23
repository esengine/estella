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
 * Find a grid path from `start` to `goal`, inclusive of both endpoints. A goal
 * that cannot be reached yields the route to the reachable cell NEAREST it, and
 * the caller sees it fell short because it named the goal. Null means the START
 * is nowhere: a cell off the grid has no route from it.
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

    // The nearest the search ever got, in case it never gets there.
    let nearestIdx = startIdx;
    let nearestScore = heuristic(s.x, s.y, g.x, g.y, diagonal);

    const heap = new MinHeap(n);
    heap.push(startIdx, nearestScore);

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

            const step = (i < 4 ? 1 : SQRT2) * grid.costAt(nx, ny);
            const tentative = baseG + step;
            if (tentative < gScore[nIdx]) {
                gScore[nIdx] = tentative;
                cameFrom[nIdx] = current;
                const toGoal = heuristic(nx, ny, g.x, g.y, diagonal);
                if (toGoal < nearestScore) {
                    nearestScore = toGoal;
                    nearestIdx = nIdx;
                }
                heap.push(nIdx, tentative + toGoal);
            }
        }
    }

    return reconstruct(cameFrom, nearestIdx, width);
}

/**
 * Drop the waypoints a straight line can skip, leaving only the cells a route has
 * to turn at — what the funnel does over a mesh. A shortcut is taken only along a
 * line the search itself could have walked: every cell it touches fits the body,
 * and a diagonal needs both of its shared orthogonals.
 */
export function shortenPath(grid: NavGrid, path: Cell[], clearance = 0): Cell[] {
    if (path.length <= 2) return path;
    const out: Cell[] = [path[0]!];
    let anchor = path[0]!;
    for (let i = 2; i < path.length; i++) {
        if (clearLine(grid, anchor, path[i]!, clearance)) continue;
        anchor = path[i - 1]!;
        out.push(anchor);
    }
    out.push(path[path.length - 1]!);
    return out;
}

/** Whether every cell between two cells fits the body, walking the same steps.
 *  Ground that costs something other than what the shortcut starts on is refused:
 *  a route that went round the mud must not be straightened back into it. */
function clearLine(grid: NavGrid, from: Cell, to: Cell, clearance: number): boolean {
    let x = from.x;
    let y = from.y;
    const price = grid.costAt(from.x, from.y);
    const dx = Math.abs(to.x - x);
    const dy = Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let err = dx - dy;
    for (;;) {
        if (!fits(grid, x, y, clearance)) return false;
        if (grid.costAt(x, y) !== price) return false;
        if (x === to.x && y === to.y) return true;
        const e2 = err * 2;
        const stepX = e2 > -dy;
        const stepY = e2 < dx;
        if (stepX && stepY
            && (!fits(grid, x + sx, y, clearance) || !fits(grid, x, y + sy, clearance))) return false;
        if (stepX) { err -= dy; x += sx; }
        if (stepY) { err += dx; y += sy; }
    }
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
