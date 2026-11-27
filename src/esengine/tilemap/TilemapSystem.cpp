// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TilemapSystem.hpp"
#include "ChunkBlob.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>

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
    return a / n - static_cast<i32>(a % n < 0);
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
    const i32 lx = x - cx * static_cast<i32>(CHUNK_SIZE);
    const i32 ly = y - cy * static_cast<i32>(CHUNK_SIZE);
    const usize index = static_cast<usize>(ly) * CHUNK_SIZE + static_cast<usize>(lx);
    auto it = layer.chunks.find({cx, cy});
    if (it == layer.chunks.end()) {
        if (value == EMPTY_TILE) return;
        it = layer.chunks.try_emplace(ChunkCoord{cx, cy}).first;
    }
    ChunkData& chunk = it->second;
    if (chunk.tiles[index] == value) return;
    chunk.tiles[index] = value;
    chunk.revision = ++layer.edit_revision;
}

// Tiled finite-layer load: chunk a flat row-major array, storing only non-empty chunks.
void buildChunksFromFlat(TilemapSystem::LayerData& layer,
                         const u16* tiles, u32 width, u32 height, u32 count) {
    layer.clearChunks();
    if (width == 0 || height == 0 || count == 0) return;

    constexpr u32 coordinateEnd = static_cast<u32>(std::numeric_limits<i32>::max()) + 1;
    const u32 fullRows = count / width;
    const u32 tail = count % width;
    const u32 coveredHeight = std::min({height, fullRows + static_cast<u32>(tail != 0), coordinateEnd});
    for (u32 top = 0; top < coveredHeight; top += CHUNK_SIZE) {
        const u32 rows = std::min(CHUNK_SIZE, coveredHeight - top);
        const u32 right = std::min(top < fullRows ? width : tail, coordinateEnd);
        for (u32 left = 0; left < right; left += CHUNK_SIZE) {
            ChunkData chunk;
            u16 occupied = EMPTY_TILE;
            const u32 columns = std::min(CHUNK_SIZE, right - left);
            for (u32 row = 0; row < rows; ++row) {
                const u32 y = top + row;
                u32 present = columns;
                if (y == fullRows) {
                    if (left >= tail) break;
                    present = std::min(columns, tail - left);
                }
                const auto* source = tiles + static_cast<usize>(y) * width + left;
                auto* dest = chunk.tiles + row * CHUNK_SIZE;
                for (u32 col = 0; col < present; ++col) {
                    dest[col] = source[col];
                    occupied |= source[col];
                }
            }
            if (occupied != EMPTY_TILE) {
                chunk.revision = ++layer.edit_revision;
                layer.chunks.try_emplace(ChunkCoord{static_cast<i32>(left / CHUNK_SIZE), static_cast<i32>(top / CHUNK_SIZE)}, chunk);
            }
        }
    }
}

}  // namespace

void TilemapSystem::LayerData::clearChunks() {
    if (chunks.empty()) return;
    chunks.clear();
    ++edit_revision;
    ++chunks_erased;
}

void TilemapSystem::initLayer(Entity entity, u32 width, u32 height,
                               f32 tileWidth, f32 tileHeight) {
    LayerData layer;
    layer.generation = ++next_generation_;
    layer.width = width;
    layer.height = height;
    layer.tile_width = tileWidth;
    layer.tile_height = tileHeight;
    layers_[entity] = std::move(layer);
}

void TilemapSystem::initInfiniteLayer(Entity entity, f32 tileWidth, f32 tileHeight) {
    LayerData layer;
    layer.generation = ++next_generation_;
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

    // Chunk coordinates are stored separately from cell coordinates. Widen
    // before scaling so an unreachable chunk cannot wrap into the layer.
    const i64 left = static_cast<i64>(chunkX) * CHUNK_SIZE;
    const i64 top = static_cast<i64>(chunkY) * CHUNK_SIZE;
    constexpr i64 firstCell = std::numeric_limits<i32>::min();
    constexpr i64 lastChunkStart = static_cast<i64>(std::numeric_limits<i32>::max()) - CHUNK_SIZE + 1;
    if (left < firstCell || top < firstCell || left > lastChunkStart || top > lastChunkStart) return;
    if (!inBounds(*layer, static_cast<i32>(left), static_cast<i32>(top))) return;

    u32 columns = std::min(width, CHUNK_SIZE);
    u32 rows = std::min(height, CHUNK_SIZE);
    if (layer->width != 0 || layer->height != 0) {
        columns = std::min(columns, layer->width - static_cast<u32>(left));
        rows = std::min(rows, layer->height - static_cast<u32>(top));
    }

    ChunkCoord coord{chunkX, chunkY};
    auto& chunk = layer->chunks[coord];
    chunk.revision = ++layer->edit_revision;
    std::memset(chunk.tiles, 0, sizeof(chunk.tiles));

    for (u32 ly = 0; ly < rows; ++ly) {
        for (u32 lx = 0; lx < columns; ++lx) {
            chunk.tiles[ly * CHUNK_SIZE + lx] = tiles[ly * width + lx];
        }
    }
}

void TilemapSystem::removeChunk(Entity entity, i32 chunkX, i32 chunkY) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    if (layer->chunks.erase(ChunkCoord{chunkX, chunkY}) == 0) return;
    ++layer->edit_revision;
    ++layer->chunks_erased;
}

bool TilemapSystem::importChunkBlob(Entity entity, const u8* bytes, usize size) {
    if (entity == INVALID_ENTITY || !bytes) return false;
    BlobHeader header{};
    if (!parseBlobHeader(bytes, size, header)) return false;

    auto* layer = getLayerDataMut(entity);
    const CellEncoding running = runningEncoding();
    constexpr i32 side = static_cast<i32>(CHUNK_SIZE);
    ChunkMap incoming;
    ChunkData* into = nullptr;
    ChunkCoord at{};
    bool lost = false;
    const bool walked = walkBlobCells(bytes, size, header, [&](i32 x, i32 y, u16 word) {
        if (lost) return;
        u16 cell = 0;
        if (!recodeCell(word, header.wrote, running, cell)) { lost = true; return; }
        if (layer && !inBounds(*layer, x, y)) return;
        const ChunkCoord coord{floorDiv(x, side), floorDiv(y, side)};
        if (!into || coord != at) {
            into = &incoming[coord];
            at = coord;
        }
        into->tiles[static_cast<usize>(floorMod(y, side)) * CHUNK_SIZE
            + static_cast<usize>(floorMod(x, side))] = cell;
    });
    if (!walked || lost) return false;

    // Scene loading can precede the first tilemap sync. Only create the
    // placeholder after decoding has succeeded.
    if (!layer) {
        initInfiniteLayer(entity, 32.0f, 32.0f);
        layer = getLayerDataMut(entity);
    }
    layer->clearChunks();
    for (auto& [coord, chunk] : incoming) chunk.revision = ++layer->edit_revision;
    layer->chunks.swap(incoming);
    return true;
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
    const i64 coordinateEnd = static_cast<i64>(std::numeric_limits<i32>::max()) + 1;
    i64 startX = x, startY = y;
    i64 endX = std::min(static_cast<i64>(x) + w, coordinateEnd);
    i64 endY = std::min(static_cast<i64>(y) + h, coordinateEnd);
    if (layer.width != 0 || layer.height != 0) {
        startX = std::max(startX, i64{0});
        startY = std::max(startY, i64{0});
        endX = std::min(endX, static_cast<i64>(layer.width));
        endY = std::min(endY, static_cast<i64>(layer.height));
    }
    if (startX >= endX || startY >= endY) return;

    constexpr i64 side = CHUNK_SIZE;
    for (i64 ty = startY; ty < endY; ++ty) {
        const i32 cy = chunkOf(static_cast<i32>(ty));
        const usize row = static_cast<usize>(ty - cy * side) * CHUNK_SIZE;
        for (i64 tx = startX; tx < endX;) {
            const i32 cx = chunkOf(static_cast<i32>(tx));
            const i64 chunkLeft = cx * side;
            const i64 spanEnd = std::min(endX, chunkLeft + side);
            const ChunkCoord coord{cx, cy};
            auto chunk = tileId == EMPTY_TILE ? layer.chunks.find(coord)
                                              : layer.chunks.try_emplace(coord).first;
            if (chunk != layer.chunks.end()) {
                auto& data = chunk->second;
                u16* first = data.tiles + row + (tx - chunkLeft);
                const u16* last = first + (spanEnd - tx);
                u32 changed = 0;
                for (; first != last; ++first) {
                    if (*first == tileId) continue;
                    *first = tileId;
                    ++changed;
                }
                // Keep the revisions of the equivalent row-major cell writes.
                if (changed != 0) {
                    layer.edit_revision += changed;
                    data.revision = layer.edit_revision;
                }
            }
            tx = spanEnd;
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
    layer->anim_table_revision++;  // the table changed — every chunk re-evaluates once
}

void TilemapSystem::clearTileAnimations(Entity entity) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || layer->tile_animations.empty()) return;
    // A tileset swap re-adds only the new set's animations; without this, stale
    // ids from the old tileset keep animating (setTileAnimation only inserts).
    layer->tile_animations.clear();
    layer->anim_table_revision++;
}

namespace {
/// Index of the frame an animation shows at `elapsedMs` (looped).
u32 frameIndexAt(const TileAnimation& anim, f64 elapsedMs) {
    u32 t = static_cast<u32>(std::fmod(elapsedMs, static_cast<f64>(anim.total_duration_ms)));
    u32 acc = 0;
    for (u32 i = 0; i < anim.frames.size(); ++i) {
        acc += anim.frames[i].duration_ms;
        if (t < acc) return i;
    }
    return static_cast<u32>(anim.frames.size()) - 1;
}
}  // namespace

void TilemapSystem::advanceAnimations(Entity entity, f32 dtMs) {
    auto* layer = getLayerDataMut(entity);
    if (!layer || layer->tile_animations.empty()) return;
    const f64 prev = layer->elapsed_ms;
    layer->elapsed_ms += static_cast<f64>(dtMs);
    // Bump the revision only when some animation's visible frame actually
    // flipped — the renderer rebuilds animated chunks on this stamp instead of
    // every frame, so slow animations cost re-meshing only at their frame rate.
    for (const auto& [id, anim] : layer->tile_animations) {
        if (frameIndexAt(anim, prev) != frameIndexAt(anim, layer->elapsed_ms)) {
            layer->anim_revision++;
            return;
        }
    }
}

u16 TilemapSystem::resolveAnimatedTile(Entity entity, u16 tileId) const {
    const auto* layer = getLayerData(entity);
    return layer ? layer->resolveAnimatedTile(tileId) : tileId;
}

u16 TilemapSystem::LayerData::resolveAnimatedTile(u16 tileId) const {
    auto it = tile_animations.find(tileId);
    if (it == tile_animations.end()) return tileId;

    const auto& anim = it->second;
    return anim.frames[frameIndexAt(anim, elapsed_ms)].tile_id;
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

void TilemapSystem::setHexParams(Entity entity, f32 sideLength, bool staggerAxisX, bool staggerIndexEven) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    layer->hex_side_length = sideLength;
    layer->hex_stagger_axis_x = staggerAxisX;
    layer->hex_stagger_index_even = staggerIndexEven;
}

void TilemapSystem::tileToWorld(Entity entity, i32 tx, i32 ty,
                                 f32 originX, f32 originY,
                                 f32& outX, f32& outY) const {
    const auto* layer = getLayerData(entity);
    if (!layer) { outX = 0; outY = 0; return; }

    const auto anchor = layer->grid().anchor(tx, ty);
    outX = originX + anchor.x;
    outY = originY + anchor.y;
}

void TilemapSystem::worldToTile(Entity entity, f32 wx, f32 wy,
                                 f32 originX, f32 originY,
                                 i32& outTx, i32& outTy) const {
    const auto* layer = getLayerData(entity);
    if (!layer) { outTx = 0; outTy = 0; return; }

    const auto cell = layer->grid().cellAt(wx - originX, wy - originY);
    outTx = cell.x;
    outTy = cell.y;
}

}  // namespace esengine::tilemap
