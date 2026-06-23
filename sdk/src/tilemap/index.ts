// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Tilemap, TilemapLayer, type TilemapData, type TilemapLayerData } from './components';
export { TilemapAPI, initTilemapAPI, shutdownTilemapAPI } from './tilemapAPI';
export { TilemapPlugin, tilemapPlugin } from './tilemapPlugin';
export {
    parseTiledMap, parseTmjJson, loadTiledMap, loadTiledCollisionObjects,
    generateTileCollision, generateLayerCollision, resolveRelativePath,
    type TiledMapData, type TiledLayerData, type TiledTilesetData,
    type TiledObjectData, type TiledObjectGroupData, type TiledObjectShape,
    type TiledAnimFrame, type TilemapLoadOptions,
} from './tiledLoader';
export { mergeCollisionTiles, type MergedRect } from './collisionMerge';
export {
    TILESET_FORMAT_VERSION, parseTileset, serializeTileset, createTileset, collidableTileIds,
    type TilesetAsset, type TilesetTile, type TilesetCollision, type TilesetAnimFrame,
} from './tilesetAsset';
export {
    registerTilemapSource, getTilemapSource, clearTilemapSourceCache,
    type LoadedTilemapSource, type LoadedTilemapLayer, type LoadedTilemapTileset,
} from './tilesetCache';
export { getTextureDimensions, type TextureDimensions } from '../resourceManager';
