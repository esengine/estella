// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    tilesetAsset.ts
 * @brief   The `.estileset` tileset-palette asset — atlas slicing + per-tile behaviour.
 *          The reusable asset the Tileset editor authors and the
 *          single source of truth for how a tile looks (atlas grid) AND behaves (collision
 *          shape / animation / properties). Tilemaps reference it; collision is derived from
 *          it at runtime, so editing the tileset updates every map.
 *
 * Mirrors the `.esanim` format seam (`AnimationClip.ts`): one in-memory model
 * ({@link TilesetAsset}), a structure-tolerant {@link parseTileset}, and a clean
 * {@link serializeTileset} so `parse(serialize(x))` round-trips. The schema is
 * deliberately extensible — terrain/autotile (wang/rule) rules and physics-layer/one-way
 * flags slot onto tiles later without a version break.
 */

/** The current `.estileset` format version. */
export const TILESET_FORMAT_VERSION = '1';

/**
 * A tile's collision shape. `box` = the full cell AABB (greedy-merged at runtime);
 * `polygon` = custom points in tile-local pixels (origin top-left, y-down like the atlas),
 * for slopes / partial tiles. Absence of `collision` on a tile = no collision.
 */
export type TilesetCollision =
    | { type: 'box' }
    | { type: 'polygon'; points: [number, number][] };

/** One animation frame: show tile `tile` for `durationMs` milliseconds. */
export interface TilesetAnimFrame {
    tile: number;
    durationMs: number;
}

/** Per-tile metadata. Sparse — only tiles that carry any of these appear in the map. */
export interface TilesetTile {
    collision?: TilesetCollision;
    properties?: Record<string, string>;
    animation?: TilesetAnimFrame[];
}

/** A reusable tileset palette asset (`.estileset`). */
export interface TilesetAsset {
    version: string;
    /** `@uuid:` ref to the atlas texture. */
    texture: string;
    tileWidth: number;
    tileHeight: number;
    /** Tiles per atlas row. */
    columns: number;
    /** Border (px) inside the atlas before the first tile. */
    margin: number;
    /** Gap (px) between adjacent tiles. */
    spacing: number;
    /** Total tile count (optional; otherwise derived from the texture + grid). */
    tileCount?: number;
    /** Per-tile metadata keyed by tile id (1-based; id 0 = empty). */
    tiles: Record<number, TilesetTile>;
}

function posInt(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function nonNeg(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function normalizeCollision(raw: any): TilesetCollision | undefined {
    if (raw === true) return { type: 'box' };          // legacy / Tiled-style boolean flag
    if (!raw || typeof raw !== 'object') return undefined;
    if (raw.type === 'polygon' && Array.isArray(raw.points)) {
        const points = raw.points
            .filter((p: any) => Array.isArray(p) && p.length >= 2
                && typeof p[0] === 'number' && typeof p[1] === 'number')
            .map((p: any) => [p[0], p[1]] as [number, number]);
        return points.length >= 3 ? { type: 'polygon', points } : undefined;
    }
    // Any other truthy collision (incl. `{type:'box'}` or a legacy `true`) = a full-cell box.
    return { type: 'box' };
}

/** Parse arbitrary JSON into a normalized {@link TilesetAsset} (tolerant of missing fields). */
export function parseTileset(raw: any): TilesetAsset {
    const tiles: Record<number, TilesetTile> = {};
    const rawTiles = (raw && typeof raw.tiles === 'object' && raw.tiles) || {};
    for (const key of Object.keys(rawTiles)) {
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0) continue;
        const t = rawTiles[key] ?? {};
        const tile: TilesetTile = {};
        const collision = normalizeCollision(t.collision);
        if (collision) tile.collision = collision;
        if (t.properties && typeof t.properties === 'object') {
            tile.properties = {};
            for (const k of Object.keys(t.properties)) tile.properties[k] = String(t.properties[k]);
        }
        if (Array.isArray(t.animation)) {
            const frames = t.animation
                .filter((f: any) => f && Number.isInteger(f.tile))
                .map((f: any) => ({ tile: f.tile, durationMs: nonNeg(f.durationMs, 100) }));
            if (frames.length > 0) tile.animation = frames;
        }
        if (tile.collision || tile.properties || tile.animation) tiles[id] = tile;
    }
    return {
        version: typeof raw?.version === 'string' ? raw.version : TILESET_FORMAT_VERSION,
        texture: typeof raw?.texture === 'string' ? raw.texture : '',
        tileWidth: posInt(raw?.tileWidth, 16),
        tileHeight: posInt(raw?.tileHeight, 16),
        columns: posInt(raw?.columns, 1),
        margin: nonNeg(raw?.margin, 0),
        spacing: nonNeg(raw?.spacing, 0),
        tileCount: Number.isInteger(raw?.tileCount) ? raw.tileCount : undefined,
        tiles,
    };
}

/** Serialize a {@link TilesetAsset} to a plain JSON-ready object (drops empty/undefined). */
export function serializeTileset(asset: TilesetAsset): Record<string, unknown> {
    const tiles: Record<string, TilesetTile> = {};
    for (const id of Object.keys(asset.tiles)) tiles[id] = asset.tiles[Number(id)];
    const out: Record<string, unknown> = {
        version: asset.version || TILESET_FORMAT_VERSION,
        texture: asset.texture,
        tileWidth: asset.tileWidth,
        tileHeight: asset.tileHeight,
        columns: asset.columns,
        margin: asset.margin,
        spacing: asset.spacing,
        tiles,
    };
    if (asset.tileCount !== undefined) out.tileCount = asset.tileCount;
    return out;
}

/** A fresh tileset over a texture (no per-tile metadata yet). */
export function createTileset(
    texture: string, tileWidth = 16, tileHeight = 16, columns = 1,
): TilesetAsset {
    return {
        version: TILESET_FORMAT_VERSION,
        texture, tileWidth, tileHeight, columns,
        margin: 0, spacing: 0, tiles: {},
    };
}

/**
 * The tile ids flagged collidable — feeds `generateLayerCollision` (the box-merge set) and
 * the Tiled-style `collisionTileIds`. Polygon tiles are included (their custom shape is
 * emitted separately at collider-build time).
 */
export function collidableTileIds(asset: TilesetAsset): number[] {
    return Object.keys(asset.tiles)
        .map(Number)
        .filter((id) => asset.tiles[id].collision !== undefined)
        .sort((a, b) => a - b);
}
