// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    navGridFromTilemap.ts
 * @brief   Build a NavGrid from tilemap walkability.
 *
 * The core builder takes a raw `getTile(x,y)` reader so it stays wasm-free and
 * unit-testable; the convenience wrapper reads a live tilemap layer through
 * TilemapAPI. Cells are raw u16 (`tileId | flipBits`); the low 13 bits are the
 * tile id, matching `mergeCollisionTiles`.
 */

import type { Entity, Vec2 } from '../../types';
import { NavGrid } from './NavGrid';
import { TilemapAPI } from '../../tilemap/tilemapAPI';

/** Low 13 bits of a tilemap cell are the tile id; the top 3 are flip flags. */
const TILE_ID_MASK = 0x1fff;

export interface BuildNavGridOptions {
    width: number;
    height: number;
    /** World pixels per cell. */
    cellSize: number;
    /** World position of cell (0,0)'s center. */
    origin?: Vec2;
    /** Exact set of tile ids that block movement. Ignored if `isBlocked` is given. */
    blockedTileIds?: Iterable<number>;
    /**
     * Custom blocking predicate over the tile id (0 = empty). Overrides
     * `blockedTileIds`. Default: with `blockedTileIds` set, only those block;
     * otherwise any non-empty tile blocks (treats the layer as an obstacle map).
     */
    isBlocked?: (tileId: number) => boolean;
}

/** Build a NavGrid from a raw tile reader. `getTile(x,y)` returns a raw u16 cell. */
export function navGridFromTiles(
    getTile: (x: number, y: number) => number,
    opts: BuildNavGridOptions,
): NavGrid {
    const { width, height } = opts;
    const isBlocked = resolveBlocked(opts);
    const walkable = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tileId = getTile(x, y) & TILE_ID_MASK;
            walkable[y * width + x] = isBlocked(tileId) ? 0 : 1;
        }
    }
    return new NavGrid({ width, height, cellSize: opts.cellSize, origin: opts.origin, walkable });
}

/**
 * Build a NavGrid from a live tilemap layer entity via TilemapAPI.
 *
 * A tilemap's row 0 is its top and a NavGrid's cell 0 its bottom, so the row is
 * flipped here — no `origin` could correct that mirroring. `origin` keeps its
 * usual meaning: the world centre of the BOTTOM-left cell.
 */
export function navGridFromTilemapLayer(entity: Entity, opts: BuildNavGridOptions): NavGrid {
    return navGridFromTiles((x, y) => TilemapAPI.getTile(entity, x, opts.height - 1 - y), opts);
}

function resolveBlocked(opts: BuildNavGridOptions): (tileId: number) => boolean {
    if (opts.isBlocked) return opts.isBlocked;
    if (opts.blockedTileIds) {
        const set = new Set<number>(opts.blockedTileIds);
        return tileId => set.has(tileId);
    }
    return tileId => tileId !== 0;
}
