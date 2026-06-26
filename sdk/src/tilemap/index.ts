// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Tilemap, TilemapLayer, type TilemapData, type TilemapLayerData } from './components';
export { TilemapAPI, initTilemapAPI, shutdownTilemapAPI } from './tilemapAPI';
export { TilemapPlugin, tilemapPlugin } from './tilemapPlugin';
export {
    parseTiledMap, parseTmjJson, loadTiledMap, loadTiledCollisionObjects,
    generateTileCollision, generateLayerCollision, generateChunkCollision,
    generateChunkPolygonCollision, polygonLocalVerts, resolveRelativePath,
    type TiledMapData, type TiledLayerData, type TiledTilesetData,
    type TiledObjectData, type TiledObjectGroupData, type TiledObjectShape,
    type TiledAnimFrame, type TilemapLoadOptions,
} from './tiledLoader';
export { mergeCollisionTiles, type MergedRect } from './collisionMerge';
export { decodeTilemapChunks, CHUNK_SIZE, type DecodedChunk } from './chunkCodec';
export {
    TILE_ID_MASK, TILE_FLIP_H, TILE_FLIP_V, TILE_FLIP_D, TILE_FLAGS_MASK,
    encodeTile, tileIdOf, tileFlagsOf, orientationPerm,
    flipFlagsH, flipFlagsV, rotateFlagsCW, type TileFlags,
} from './tileBits';
export {
    singleStamp, isEmptyStamp, flipStampH, flipStampV, rotateStampCW, type TileStamp,
} from './tileStamp';
export {
    TILESET_FORMAT_VERSION, parseTileset, serializeTileset, createTileset, collidableTileIds,
    type TilesetAsset, type TilesetTile, type TilesetCollision, type TilesetAnimFrame,
    type TerrainMode, type TilesetTerrain, type TilesetTileTerrain,
} from './tilesetAsset';
export {
    resolveTilesetModel,
    type ResolvedTileset, type TilesetModel, type TilesetModelSlot,
} from './tilesetResolve';
export {
    TB_N, TB_E, TB_S, TB_W, TB_NE, TB_SE, TB_SW, TB_NW, TERRAIN_NEIGHBORS,
    normalizeCornerMask, canonicalMask, buildTerrainIndices, resolveAutotile,
    type TerrainIndex, type TerrainIndices,
} from './autotile';
export {
    registerTilemapSource, getTilemapSource, clearTilemapSourceCache,
    registerResolvedTileset, getResolvedTileset, clearResolvedTilesetCache,
    type LoadedTilemapSource, type LoadedTilemapLayer, type LoadedTilemapTileset,
} from './tilesetCache';
export { getTextureDimensions, type TextureDimensions } from '../resourceManager';
