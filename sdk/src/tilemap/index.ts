// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Tilemap, TilemapLayer, type TilemapData, type TilemapLayerData } from './components';
export { TilemapAPI, initTilemapAPI, shutdownTilemapAPI } from './tilemapAPI';
export { TilemapPlugin, tilemapPlugin } from './tilemapPlugin';
export {
    parseTiledMap, parseTmjJson, loadTiledMap, loadTiledCollisionObjects,
    generateTileCollision, generateLayerCollision, generateChunkCollision, resolveRelativePath,
    type TiledMapData, type TiledLayerData, type TiledTilesetData,
    type TiledObjectData, type TiledObjectGroupData, type TiledObjectShape,
    type TiledAnimFrame, type TilemapLoadOptions,
} from './tiledLoader';
export { mergeCollisionTiles, type MergedRect } from './collisionMerge';
export { decodeTilemapChunks, CHUNK_SIZE, type DecodedChunk } from './chunkCodec';
export {
    TILESET_FORMAT_VERSION, parseTileset, serializeTileset, createTileset, collidableTileIds,
    type TilesetAsset, type TilesetTile, type TilesetCollision, type TilesetAnimFrame,
} from './tilesetAsset';
export {
    resolveTilesetModel,
    type ResolvedTileset, type TilesetModel, type TilesetModelSlot,
} from './tilesetResolve';
export {
    registerTilemapSource, getTilemapSource, clearTilemapSourceCache,
    registerResolvedTileset, getResolvedTileset, clearResolvedTilesetCache,
    type LoadedTilemapSource, type LoadedTilemapLayer, type LoadedTilemapTileset,
} from './tilesetCache';
export { getTextureDimensions, type TextureDimensions } from '../resourceManager';
