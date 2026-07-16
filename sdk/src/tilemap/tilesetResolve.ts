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
import type { TilesetAsset, TilesetCollision } from './tilesetAsset';

/** A `.estileset` parsed + its atlas texture loaded (handle resolved by the caller). */
export interface ResolvedTileset {
    asset: TilesetAsset;
    textureHandle: number;
    /** Atlas texture pixel size, when known — lets the tile count (and thus the
     *  multi-tileset firstId span) be derived from the grid without an explicit
     *  `tileCount` on the asset. */
    textureWidth?: number;
    textureHeight?: number;
}

/** One render-table slot: a tileset's global id base, atlas texture, and grid width. */
export interface TilesetModelSlot {
    firstId: number;
    textureHandle: number;
    columns: number;
}

/**
 * A tile's collision resolved into normalized ([0,1], x right / y down) tile space, ready
 * to spawn one collider per placed cell. Shapes that a plain-box greedy-merge can't
 * represent — polygon, circle, or a box carrying one-way / sensor / material — land here.
 */
export interface ResolvedTileCollision {
    shape:
        | { type: 'box' }
        | { type: 'polygon'; points: [number, number][] }
        | { type: 'circle'; cx: number; cy: number; r: number };
    /** Solid-side normal (world y-up; {0,1} = solid-top) of a one-way platform, if any. */
    oneWay?: { nx: number; ny: number };
    sensor?: boolean;
    density?: number;
    friction?: number;
    restitution?: number;
}

/** The runtime tileset model derived from `.estileset`(s) — global tile-id space. */
export interface TilesetModel {
    /** Render table (sorted by firstId), fed to `tilemap_setTilesets`. */
    slots: TilesetModelSlot[];
    /** Animations keyed by GLOBAL tile id → frames (frame tile ids are global too). */
    animations: Map<number, { tileId: number; duration: number }[]>;
    /**
     * Global tile ids that are a PLAIN solid box (default material, no one-way / sensor) —
     * the only tiles a greedy rectangle merge may fuse. Sorted.
     */
    collidableTileIds: number[];
    /**
     * Global tile id → its resolved collision, for tiles that spawn ONE collider each
     * (polygon / circle / a box with a one-way, sensor, or material modifier). Kept
     * separate from {@link collidableTileIds} so the fast merge path stays correctness-safe.
     */
    tileShapes: Map<number, ResolvedTileCollision>;
}

/** True for a tile the greedy box merge may fuse: a bare solid box, no modifiers. */
function isPlainBox(c: TilesetCollision): boolean {
    return c.type === 'box' && !c.oneWay && !c.sensor
        && c.density === undefined && c.friction === undefined && c.restitution === undefined;
}

/** Resolve a tile's collision into normalized tile space (radius as a tile-width fraction). */
function resolveTileCollision(c: TilesetCollision, tw: number, th: number): ResolvedTileCollision {
    let shape: ResolvedTileCollision['shape'];
    if (c.type === 'polygon') {
        shape = { type: 'polygon', points: c.points.map(([px, py]) => [px / tw, py / th]) };
    } else if (c.type === 'circle') {
        shape = { type: 'circle', cx: c.cx / tw, cy: c.cy / th, r: c.r / tw };
    } else {
        shape = { type: 'box' };
    }
    const out: ResolvedTileCollision = { shape };
    if (c.oneWay) out.oneWay = c.oneWay;
    if (c.sensor) out.sensor = true;
    if (c.density !== undefined) out.density = c.density;
    if (c.friction !== undefined) out.friction = c.friction;
    if (c.restitution !== undefined) out.restitution = c.restitution;
    return out;
}

/**
 * Tiles in a tileset — the span its global ids occupy. Explicit `tileCount` wins;
 * else derive `columns × rows` from the atlas texture height (the correct span for
 * a full grid, so multiple tilesets get non-overlapping firstId ranges); else fall
 * back to the highest authored tile id (single-tileset maps never hit the collision).
 */
function tilesetCount(asset: TilesetAsset, textureHeight?: number): number {
    if (typeof asset.tileCount === 'number' && asset.tileCount > 0) return asset.tileCount;
    if (typeof textureHeight === 'number' && textureHeight > 0) {
        const th = asset.tileHeight || 1;
        const m = asset.margin || 0;
        const sp = asset.spacing || 0;
        const rows = Math.max(1, Math.floor((textureHeight - 2 * m + sp) / (th + sp)));
        return Math.max(1, asset.columns * rows);
    }
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
    const tileShapes = new Map<number, ResolvedTileCollision>();

    let firstId = 1;
    for (const { asset, textureHandle, textureHeight } of tilesets) {
        slots.push({ firstId, textureHandle, columns: asset.columns });
        const tw = asset.tileWidth || 1;
        const th = asset.tileHeight || 1;

        // Local tile ids are 1-based; global id = firstId + (localId - 1).
        for (const key of Object.keys(asset.tiles)) {
            const localId = Number(key);
            if (!Number.isInteger(localId) || localId <= 0) continue;
            const globalId = firstId + localId - 1;
            const tile = asset.tiles[localId];
            if (tile.collision) {
                // Plain solid boxes greedy-merge; everything richer spawns per-tile.
                if (isPlainBox(tile.collision)) collidable.push(globalId);
                else tileShapes.set(globalId, resolveTileCollision(tile.collision, tw, th));
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

        firstId += Math.max(1, tilesetCount(asset, textureHeight));
    }

    collidable.sort((a, b) => a - b);
    return { slots, animations, collidableTileIds: collidable, tileShapes };
}
