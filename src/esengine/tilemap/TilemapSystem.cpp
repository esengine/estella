// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TilemapSystem.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace esengine::tilemap {

TileRange computeVisibleRange(f32 camLeft, f32 camBottom, f32 camRight, f32 camTop,
                              f32 originX, f32 originY,
                              f32 tileWidth, f32 tileHeight,
                              u32 mapWidth, u32 mapHeight) {
    f32 localLeft = camLeft - originX;
    f32 localBottom = camBottom - originY;
    f32 localRight = camRight - originX;
    f32 localTop = camTop - originY;

    i32 minX = static_cast<i32>(std::floor(localLeft / tileWidth));
    i32 minY = static_cast<i32>(std::floor(localBottom / tileHeight));
    i32 maxX = static_cast<i32>(std::ceil(localRight / tileWidth));
    i32 maxY = static_cast<i32>(std::ceil(localTop / tileHeight));

    minX = std::max(minX, 0);
    minY = std::max(minY, 0);
    maxX = std::min(maxX, static_cast<i32>(mapWidth));
    maxY = std::min(maxY, static_cast<i32>(mapHeight));

    return {minX, minY, maxX, maxY};
}

// Tiles live in a sparse chunk map (the single store), addressed by floor-division so any
// coordinate works — negative included (infinite painting).
namespace {

inline i32 chunkOf(i32 a) {  // floor(a / CHUNK_SIZE), negative-safe
    const i32 n = static_cast<i32>(CHUNK_SIZE);
    return (a >= 0) ? (a / n) : -(((-a) + n - 1) / n);
}

// Finite layers (width>0) bound writes; infinite layers (width==0) take any coord.
inline bool inBounds(const TilemapSystem::LayerData& layer, i32 x, i32 y) {
    if (layer.width == 0 && layer.height == 0) return true;
    return x >= 0 && y >= 0
        && static_cast<u32>(x) < layer.width && static_cast<u32>(y) < layer.height;
}

inline u16 readTile(const TilemapSystem::LayerData& layer, i32 x, i32 y) {
    const i32 cx = chunkOf(x), cy = chunkOf(y);
    auto it = layer.chunks.find({cx, cy});
    if (it == layer.chunks.end()) return EMPTY_TILE;
    const i32 lx = x - cx * static_cast<i32>(CHUNK_SIZE);
    const i32 ly = y - cy * static_cast<i32>(CHUNK_SIZE);
    return it->second.tiles[static_cast<usize>(ly) * CHUNK_SIZE + static_cast<usize>(lx)];
}

inline void writeTile(TilemapSystem::LayerData& layer, i32 x, i32 y, u16 value) {
    const i32 cx = chunkOf(x), cy = chunkOf(y);
    ChunkData& chunk = layer.chunks[{cx, cy}];
    const i32 lx = x - cx * static_cast<i32>(CHUNK_SIZE);
    const i32 ly = y - cy * static_cast<i32>(CHUNK_SIZE);
    chunk.tiles[static_cast<usize>(ly) * CHUNK_SIZE + static_cast<usize>(lx)] = value;
    chunk.revision = ++layer.edit_revision;
}

// Tiled finite-layer load: chunk a flat row-major array, storing only non-empty chunks.
void buildChunksFromFlat(TilemapSystem::LayerData& layer,
                         const u16* tiles, u32 width, u32 height, u32 count) {
    layer.chunks.clear();
    const u32 chunksX = (width + CHUNK_SIZE - 1) / CHUNK_SIZE;
    const u32 chunksY = (height + CHUNK_SIZE - 1) / CHUNK_SIZE;
    for (u32 cy = 0; cy < chunksY; ++cy) {
        for (u32 cx = 0; cx < chunksX; ++cx) {
            ChunkData chunk;
            bool any = false;
            for (u32 ly = 0; ly < CHUNK_SIZE; ++ly) {
                const u32 ty = cy * CHUNK_SIZE + ly;
                if (ty >= height) break;
                for (u32 lx = 0; lx < CHUNK_SIZE; ++lx) {
                    const u32 tx = cx * CHUNK_SIZE + lx;
                    if (tx >= width) break;
                    const usize i = static_cast<usize>(ty) * width + tx;
                    const u16 v = (i < count) ? tiles[i] : EMPTY_TILE;
                    chunk.tiles[ly * CHUNK_SIZE + lx] = v;
                    if (v != EMPTY_TILE) any = true;
                }
            }
            if (any) {
                chunk.revision = ++layer.edit_revision;
                layer.chunks[{static_cast<i32>(cx), static_cast<i32>(cy)}] = chunk;
            }
        }
    }
}

}  // namespace

void TilemapSystem::markAllChunksDirty(Entity entity) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    for (auto& [coord, chunk] : layer->chunks) {
        chunk.revision = ++layer->edit_revision;
    }
}

void TilemapSystem::initLayer(Entity entity, u32 width, u32 height,
                               f32 tileWidth, f32 tileHeight) {
    LayerData layer;
    layer.width = width;
    layer.height = height;
    layer.tile_width = tileWidth;
    layer.tile_height = tileHeight;
    layers_[entity] = std::move(layer);
}

void TilemapSystem::initInfiniteLayer(Entity entity, f32 tileWidth, f32 tileHeight) {
    LayerData layer;
    layer.width = 0;
    layer.height = 0;
    layer.tile_width = tileWidth;
    layer.tile_height = tileHeight;
    layer.infinite = true;
    layers_[entity] = std::move(layer);
}

void TilemapSystem::setChunkTiles(Entity entity, i32 chunkX, i32 chunkY,
                                   const u16* tiles, u32 width, u32 height) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;

    ChunkCoord coord{chunkX, chunkY};
    auto& chunk = layer->chunks[coord];
    chunk.revision = ++layer->edit_revision;
    std::memset(chunk.tiles, 0, sizeof(chunk.tiles));

    for (u32 ly = 0; ly < height && ly < CHUNK_SIZE; ++ly) {
        for (u32 lx = 0; lx < width && lx < CHUNK_SIZE; ++lx) {
            chunk.tiles[ly * CHUNK_SIZE + lx] = tiles[ly * width + lx];
        }
    }
}

void TilemapSystem::destroyLayer(Entity entity) {
    layers_.erase(entity);
}

bool TilemapSystem::hasLayer(Entity entity) const {
    return layers_.count(entity) > 0;
}

const TilemapSystem::LayerData* TilemapSystem::getLayerData(Entity entity) const {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return nullptr;
    return &it->second;
}

void TilemapSystem::setTile(Entity entity, i32 x, i32 y, u16 tileId) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return;
    auto& layer = it->second;
    if (!inBounds(layer, x, y)) return;
    writeTile(layer, x, y, tileId);
}

u16 TilemapSystem::getTile(Entity entity, i32 x, i32 y) const {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return EMPTY_TILE;
    const auto& layer = it->second;
    if (!inBounds(layer, x, y)) return EMPTY_TILE;
    return readTile(layer, x, y);
}

void TilemapSystem::fillRect(Entity entity, i32 x, i32 y,
                              u32 w, u32 h, u16 tileId) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return;
    auto& layer = it->second;
    for (i32 ty = y; ty < y + static_cast<i32>(h); ++ty) {
        for (i32 tx = x; tx < x + static_cast<i32>(w); ++tx) {
            if (inBounds(layer, tx, ty)) writeTile(layer, tx, ty, tileId);
        }
    }
}

void TilemapSystem::setTiles(Entity entity, const u16* tiles, u32 count) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return;
    auto& layer = it->second;
    buildChunksFromFlat(layer, tiles, layer.width, layer.height, count);
}

TilemapSystem::LayerData* TilemapSystem::getLayerDataMut(Entity entity) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return nullptr;
    return &it->second;
}

void TilemapSystem::setRenderProps(Entity entity, u32 textureHandle, u32 tilesetColumns,
                                    f32 uvTileW, f32 uvTileH,
                                    i32 sortLayer, f32 depth,
                                    f32 parallaxX, f32 parallaxY) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->texture_handle = textureHandle;
    layer->tileset_columns = tilesetColumns;
    layer->uv_tile_width = uvTileW;
    layer->uv_tile_height = uvTileH;
    layer->sort_layer = sortLayer;
    layer->depth = depth;
    layer->parallax_factor = {parallaxX, parallaxY};
}

void TilemapSystem::setTilesets(Entity entity, std::vector<TilesetSlot> slots) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    std::sort(slots.begin(), slots.end(),
              [](const TilesetSlot& a, const TilesetSlot& b) { return a.first_id < b.first_id; });
    layer->tilesets = std::move(slots);
}

void TilemapSystem::setTint(Entity entity, f32 r, f32 g, f32 b, f32 a, f32 opacity) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->tint = {r, g, b, a};
    layer->opacity = opacity;
}

void TilemapSystem::setVisible(Entity entity, bool visible) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->visible = visible;
}

void TilemapSystem::setOriginEntity(Entity layerKey, Entity originEntity) {
    auto* layer = getLayerDataMut(layerKey);
    if (!layer) return;
    layer->origin_entity = originEntity;
}

void TilemapSystem::setTileAnimation(Entity entity, u16 tileId,
                                      const AnimFrame* frames, u32 frameCount) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || frameCount == 0) return;

    TileAnimation anim;
    anim.frames.assign(frames, frames + frameCount);
    anim.total_duration_ms = 0;
    for (u32 i = 0; i < frameCount; i++) {
        anim.total_duration_ms += frames[i].duration_ms;
    }
    if (anim.total_duration_ms == 0) return;
    layer->tile_animations[tileId] = std::move(anim);
}

void TilemapSystem::advanceAnimations(Entity entity, f32 dtMs) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || layer->tile_animations.empty()) return;
    layer->elapsed_ms += dtMs;
}

u16 TilemapSystem::resolveAnimatedTile(Entity entity, u16 tileId) const {
    const auto* layer = getLayerData(entity);
    if (!layer) return tileId;

    auto it = layer->tile_animations.find(tileId);
    if (it == layer->tile_animations.end()) return tileId;

    const auto& anim = it->second;
    u32 t = static_cast<u32>(std::fmod(layer->elapsed_ms, static_cast<f32>(anim.total_duration_ms)));
    u32 acc = 0;
    for (const auto& frame : anim.frames) {
        acc += frame.duration_ms;
        if (t < acc) return frame.tile_id;
    }
    return anim.frames.back().tile_id;
}

void TilemapSystem::setTileProperty(Entity entity, u16 tileId,
                                     const std::string& key, const std::string& value) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->tile_properties[tileId][key] = value;
}

std::string TilemapSystem::getTileProperty(Entity entity, u16 tileId,
                                            const std::string& key) const {
    const auto* layer = getLayerData(entity);
    if (!layer) return {};

    auto tileIt = layer->tile_properties.find(tileId);
    if (tileIt == layer->tile_properties.end()) return {};

    auto propIt = tileIt->second.find(key);
    if (propIt == tileIt->second.end()) return {};

    return propIt->second;
}

void TilemapSystem::flipTile(Entity entity, i32 x, i32 y,
                              bool flipH, bool flipV, bool flipD) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || !inBounds(*layer, x, y)) return;
    u16 id = readTile(*layer, x, y) & TILE_ID_MASK;
    if (id == EMPTY_TILE) return;

    u16 flags = 0;
    if (flipH) flags |= TILE_FLIP_H;
    if (flipV) flags |= TILE_FLIP_V;
    if (flipD) flags |= TILE_FLIP_D;
    writeTile(*layer, x, y, id | flags);
}

void TilemapSystem::rotateTile(Entity entity, i32 x, i32 y, i32 degrees) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || !inBounds(*layer, x, y)) return;
    u16 id = readTile(*layer, x, y) & TILE_ID_MASK;
    if (id == EMPTY_TILE) return;

    i32 rot = ((degrees % 360) + 360) % 360;
    u16 flags = 0;
    switch (rot) {
        case 90:  flags = TILE_FLIP_H | TILE_FLIP_D; break;
        case 180: flags = TILE_FLIP_H | TILE_FLIP_V; break;
        case 270: flags = TILE_FLIP_V | TILE_FLIP_D; break;
        default: break;
    }
    writeTile(*layer, x, y, id | flags);
}

void TilemapSystem::setGridType(Entity entity, GridType type) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->grid_type = type;
}

void TilemapSystem::tileToWorld(Entity entity, i32 tx, i32 ty,
                                 f32 originX, f32 originY,
                                 f32& outX, f32& outY) const {
    const auto* layer = getLayerData(entity);
    if (!layer) { outX = 0; outY = 0; return; }

    f32 tw = layer->tile_width;
    f32 th = layer->tile_height;

    switch (layer->grid_type) {
        case GridType::Isometric:
            outX = originX + static_cast<f32>(tx - ty) * tw * 0.5f;
            outY = originY - static_cast<f32>(tx + ty) * th * 0.5f;
            break;
        case GridType::StaggeredIsometric: {
            f32 offsetX = (ty & 1) ? tw * 0.5f : 0.0f;
            outX = originX + static_cast<f32>(tx) * tw + offsetX;
            outY = originY - static_cast<f32>(ty) * th * 0.5f;
            break;
        }
        default:
            outX = originX + static_cast<f32>(tx) * tw;
            outY = originY - static_cast<f32>(ty) * th;
            break;
    }
}

void TilemapSystem::worldToTile(Entity entity, f32 wx, f32 wy,
                                 f32 originX, f32 originY,
                                 i32& outTx, i32& outTy) const {
    const auto* layer = getLayerData(entity);
    if (!layer) { outTx = 0; outTy = 0; return; }

    f32 tw = layer->tile_width;
    f32 th = layer->tile_height;
    f32 lx = wx - originX;
    f32 ly = originY - wy;

    switch (layer->grid_type) {
        case GridType::Isometric: {
            f32 ftx = lx / tw + ly / th;
            f32 fty = ly / th - lx / tw;
            outTx = static_cast<i32>(std::floor(ftx));
            outTy = static_cast<i32>(std::floor(fty));
            break;
        }
        case GridType::StaggeredIsometric: {
            i32 roughY = static_cast<i32>(std::floor(ly / (th * 0.5f)));
            f32 offsetX = (roughY & 1) ? tw * 0.5f : 0.0f;
            outTx = static_cast<i32>(std::floor((lx - offsetX) / tw));
            outTy = roughY;
            break;
        }
        default:
            outTx = static_cast<i32>(std::floor(lx / tw));
            outTy = static_cast<i32>(std::floor(ly / th));
            break;
    }
}

}  // namespace esengine::tilemap
