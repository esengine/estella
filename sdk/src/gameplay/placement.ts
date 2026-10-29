// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  placement.ts
 * @brief The questions a build mode asks while a finger drags something over the ground: which cell is this, where does it sit snapped, and may it stand there.
 *
 * @details Three pure pieces and no system. {@link snapToGrid} and {@link snapFootprint} turn a free point into the place a thing of a given size sits on a grid
 *          (a 3 by 1 wall centres on the middle of its middle cell, a 2 by 2 table on a corner). {@link checkPlacement} says whether that place is clear: no
 *          collider of the physics world in it, no solid tile under it, nothing the game's own occupancy says is there, and it names what is in the way. What
 *          follows the finger (a ghost sprite), what it is tinted, what may be placed on what, and what a confirmed placement does are the game's: the
 *          engine answers the question each frame and the game draws the answer.
 *
 *          The probes are handed in rather than looked up, so a game that has no physics, or no tilemap, or keeps its buildings in its own table, passes the
 *          ones it has, and this module pulls in none of them.
 */
import type { Entity } from '../types';

/** A grid the world is built on: the size of one cell, and where the corner of cell (0, 0) lies. */
export interface PlacementGrid {
    cellWidth: number;
    cellHeight: number;
    originX?: number;
    originY?: number;
}

/** One cell of a grid, by column and row. */
export interface GridCell {
    col: number;
    row: number;
}

/** A rectangle in the world. */
export interface PlacementRect {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

/** The cell a world point falls in. */
export function gridCellAt(grid: PlacementGrid, x: number, y: number): GridCell {
    return {
        col: Math.floor((x - (grid.originX ?? 0)) / grid.cellWidth),
        row: Math.floor((y - (grid.originY ?? 0)) / grid.cellHeight),
    };
}

/** The middle of a cell, in the world. */
export function gridCellCentre(grid: PlacementGrid, col: number, row: number): { x: number; y: number } {
    return {
        x: (grid.originX ?? 0) + (col + 0.5) * grid.cellWidth,
        y: (grid.originY ?? 0) + (row + 0.5) * grid.cellHeight,
    };
}

/** The point snapped to the middle of the cell it is in (`'centre'`, the default) or to the nearest cell corner (`'corner'`). */
export function snapToGrid(grid: PlacementGrid, x: number, y: number, mode: 'centre' | 'corner' = 'centre'): { x: number; y: number; col: number; row: number } {
    if (mode === 'corner') {
        const col = Math.round((x - (grid.originX ?? 0)) / grid.cellWidth);
        const row = Math.round((y - (grid.originY ?? 0)) / grid.cellHeight);
        return { x: (grid.originX ?? 0) + col * grid.cellWidth, y: (grid.originY ?? 0) + row * grid.cellHeight, col, row };
    }
    const cell = gridCellAt(grid, x, y);
    const centre = gridCellCentre(grid, cell.col, cell.row);
    return { x: centre.x, y: centre.y, ...cell };
}

/** Where a thing `cols` by `rows` cells big sits when its middle is dragged to a point: snapped so it covers whole cells. */
export interface SnappedFootprint {
    /** The middle of the footprint, in the world: where the ghost is drawn. */
    x: number;
    y: number;
    /** The lowest cell it covers, and how many it covers each way. */
    col: number;
    row: number;
    cols: number;
    rows: number;
    rect: PlacementRect;
}

/**
 * Snaps a footprint of `cols` by `rows` cells to the grid by its middle: an odd count centres on a cell, an even one on a cell corner, each way on its own, so
 * the footprint always covers whole cells and the finger stays in the middle of it.
 */
export function snapFootprint(grid: PlacementGrid, x: number, y: number, cols: number, rows: number): SnappedFootprint {
    const c = Math.max(Math.round(cols), 1), r = Math.max(Math.round(rows), 1);
    const gx = (x - (grid.originX ?? 0)) / grid.cellWidth, gy = (y - (grid.originY ?? 0)) / grid.cellHeight;
    // The footprint's lowest cell: its middle is half its size above it, and snapping the middle to whole or half cells is snapping this to whole cells.
    const col = Math.round(gx - c / 2), row = Math.round(gy - r / 2);
    const minX = (grid.originX ?? 0) + col * grid.cellWidth, minY = (grid.originY ?? 0) + row * grid.cellHeight;
    const maxX = minX + c * grid.cellWidth, maxY = minY + r * grid.cellHeight;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, col, row, cols: c, rows: r, rect: { minX, minY, maxX, maxY } };
}

/** What a placement is checked against. Each is optional; a probe not given blocks nothing. */
export interface PlacementProbes {
    /** The physics world: anything whose collider overlaps the footprint is in the way. */
    physics?: { overlapAABB(min: { x: number; y: number }, max: { x: number; y: number }, maskBits?: number): Entity[] };
    /** The collision layers the physics query asks about (all of them, by default). */
    mask?: number;
    /** Whether the ground at a world point is solid, as the game's tilemap says (`(x, y) => isTileSolid(...)`): a solid tile under any sampled point blocks. */
    solidAt?(x: number, y: number): boolean;
    /** The spacing of the points a cell is sampled at for `solidAt`, in world units (default a quarter of the smaller cell side): a solid tile narrower than this can slip between them. */
    solidStep?: number;
    /** Whether the game's own table says a cell is taken (a building already there, a zone it forbids). */
    blocked?(col: number, row: number): boolean;
    /** Entities that do not count as in the way: the thing being placed itself, and what it may stand among. */
    ignore?: ReadonlySet<Entity>;
}

/** What is in the way of a placement, or that nothing is. */
export interface PlacementCheck {
    clear: boolean;
    /** The colliders in the footprint, as the physics world lists them. */
    blockers: Entity[];
    /** The cells the tilemap or the game's table says are taken, by cell of the footprint. */
    blockedCells: GridCell[];
}

/**
 * Whether a snapped footprint may stand where it is. The physics probe is asked once, with the footprint's rectangle shrunk a hair so a wall that
 * only touches its edge is not in the way; the tilemap is sampled on a lattice over each cell it covers (every `solidStep`, a quarter of a cell by default);
 * the game's table is asked of every cell.
 */
export function checkPlacement(grid: PlacementGrid, footprint: SnappedFootprint, probes: PlacementProbes = {}): PlacementCheck {
    const blockedCells: GridCell[] = [];
    const inset = Math.min(grid.cellWidth, grid.cellHeight) * 0.02;
    const step = Math.max(probes.solidStep ?? Math.min(grid.cellWidth, grid.cellHeight) / 4, 1e-3);
    for (let r = 0; r < footprint.rows; r++) {
        for (let c = 0; c < footprint.cols; c++) {
            const col = footprint.col + c, row = footprint.row + r;
            let blocked = probes.blocked?.(col, row) === true;
            if (!blocked && probes.solidAt) {
                const x0 = (grid.originX ?? 0) + col * grid.cellWidth, y0 = (grid.originY ?? 0) + row * grid.cellHeight;
                const nx = Math.max(Math.ceil(grid.cellWidth / step), 1), ny = Math.max(Math.ceil(grid.cellHeight / step), 1);
                search: for (let j = 0; j < ny; j++) {
                    for (let i = 0; i < nx; i++) {
                        if (probes.solidAt((x0 + (i + 0.5) * grid.cellWidth / nx), (y0 + (j + 0.5) * grid.cellHeight / ny))) { blocked = true; break search; }
                    }
                }
            }
            if (blocked) blockedCells.push({ col, row });
        }
    }
    let blockers: Entity[] = [];
    if (probes.physics) {
        const r = footprint.rect;
        const hit = probes.physics.overlapAABB({ x: r.minX + inset, y: r.minY + inset }, { x: r.maxX - inset, y: r.maxY - inset }, probes.mask);
        blockers = hit.filter((entity) => !probes.ignore?.has(entity));
    }
    return { clear: blockers.length === 0 && blockedCells.length === 0, blockers, blockedCells };
}
