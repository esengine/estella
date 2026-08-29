// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ResolvedTileset, ResolvedTileCollision } from './tilesetResolve';
import type { TiledObjectGroupData } from './tiledLoader';
import type { AssetsData } from '../asset/AssetPlugin';

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
     * Tiled object layers — spawn/marker data queryable by gameplay through the
     * app's Assets; groups marked per `isCollisionObjectGroup` also spawn static
     * colliders in play mode.
     */
    objectGroups?: TiledObjectGroupData[];
}



/** One era of a `.tmj` as its realm publishes it. */
export interface PublishedTilemap {
    source: LoadedTilemapSource;
}

/** One era of a `.estileset` as its realm publishes it. */
export interface PublishedTileset {
    resolved: ResolvedTileset;
}

/**
 * The map `ref` names in this realm — object groups, tile properties, collision
 * ids, the parsed layers.
 *
 * Takes the Assets to ask: a map belongs to the realm that loaded it, and an
 * editor world beside a play world is two of them.
 */
export function tilemapSource(
    assets: AssetsData | null | undefined, ref: string,
): LoadedTilemapSource | undefined {
    return assets?.resolveRegistryAsset<PublishedTilemap>('tilemap', ref)?.source;
}

/** The tileset `ref` names in this realm: the parsed asset plus its atlas. */
export function resolvedTileset(
    assets: AssetsData | null | undefined, ref: string,
): ResolvedTileset | undefined {
    return assets?.resolveRegistryAsset<PublishedTileset>('tileset', ref)?.resolved;
}
