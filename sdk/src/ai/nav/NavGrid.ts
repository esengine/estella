// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    NavGrid.ts
 * @brief   Uniform navigation grid — a walkability bitmap plus the affine map
 *          between grid cells and world space.
 *
 * The representation for a world that IS a grid: a tilemap, or any flat scene
 * whose ground is one plane. Its two advantages over a baked mesh are that it
 * costs nothing to build from data that is already cells, and that a single cell
 * can be flipped while the game runs — a door closes, a tower goes up. Ground
 * that slopes or stacks is not its question; that is {@link NavMesh}.
 *
 * Pure data + math, zero engine/wasm dependency, so the whole pathfinding core
 * is unit-testable in isolation. The engine binding (build one from a tilemap
 * layer) lives beside it; A* in pathfind.ts.
 */

import type { Vec3 } from '../../types';
import type { NavPoint, NavQueryOptions, NavSurface, NavSurfaceSink } from './NavSurface';
import { findPath, pathToWorld, shortenPath } from './pathfind';

/** Integer grid coordinate. Its own type rather than a world vector, so a cell
 *  coordinate cannot be passed where world pixels are expected. */
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
    /** World position of cell (0,0)'s centre. Its `z` is the depth every waypoint
     *  comes back at — the plane the scene is drawn on. Defaults to the origin. */
    origin?: { x: number; y: number; z?: number };
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
export class NavGrid implements NavSurface {
    /** The grid lies in x/y, so off it is toward whoever is looking at the scene. */
    readonly up: Vec3 = { x: 0, y: 0, z: 1 };
    readonly width: number;
    readonly height: number;
    readonly cellSize: number;
    /** Cell (0,0)'s centre. */
    readonly originX: number;
    readonly originY: number;
    /** The depth the grid lies at — carried onto every waypoint it hands back. */
    readonly originZ: number;
    /** Row-major walkability, 1 = walkable. Mutable via {@link setWalkable}. */
    readonly walkable: Uint8Array;
    /** Cells an obstacle is standing on, or null while nothing blocks. Kept apart
     *  from `walkable` so a door closing and reopening cannot erase the map. */
    private obstructed_: Uint8Array | null = null;

    constructor(opts: NavGridOptions) {
        this.width = opts.width;
        this.height = opts.height;
        this.cellSize = opts.cellSize;
        this.originX = opts.origin?.x ?? 0;
        this.originY = opts.origin?.y ?? 0;
        this.originZ = opts.origin?.z ?? 0;

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
        if (!this.inBounds(gx, gy)) return false;
        const i = gy * this.width + gx;
        return this.walkable[i] === 1 && (this.obstructed_ === null || this.obstructed_[i] === 0);
    }

    setWalkable(gx: number, gy: number, walkable: boolean): void {
        if (!this.inBounds(gx, gy)) return;
        this.walkable[gy * this.width + gx] = walkable ? 1 : 0;
        this.clearance_ = null;
    }

    /**
     * Put something in the way of a cell, or take it out again. The map's own
     * walkability is untouched: an obstacle is a thing standing ON the ground, and
     * lifting it has to give back exactly the ground that was there.
     */
    setObstructed(gx: number, gy: number, obstructed: boolean): void {
        if (!this.inBounds(gx, gy)) return;
        if (!this.obstructed_) {
            if (!obstructed) return;
            this.obstructed_ = new Uint8Array(this.width * this.height);
        }
        this.obstructed_[gy * this.width + gx] = obstructed ? 1 : 0;
        this.clearance_ = null;
    }

    /** Lift everything off the ground at once, before the obstacles are re-marked. */
    clearObstructions(): void {
        if (!this.obstructed_) return;
        this.obstructed_.fill(0);
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

    /** Centre of cell `(gx, gy)` in world space. */
    cellToWorld(gx: number, gy: number): Vec3 {
        return {
            x: this.originX + gx * this.cellSize,
            y: this.originY + gy * this.cellSize,
            z: this.originZ,
        };
    }

    /** Cell containing a world point. May be out of bounds — caller checks. */
    worldToCell(p: NavPoint): Cell {
        return {
            x: Math.round((p.x - this.originX) / this.cellSize),
            y: Math.round((p.y - this.originY) / this.cellSize),
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

    findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): Vec3[] | null {
        const radius = opts?.radius ?? 0;
        const clearance = radius > 0 ? Math.ceil(radius / this.cellSize) : 0;
        const cells = findPath(this, this.worldToCell(from), this.worldToCell(to), { clearance });
        return cells ? pathToWorld(this, shortenPath(this, cells, clearance)) : null;
    }

    isNavigable(p: NavPoint): boolean {
        const cell = this.worldToCell(p);
        return this.isWalkable(cell.x, cell.y);
    }

    /**
     * Every walkable cell as a quad, and every edge where the walkable world
     * stops. The corner array is reused between calls — see {@link NavSurfaceSink}.
     */
    describe(sink: NavSurfaceSink): void {
        const h = this.cellSize / 2;
        const quad: Vec3[] = [
            { x: 0, y: 0, z: this.originZ }, { x: 0, y: 0, z: this.originZ },
            { x: 0, y: 0, z: this.originZ }, { x: 0, y: 0, z: this.originZ },
        ];
        const a: Vec3 = { x: 0, y: 0, z: this.originZ };
        const b: Vec3 = { x: 0, y: 0, z: this.originZ };

        for (let gy = 0; gy < this.height; gy++) {
            for (let gx = 0; gx < this.width; gx++) {
                if (!this.isWalkable(gx, gy)) continue;
                const cx = this.originX + gx * this.cellSize;
                const cy = this.originY + gy * this.cellSize;
                quad[0]!.x = cx - h; quad[0]!.y = cy - h;
                quad[1]!.x = cx + h; quad[1]!.y = cy - h;
                quad[2]!.x = cx + h; quad[2]!.y = cy + h;
                quad[3]!.x = cx - h; quad[3]!.y = cy + h;
                sink.face(quad);

                // The four sides that face something unwalkable — the outline of
                // where a route can go, which the faces alone do not show.
                for (let e = 0; e < 4; e++) {
                    const dx = e === 0 ? 1 : e === 2 ? -1 : 0;
                    const dy = e === 1 ? 1 : e === 3 ? -1 : 0;
                    if (this.isWalkable(gx + dx, gy + dy)) continue;
                    const p = quad[e]!;
                    const q = quad[(e + 1) % 4]!;
                    a.x = p.x; a.y = p.y;
                    b.x = q.x; b.y = q.y;
                    sink.border(a, b);
                }
            }
        }
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
