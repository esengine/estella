// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TilemapBindings.hpp
 * @brief   The tilemap entry points the SDK drives layers through.
 * @details Declared here rather than only defined in the .cpp for the reason every
 *          other binding header exists: the declaration is the single source both
 *          registration layers are generated from — embind for the web
 *          (WebSDKEntry.cpp) and QuickJS wrappers for a native host
 *          (`eht --native-functions`). While these lived only in the .cpp, a device
 *          build had no tilemaps at all.
 *
 *          Addressing: a "layer" is an entity. Tile arrays cross as an offset into
 *          the heap the caller marshals through (wasm linear memory on the web, the
 *          host arena on a device) plus a count, validated by `BoundarySpan`.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#ifdef ES_ENABLE_TILEMAP

#include "../core/Types.hpp"

#include <cstdint>
#include <string>

namespace esengine {

// — Layer lifecycle —

void tilemap_initLayer(u32 entity, u32 width, u32 height, f32 tileWidth, f32 tileHeight);
void tilemap_initInfinite(u32 entity, f32 tileWidth, f32 tileHeight);
void tilemap_initInfiniteLayer(u32 entity, f32 tileWidth, f32 tileHeight);
void tilemap_destroyLayer(u32 entity);
bool tilemap_hasLayer(u32 entity);

// — Tiles —

void tilemap_setTile(u32 entity, i32 x, i32 y, u32 tileId);
u32 tilemap_getTile(u32 entity, i32 x, i32 y);
void tilemap_fillRect(u32 entity, i32 x, i32 y, u32 w, u32 h, u32 tileId);
void tilemap_setTiles(u32 entity, uintptr_t tilesPtr, u32 count);
void tilemap_setChunkTiles(u32 entity, i32 chunkX, i32 chunkY,
                           uintptr_t tilesPtr, u32 width, u32 height);
void tilemap_flipTile(u32 entity, i32 x, i32 y, bool flipH, bool flipV, bool flipD);
void tilemap_rotateTile(u32 entity, i32 x, i32 y, i32 degrees);

// — Rendering —

void tilemap_setTilesets(u32 entity, uintptr_t dataPtr, u32 count);
void tilemap_setRenderProps(u32 entity, u32 textureHandle, u32 tilesetColumns,
                            f32 uvTileW, f32 uvTileH,
                            i32 sortLayer, f32 depth,
                            f32 parallaxX, f32 parallaxY);
void tilemap_setTint(u32 entity, f32 r, f32 g, f32 b, f32 a, f32 opacity);
void tilemap_setVisible(u32 entity, bool visible);
void tilemap_setOriginEntity(u32 layerKey, u32 originEntity);

// — Grid shape (orthogonal / isometric / staggered / hexagonal) —

void tilemap_setGridType(u32 entity, u32 type);
void tilemap_setHexParams(u32 entity, f32 sideLength, u32 staggerAxisX, u32 staggerIndexEven);

// Both answer a pair of floats in a shared static buffer, so the offset is stable
// and the byte count is fixed.
// @heapreturn 2 * sizeof(float)
uintptr_t tilemap_tileToWorld(u32 entity, i32 tx, i32 ty, f32 originX, f32 originY);
// @heapreturn 2 * sizeof(float)
uintptr_t tilemap_worldToTile(u32 entity, f32 wx, f32 wy, f32 originX, f32 originY);

// — Animated tiles —

void tilemap_setTileAnimation(u32 entity, u32 tileId, uintptr_t framesPtr, u32 frameCount);
void tilemap_clearTileAnimations(u32 entity);
void tilemap_advanceAnimations(u32 entity, f32 dtMs);

// — Tile properties + chunk serialization (the editor's tools and .estileset) —

void tilemap_setTileProperty(u32 entity, u32 tileId,
                             const std::string& key, const std::string& value);
std::string tilemap_getTileProperty(u32 entity, i32 x, i32 y, const std::string& key);
std::string tilemap_exportChunks(u32 entity);
bool tilemap_importChunks(u32 entity, const std::string& encoded);

}  // namespace esengine

#endif  // ES_ENABLE_TILEMAP
