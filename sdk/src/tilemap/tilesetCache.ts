// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ResolvedTileset, ResolvedTileCollision } from './tilesetResolve';
import type { TiledObjectGroupData } from './tiledLoader';

export interface LoadedTilemapChunk {
    x: number;
    y: number;
    width: number;
    height: number;
    tiles: Uint16Array;
}

export interface LoadedTilemapLayer {
    name: string;
    width: number;
    height: number;
    tiles: Uint16Array;
    chunks: LoadedTilemapChunk[];
    infinite: boolean;
}

export interface LoadedTilemapTileset {
    textureHandle: number;
    columns: number;
    /** Tile rows (= ceil(tileCount / columns)); with columns it gives the normalized
     *  UV cell size (1/columns × 1/rows) for tile (GID) objects. */
    rows: number;
    firstId: number;   // global tile-id at which this tileset begins (Tiled firstgid)
    /** Atlas border before the first tile, and gap between tiles (px, Tiled). */
    margin: number;
    spacing: number;
}

export interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    orientation?: string;
    /** Hexagonal maps: Tiled's hexsidelength / staggeraxis / staggerindex. */
    hexSideLength?: number;
    staggerAxis?: string;
    staggerIndex?: string;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
    tileAnimations?: Map<number, { tileId: number; duration: number }[]>;
    tileProperties?: Map<number, Map<string, string>>;
    /** Tile ids flagged collidable (a `collision=true` tile property). Drives runtime collider generation. */
    collisionTileIds?: number[];
    /** Rich per-tile collision (Tiled collision editor / modifier properties) — see TiledMapData.tileShapes. */
    tileShapes?: Map<number, ResolvedTileCollision>;
    /**
     * Tiled object layers — spawn/marker data queryable by gameplay via
     * `getTilemapSource`; groups marked per `isCollisionObjectGroup` also spawn
     * static colliders in play mode.
     */
    objectGroups?: TiledObjectGroupData[];
}

const tilemapCache_ = new Map<string, LoadedTilemapSource>();

export function registerTilemapSource(path: string, data: LoadedTilemapSource): void {
    tilemapCache_.set(path, data);
}

export function getTilemapSource(path: string): LoadedTilemapSource | undefined {
    return tilemapCache_.get(path);
}

/** Drop one source (hot reload: the `.tmj` changed on disk). The tilemap sync
 *  notices the entry vanish and tears the derived layers down; the reload
 *  registers fresh data and they re-derive. Returns true if the path was held. */
export function unregisterTilemapSource(path: string): boolean {
    return tilemapCache_.delete(path);
}

export function clearTilemapSourceCache(): void {
    tilemapCache_.clear();
}

// — Resolved `.estileset` tilesets (parsed asset + loaded atlas texture) —
// The runtime tileset loader registers here; the tilemap sync resolves a layer's
// tileset(s) into the render table + collision + animations LIVE off these (no
// columns copied onto the layer, no collision baked at author-time).
const resolvedTilesetCache_ = new Map<string, ResolvedTileset>();

export function registerResolvedTileset(path: string, data: ResolvedTileset): void {
    resolvedTilesetCache_.set(path, data);
}

export function getResolvedTileset(path: string): ResolvedTileset | undefined {
    return resolvedTilesetCache_.get(path);
}

export function clearResolvedTilesetCache(): void {
    resolvedTilesetCache_.clear();
}
