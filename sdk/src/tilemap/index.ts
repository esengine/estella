// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export { Tilemap, TilemapLayer, type TilemapData, type TilemapLayerData } from './components';
export { TilemapAPI, Tilemaps, initTilemapAPI, shutdownTilemapAPI } from './tilemapAPI';
export { TilemapLiveSync, type ApplyTilesetRefs } from './tilemapLiveSync';
export { TilemapPlugin, tilemapPlugin } from './tilemapPlugin';
export {
    parseTmjJson, parseTmjWithExternals, loadTiledMap, loadTiledCollisionObjects,
    generateTileCollision, generateLayerCollision, generateChunkCollision,
    generateChunkPolygonCollision, generateChunkTileShapes, generateLayerTileShapes,
    tiledObjectgroupShape, tiledCollisionMods, generateObjectCollision, spawnObjectRegion, isCollisionObjectGroup,
    polygonLocalVerts, tileColliderShape, oneWayNormalWorld, resolveRelativePath, packCollectionGrid,
    type TiledMapData, type TiledLayerData, type TiledTilesetData,
    type TiledCollectionTile, type CollectionGridTile,
    type TiledObjectData, type TiledObjectGroupData, type TiledObjectShape,
    type TiledAnimFrame, type TilemapLoadOptions,
} from './tiledLoader';
export { tileCollisionOutlines, type TileCollisionPiece } from './tileCollisionOutline';
export {
    COLLISION_PALETTE_REF, COLLISION_BRUSHES, isCollisionPaletteRef, buildCollisionPaletteModel,
    parseCollisionMaterial, collisionRefWithMaterial,
    type CollisionBrush, type CollisionMaterial,
} from './collisionPalette';
export {
    tileCellCenter, tileCellOutline, isNonOrthogonal, usesStagger, isHexOrientation, TileOrientation,
    type TileGridParams, type Vec2Like,
} from './tileGeometry';
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
    type TilesetAsset, type TilesetTile, type TilesetCollision, type TileCollisionShape, type TilesetAnimFrame,
    type TerrainMode, type TerrainColor, type TilesetTerrain, type TilesetTileTerrain,
} from './tilesetAsset';
export {
    resolveTilesetModel,
    type ResolvedTileset, type TilesetModel, type TilesetModelSlot, type ResolvedTileCollision,
} from './tilesetResolve';
export {
    TB_N, TB_E, TB_S, TB_W, TB_NE, TB_SE, TB_SW, TB_NW, TERRAIN_NEIGHBORS,
    normalizeCornerMask, canonicalMask, buildTerrainIndices, resolveAutotile,
    packCorners, buildWangIndices, resolveWang,
    type TerrainIndex, type TerrainIndices, type WangIndex, type WangIndices,
} from './autotile';
export {
    registerTilemapSource, getTilemapSource, clearTilemapSourceCache,
    registerResolvedTileset, getResolvedTileset, clearResolvedTilesetCache,
    type LoadedTilemapSource, type LoadedTilemapLayer, type LoadedTilemapTileset,
} from './tilesetCache';
export { getTextureDimensions, type TextureDimensions } from '../resourceManager';

export {
    tileCollisionAt, isTileSolid, tileCollisionAtWorld,
    type LayerCollisionTable,
} from './tileQuery';
