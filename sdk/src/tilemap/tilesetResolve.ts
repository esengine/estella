// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilesetResolve.ts
 * @brief   Derive the runtime tileset model from `.estileset` assets — LIVE.
 *
 * The unification keystone: a `.estileset` (atlas grid + per-tile collision /
 * animation) is the single source of truth. This turns one or more resolved
 * `.estileset`s into the SAME runtime model the Tiled importer produces — a
 * render table (`{firstId, textureHandle, columns}` per tileset), tile
 * animations, and collidable tile ids — with NO columns copied onto the layer
 * and NO collision baked at author-time. Edit the tileset, re-resolve, done.
 *
 * Tile ids are global and contiguous across tilesets (firstId[0]=1,
 * firstId[i]=firstId[i-1]+count[i-1]), matching the multi-tileset render table
 * (`TilesetTable`/`tilemap_setTilesets`) and the Tiled GID convention — so a
 * single TilemapLayer can mix tilesets and painted/imported maps converge.
 */
import type { TilesetAsset } from './tilesetAsset';

/** A `.estileset` parsed + its atlas texture loaded (handle resolved by the caller). */
export interface ResolvedTileset {
    asset: TilesetAsset;
    textureHandle: number;
}

/** One render-table slot: a tileset's global id base, atlas texture, and grid width. */
export interface TilesetModelSlot {
    firstId: number;
    textureHandle: number;
    columns: number;
}

/** The runtime tileset model derived from `.estileset`(s) — global tile-id space. */
export interface TilesetModel {
    /** Render table (sorted by firstId), fed to `tilemap_setTilesets`. */
    slots: TilesetModelSlot[];
    /** Animations keyed by GLOBAL tile id → frames (frame tile ids are global too). */
    animations: Map<number, { tileId: number; duration: number }[]>;
    /** Global tile ids with a BOX collision shape (greedy-merged at runtime; sorted). */
    collidableTileIds: number[];
    /**
     * Global tile id → polygon collision outline, points NORMALIZED to the tile
     * ([0,1], x right / y down). Emitted as one collider per placed tile (not merged).
     */
    polygonShapes: Map<number, [number, number][]>;
}

/** Tiles in a tileset: explicit `tileCount`, else the highest authored tile id. */
function tilesetCount(asset: TilesetAsset): number {
    if (typeof asset.tileCount === 'number' && asset.tileCount > 0) return asset.tileCount;
    let max = 0;
    for (const k of Object.keys(asset.tiles)) max = Math.max(max, Number(k));
    return max; // local ids are 1-based, so the max id == count of the spanned range
}

/**
 * Derive the runtime tileset model from resolved `.estileset`s. The per-tile
 * collision/animation metadata is read straight off each `.estileset` (live) and
 * re-keyed into the global id space.
 */
export function resolveTilesetModel(tilesets: ResolvedTileset[]): TilesetModel {
    const slots: TilesetModelSlot[] = [];
    const animations = new Map<number, { tileId: number; duration: number }[]>();
    const collidable: number[] = [];
    const polygonShapes = new Map<number, [number, number][]>();

    let firstId = 1;
    for (const { asset, textureHandle } of tilesets) {
        slots.push({ firstId, textureHandle, columns: asset.columns });
        const tw = asset.tileWidth || 1;
        const th = asset.tileHeight || 1;

        // Local tile ids are 1-based; global id = firstId + (localId - 1).
        for (const key of Object.keys(asset.tiles)) {
            const localId = Number(key);
            if (!Number.isInteger(localId) || localId <= 0) continue;
            const globalId = firstId + localId - 1;
            const tile = asset.tiles[localId];
            if (tile.collision?.type === 'polygon') {
                polygonShapes.set(globalId, tile.collision.points.map(([px, py]) => [px / tw, py / th]));
            } else if (tile.collision) {
                collidable.push(globalId);
            }
            if (tile.animation && tile.animation.length > 0) {
                animations.set(
                    globalId,
                    tile.animation.map((f) => ({
                        tileId: firstId + f.tile - 1,
                        duration: f.durationMs,
                    })),
                );
            }
        }

        firstId += Math.max(1, tilesetCount(asset));
    }

    collidable.sort((a, b) => a - b);
    return { slots, animations, collidableTileIds: collidable, polygonShapes };
}
