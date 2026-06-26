// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ResolvedTileset } from './tilesetResolve';

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
    firstId: number;   // global tile-id at which this tileset begins (Tiled firstgid)
}

export interface LoadedTilemapSource {
    tileWidth: number;
    tileHeight: number;
    orientation?: string;
    layers: LoadedTilemapLayer[];
    tilesets: LoadedTilemapTileset[];
    tileAnimations?: Map<number, { tileId: number; duration: number }[]>;
    tileProperties?: Map<number, Map<string, string>>;
    /** Tile ids flagged collidable (a `collision=true` tile property). Drives runtime collider generation. */
    collisionTileIds?: number[];
}

const tilemapCache_ = new Map<string, LoadedTilemapSource>();

export function registerTilemapSource(path: string, data: LoadedTilemapSource): void {
    tilemapCache_.set(path, data);
}

export function getTilemapSource(path: string): LoadedTilemapSource | undefined {
    return tilemapCache_.get(path);
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
