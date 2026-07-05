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
        if (this.inBounds(gx, gy)) this.walkable[gy * this.width + gx] = walkable ? 1 : 0;
    }

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
    nearestWalkable(gx: number, gy: number, maxRadius = 8): Cell | null {
        if (this.isWalkable(gx, gy)) return { x: gx, y: gy };
        for (let r = 1; r <= maxRadius; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    // Only the ring perimeter at radius r (interior already checked).
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const cx = gx + dx;
                    const cy = gy + dy;
                    if (this.isWalkable(cx, cy)) return { x: cx, y: cy };
                }
            }
        }
        return null;
    }
}
