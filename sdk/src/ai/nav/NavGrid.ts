// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavGrid.ts
 * @brief   Uniform navigation grid — a walkability bitmap plus the affine map
 *          between grid cells and world pixels.
 *
 * Pure data + math, zero engine/wasm dependency, so the whole pathfinding core
 * is unit-testable in isolation. The engine binding (build one from a tilemap
 * layer) lives in navGridFromTilemap.ts; the A* search in pathfind.ts.
 */

import type { Vec2 } from '../../types';

/** Integer grid coordinate. Kept distinct from {@link Vec2} to flag cell-space. */
export interface Cell {
    x: number;
    y: number;
}

export interface NavGridOptions {
    /** Cell columns. */
    width: number;
    /** Cell rows. */
    height: number;
    /** World pixels per cell (square). */
    cellSize: number;
    /** World position of cell (0,0)'s center. Defaults to origin. */
    origin?: Vec2;
    /**
     * Walkability, row-major `width * height`, 1 = walkable / 0 = blocked.
     * Defaults to fully walkable. Copied in, not retained.
     */
    walkable?: ArrayLike<number>;
}

/**
 * A uniform-cost square grid with a walkability mask. `gy` increases with world
 * +Y; a Y-down source (e.g. a tilemap) flips rows when it builds the grid, so
 * NavGrid itself stays direction-agnostic.
 */
export class NavGrid {
    readonly width: number;
    readonly height: number;
    readonly cellSize: number;
    readonly originX: number;
    readonly originY: number;
    /** Row-major walkability, 1 = walkable. Mutable via {@link setWalkable}. */
    readonly walkable: Uint8Array;

    constructor(opts: NavGridOptions) {
        this.width = opts.width;
        this.height = opts.height;
        this.cellSize = opts.cellSize;
        this.originX = opts.origin?.x ?? 0;
        this.originY = opts.origin?.y ?? 0;

        const n = this.width * this.height;
        this.walkable = new Uint8Array(n);
        if (opts.walkable) {
            this.walkable.set(opts.walkable as ArrayLike<number>, 0);
        } else {
            this.walkable.fill(1);
        }
    }

    index(gx: number, gy: number): number {
        return gy * this.width + gx;
    }

    inBounds(gx: number, gy: number): boolean {
        return gx >= 0 && gy >= 0 && gx < this.width && gy < this.height;
    }

    isWalkable(gx: number, gy: number): boolean {
        return this.inBounds(gx, gy) && this.walkable[gy * this.width + gx] === 1;
    }

    setWalkable(gx: number, gy: number, walkable: boolean): void {
        if (!this.inBounds(gx, gy)) return;
        this.walkable[gy * this.width + gx] = walkable ? 1 : 0;
        this.clearance_ = null;
    }

    /**
     * Cells from here to the nearest thing that blocks — off the grid counts as
     * blocked. An agent is a body: a path hugging a wall is walkable for the
     * cell it was planned through and a wall for the half hanging over the next.
     * Computed on first ask, dropped when walkability changes.
     */
    clearanceAt(gx: number, gy: number): number {
        if (!this.inBounds(gx, gy)) return 0;
        if (!this.clearance_) this.clearance_ = buildClearance(this.width, this.height, this.walkable);
        return this.clearance_[gy * this.width + gx];
    }

    private clearance_: Uint8Array | null = null;

    /** Center of cell `(gx, gy)` in world pixels. */
    cellToWorld(gx: number, gy: number): Vec2 {
        return { x: this.originX + gx * this.cellSize, y: this.originY + gy * this.cellSize };
    }

    /** Cell containing world point `(wx, wy)`. May be out of bounds — caller checks. */
    worldToCell(wx: number, wy: number): Cell {
        return {
            x: Math.round((wx - this.originX) / this.cellSize),
            y: Math.round((wy - this.originY) / this.cellSize),
        };
    }

    /**
     * Nearest walkable cell to `(gx, gy)` by outward ring search, or null if the
     * whole grid is blocked. Used to snap a start/goal that lands on a wall onto
     * a usable cell before searching.
     */
    nearestWalkable(gx: number, gy: number, maxRadius = 8, clearance = 0): Cell | null {
        const fits = (cx: number, cy: number): boolean =>
            this.isWalkable(cx, cy) && (clearance <= 0 || this.clearanceAt(cx, cy) >= clearance);
        if (fits(gx, gy)) return { x: gx, y: gy };
        for (let r = 1; r <= maxRadius; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    // Only the ring perimeter at radius r (interior already checked).
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (fits(gx + dx, gy + dy)) return { x: gx + dx, y: gy + dy };
                }
            }
        }
        return null;
    }
}

/**
 * Chamfer distance transform, 3-4 weighted, in two sweeps: a cheap and close
 * approximation of the euclidean distance to the nearest blocked cell. Reported
 * in whole cells (the 3 is the orthogonal step's weight), capped at 255 —
 * nothing needs to know it is standing 300 cells from a wall.
 */
function buildClearance(width: number, height: number, walkable: Uint8Array): Uint8Array {
    const FAR = 0x7fff;
    const d = new Int32Array(width * height);
    const at = (x: number, y: number): number =>
        (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            if (walkable[i] !== 1) { d[i] = 0; continue; }
            d[i] = Math.min(FAR, at(x - 1, y) + 3, at(x, y - 1) + 3,
                at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
        }
    }
    for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
            const i = y * width + x;
            if (walkable[i] !== 1) continue;
            d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3,
                at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
        }
    }

    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(d[i] / 3));
    return out;
}
