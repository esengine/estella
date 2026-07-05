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
import type { Vec2 } from '../../types';

export interface PathfindOptions {
    /** Allow 8-connected diagonal moves. Default true. */
    diagonal?: boolean;
    /**
     * When start/goal lands on a blocked cell, snap to the nearest walkable one
     * within this ring radius before searching. 0 disables snapping. Default 8.
     */
    snapRadius?: number;
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

    const s = resolveEndpoint(grid, start, snapRadius);
    const g = resolveEndpoint(grid, goal, snapRadius);
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
            if (!grid.isWalkable(nx, ny)) continue;
            // No corner-cutting: a diagonal needs both shared orthogonals open.
            if (i >= 4 && (!grid.isWalkable(cx + dx, cy) || !grid.isWalkable(cx, cy + dy))) continue;

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

/** Convert a cell path to world-space waypoints (cell centers). */
export function pathToWorld(grid: NavGrid, path: Cell[]): Vec2[] {
    return path.map(c => grid.cellToWorld(c.x, c.y));
}

function resolveEndpoint(grid: NavGrid, c: Cell, snapRadius: number): Cell | null {
    if (grid.isWalkable(c.x, c.y)) return c;
    if (snapRadius <= 0) return null;
    return grid.nearestWalkable(c.x, c.y, snapRadius);
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

/**
 * Binary min-heap of cell indices keyed by an f-score, backed by flat typed
 * arrays. Lazy-deletion friendly: a cell may be pushed more than once with a
 * lower key; the search skips already-closed pops.
 */
class MinHeap {
    private nodes: Int32Array;
    private keys: Float64Array;
    size = 0;

    constructor(capacityHint: number) {
        const cap = Math.max(16, capacityHint);
        this.nodes = new Int32Array(cap);
        this.keys = new Float64Array(cap);
    }

    push(node: number, key: number): void {
        if (this.size === this.nodes.length) this.grow();
        let i = this.size++;
        this.nodes[i] = node;
        this.keys[i] = key;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.keys[parent] <= this.keys[i]) break;
            this.swap(i, parent);
            i = parent;
        }
    }

    pop(): number {
        const top = this.nodes[0];
        const last = --this.size;
        this.nodes[0] = this.nodes[last];
        this.keys[0] = this.keys[last];
        let i = 0;
        for (;;) {
            const l = i * 2 + 1;
            const r = l + 1;
            let smallest = i;
            if (l < this.size && this.keys[l] < this.keys[smallest]) smallest = l;
            if (r < this.size && this.keys[r] < this.keys[smallest]) smallest = r;
            if (smallest === i) break;
            this.swap(i, smallest);
            i = smallest;
        }
        return top;
    }

    private swap(a: number, b: number): void {
        const tn = this.nodes[a]; this.nodes[a] = this.nodes[b]; this.nodes[b] = tn;
        const tk = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = tk;
    }

    private grow(): void {
        const nn = new Int32Array(this.nodes.length * 2);
        const nk = new Float64Array(this.keys.length * 2);
        nn.set(this.nodes); nk.set(this.keys);
        this.nodes = nn; this.keys = nk;
    }
}
