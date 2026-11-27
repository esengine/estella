// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#ifdef ES_ENABLE_TILEMAP

#include "TilemapBindings.hpp"

#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../tilemap/TilemapWorlds.hpp"
#include "../tilemap/ChunkBlob.hpp"
#include "../renderer/frame/RenderContext.hpp"
#include "../renderer/frame/RenderFrame.hpp"
#include "../renderer/draw/ImmediateDraw.hpp"
#include "../renderer/draw/CustomGeometry.hpp"
#include "../renderer/frame/PostProcessPipeline.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"

#include <algorithm>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace esengine {

namespace {

void initLayer(tilemap::TilemapSystem& map, u32 entity, u32 width, u32 height,
                       f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.initLayer(e, width, height, tileWidth, tileHeight);
}

void initInfinite(tilemap::TilemapSystem& map, u32 entity, f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    // Idempotent for the chunk store, but always reconcile the tile size: the scene
    // loader's importChunks auto-creates the layer with a placeholder size before the
    // sync knows the component's cellSize, and the renderer derives UVs from tile_width.
    if (auto* layer = map.getLayerDataMut(e)) {
        layer->tile_width = tileWidth;
        layer->tile_height = tileHeight;
        layer->infinite = true;
        return;
    }
    map.initInfiniteLayer(e, tileWidth, tileHeight);
}

void destroyLayer(tilemap::TilemapSystem& map, u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.destroyLayer(e);
}

void setTile(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y, u32 tileId) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    map.setTile(e, x, y, static_cast<u16>(tileId));
}

u32 getTile(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return 0;
    return map.getTile(e, x, y);
}

void fillRect(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y,
                      u32 w, u32 h, u32 tileId) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    map.fillRect(e, x, y, w, h, static_cast<u16>(tileId));
}

void setTiles(tilemap::TilemapSystem& map, u32 entity, uintptr_t tilesPtr, u32 count) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    const auto* tiles = count ? boundarySpan<u16>(tilesPtr, count, "tilemap_setTiles") : nullptr;
    if (count && !tiles) return;
    map.setTiles(e, tiles, count);
}

// Multi-tileset table: `count` slots, each SLOT_STRIDE packed u32
// [first_id, textureHandle, columns, margin, spacing, extrude].
// Empty table reverts the layer to its single tileset.
void setTilesets(tilemap::TilemapSystem& map, u32 entity, uintptr_t dataPtr, u32 count) {
    // The SDK's TILESET_SLOT_STRIDE. No generator spans this boundary, so the
    // field list above is the contract and this number is the other half of it.
    constexpr u32 SLOT_STRIDE = 6;
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    const auto* d = count
        ? boundarySpan<u32>(dataPtr, static_cast<u64>(count) * SLOT_STRIDE, "tilemap_setTilesets")
        : nullptr;
    if (count && !d) return;
    std::vector<tilemap::TilesetSlot> slots;
    slots.reserve(count);
    for (u32 i = 0; i < count; ++i) {
        tilemap::TilesetSlot slot;
        slot.first_id = static_cast<u16>(d[i * SLOT_STRIDE + 0]);
        slot.texture_handle = d[i * SLOT_STRIDE + 1];
        slot.columns = d[i * SLOT_STRIDE + 2];
        slot.margin = d[i * SLOT_STRIDE + 3];
        slot.spacing = d[i * SLOT_STRIDE + 4];
        slot.extrude = d[i * SLOT_STRIDE + 5];
        slots.push_back(slot);
    }
    map.setTilesets(e, std::move(slots));
}

bool hasLayer(tilemap::TilemapSystem& map, u32 entity) {
    return map.hasLayer(Entity::fromRaw(entity));
}

u32 getEditRevision(tilemap::TilemapSystem& map, u32 entity) {
    const auto* layer = map.getLayerData(Entity::fromRaw(entity));
    return layer ? layer->edit_revision : 0;
}

u32 getGeneration(tilemap::TilemapSystem& map, u32 entity) {
    const auto* layer = map.getLayerData(Entity::fromRaw(entity));
    return layer ? layer->generation : 0;
}

u32 readChunkIndex(tilemap::TilemapSystem& map, u32 entity, uintptr_t rowsPtr, u32 capacity) {
    const auto* layer = map.getLayerData(Entity::fromRaw(entity));
    const u32 count = layer ? static_cast<u32>(layer->chunks.size()) : 0;
    if (count == 0 || capacity < count) return count;
    auto* out = boundarySpanMut<u8>(rowsPtr, static_cast<u64>(count) * 3 * sizeof(u32), "tilemap_readChunkIndex");
    if (!out) return 0;
    for (const auto& [coord, chunk] : layer->chunks) {
        std::memcpy(out, &coord.x, sizeof(i32));
        std::memcpy(out + sizeof(u32), &coord.y, sizeof(i32));
        std::memcpy(out + 2 * sizeof(u32), &chunk.revision, sizeof(u32));
        out += 3 * sizeof(u32);
    }
    return count;
}

bool readChunkTiles(tilemap::TilemapSystem& map, u32 entity, i32 chunkX, i32 chunkY, uintptr_t tilesPtr, u32 capacity) {
    constexpr u32 cells = tilemap::CHUNK_SIZE * tilemap::CHUNK_SIZE;
    if (capacity < cells) return false;
    const auto* layer = map.getLayerData(Entity::fromRaw(entity));
    if (!layer) return false;
    const auto found = layer->chunks.find({chunkX, chunkY});
    if (found == layer->chunks.end()) return false;
    auto* out = boundarySpanMut<u8>(tilesPtr, cells * sizeof(u16), "tilemap_readChunkTiles");
    if (!out) return false;
    std::memcpy(out, found->second.tiles, cells * sizeof(u16));
    return true;
}

void setRenderProps(tilemap::TilemapSystem& map, u32 entity, u32 textureHandle, u32 tilesetColumns,
                            f32 uvTileW, f32 uvTileH,
                            i32 sortLayer, f32 depth,
                            f32 parallaxX, f32 parallaxY) {
    map.setRenderProps(Entity::fromRaw(entity),
        textureHandle, tilesetColumns, uvTileW, uvTileH,
        sortLayer, depth, parallaxX, parallaxY);
}

void setTint(tilemap::TilemapSystem& map, u32 entity, f32 r, f32 g, f32 b, f32 a, f32 opacity) {
    map.setTint(Entity::fromRaw(entity), r, g, b, a, opacity);
}

void setVisible(tilemap::TilemapSystem& map, u32 entity, bool visible) {
    map.setVisible(Entity::fromRaw(entity), visible);
}

void setOriginEntity(tilemap::TilemapSystem& map, u32 layerKey, u32 originEntity) {
    map.setOriginEntity(Entity::fromRaw(layerKey),
                                    Entity::fromRaw(originEntity));
}

// --- Chunk serialization ---

// Base64 encoding uses the URL-safe alphabet (`-` / `_` instead of `+` / `/`)
// so the output embeds cleanly in JSON scene files without escaping and can
// also survive a ?query= parameter if anyone ever serves scenes over HTTP.
constexpr const char* kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

void base64Encode(const u8* data, usize len, std::string& out) {
    out.reserve(out.size() + ((len + 2) / 3) * 4);
    usize i = 0;
    while (i + 3 <= len) {
        const u32 v = (u32(data[i]) << 16) | (u32(data[i + 1]) << 8) | u32(data[i + 2]);
        out.push_back(kB64[(v >> 18) & 0x3F]);
        out.push_back(kB64[(v >> 12) & 0x3F]);
        out.push_back(kB64[(v >> 6) & 0x3F]);
        out.push_back(kB64[v & 0x3F]);
        i += 3;
    }
    if (i < len) {
        const u32 v = (u32(data[i]) << 16) | (i + 1 < len ? (u32(data[i + 1]) << 8) : 0);
        out.push_back(kB64[(v >> 18) & 0x3F]);
        out.push_back(kB64[(v >> 12) & 0x3F]);
        if (i + 1 < len) {
            out.push_back(kB64[(v >> 6) & 0x3F]);
        } else {
            out.push_back('=');
        }
        out.push_back('=');
    }
}

i32 b64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '-' || c == '+') return 62;
    if (c == '_' || c == '/') return 63;
    return -1;
}

bool base64Decode(const std::string& in, std::vector<u8>& out) {
    out.clear();
    out.reserve(in.size() * 3 / 4);
    i32 buf = 0;
    i32 bits = 0;
    for (char c : in) {
        if (c == '=' || c == '\n' || c == '\r' || c == ' ') continue;
        const i32 v = b64Value(c);
        if (v < 0) return false;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<u8>((buf >> bits) & 0xFF));
        }
    }
    return true;
}

// Exports every non-empty chunk of `entity` as a single base64-encoded
// blob. Layout (all little-endian):
//   u32 magic = 'TMAP'
//   u16 chunkSize, idMask, flipH, flipV, flipD, reserved(0)
//   u32 chunkCount
//   repeated for each chunk:
//     i32 chunkX, i32 chunkY
//     u16 tiles[chunkSize * chunkSize]
// Non-empty chunks are stored in row-major coordinate order.
std::string exportChunks(tilemap::TilemapSystem& map, u32 entity) {
    auto e = Entity::fromRaw(entity);
    const auto* layer = map.getLayerData(e);
    if (!layer) return {};

    std::vector<std::pair<tilemap::ChunkCoord, const tilemap::ChunkData*>> nonEmpty;
    nonEmpty.reserve(layer->chunks.size());
    for (const auto& [coord, chunk] : layer->chunks) {
        bool anyTile = false;
        for (u32 i = 0; i < tilemap::CHUNK_SIZE * tilemap::CHUNK_SIZE; ++i) {
            if (chunk.tiles[i] != tilemap::EMPTY_TILE) { anyTile = true; break; }
        }
        if (anyTile) nonEmpty.emplace_back(coord, &chunk);
    }
    std::sort(nonEmpty.begin(), nonEmpty.end(), [](const auto& a, const auto& b) {
        return a.first.y == b.first.y ? a.first.x < b.first.x : a.first.y < b.first.y;
    });

    const u32 count = static_cast<u32>(nonEmpty.size());
    const usize perChunk = sizeof(i32) * 2
        + tilemap::CHUNK_SIZE * tilemap::CHUNK_SIZE * sizeof(u16);
    std::vector<u8> raw;
    raw.reserve(tilemap::BLOB_HEADER_V2_BYTES + count * perChunk);

    auto append = [&](const void* p, usize n) {
        const u8* b = static_cast<const u8*>(p);
        raw.insert(raw.end(), b, b + n);
    };
    tilemap::appendBlobHeader(raw, count);
    for (const auto& [coord, chunk] : nonEmpty) {
        append(&coord.x, sizeof(coord.x));
        append(&coord.y, sizeof(coord.y));
        append(chunk->tiles, sizeof(chunk->tiles));
    }

    std::string out;
    base64Encode(raw.data(), raw.size(), out);
    return out;
}

bool importChunks(tilemap::TilemapSystem& map, u32 entity, const std::string& encoded) {
    const auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return false;

    std::vector<u8> raw;
    if (!base64Decode(encoded, raw)) return false;
    return map.importChunkBlob(e, raw.data(), raw.size());
}

void initInfiniteLayer(tilemap::TilemapSystem& map, u32 entity, f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.initInfiniteLayer(e, tileWidth, tileHeight);
}

void setChunkTiles(tilemap::TilemapSystem& map, u32 entity, i32 chunkX, i32 chunkY,
                            uintptr_t tilesPtr, u32 width, u32 height) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    const auto* tiles = boundarySpan<u16>(tilesPtr, static_cast<u64>(width) * height, "tilemap_setChunkTiles");
    if (!tiles) return;
    map.setChunkTiles(e, chunkX, chunkY, tiles, width, height);
}

void removeChunk(tilemap::TilemapSystem& map, u32 entity, i32 chunkX, i32 chunkY) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    map.removeChunk(e, chunkX, chunkY);
}

void setTileAnimation(tilemap::TilemapSystem& map, u32 entity, u32 tileId,
                               uintptr_t framesPtr, u32 frameCount) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    const auto* data = boundarySpan<u32>(framesPtr, static_cast<u64>(frameCount) * 2, "tilemap_setTileAnimation");
    if (!data) return;
    std::vector<tilemap::AnimFrame> frames(frameCount);
    for (u32 i = 0; i < frameCount; i++) {
        frames[i].tile_id = static_cast<u16>(data[i * 2]);
        frames[i].duration_ms = static_cast<u16>(data[i * 2 + 1]);
    }
    map.setTileAnimation(e, static_cast<u16>(tileId),
                                     frames.data(), frameCount);
}

void clearTileAnimations(tilemap::TilemapSystem& map, u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    map.clearTileAnimations(e);
}

void advanceAnimations(tilemap::TilemapSystem& map, u32 entity, f32 dtMs) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.advanceAnimations(e, dtMs);
}

void setTileProperty(tilemap::TilemapSystem& map, u32 entity, u32 tileId,
                              const std::string& key, const std::string& value) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return;
    map.setTileProperty(e, static_cast<u16>(tileId), key, value);
}

std::string getTileProperty(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y,
                                     const std::string& key) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !map.hasLayer(e)) return "";
    u16 raw = map.getTile(e, x, y);
    u16 tileId = raw & tilemap::TILE_ID_MASK;
    if (tileId == tilemap::EMPTY_TILE) return "";
    return map.getTileProperty(e, tileId, key);
}

void flipTile(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y,
                       bool flipH, bool flipV, bool flipD) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.flipTile(e, x, y, flipH, flipV, flipD);
}

void rotateTile(tilemap::TilemapSystem& map, u32 entity, i32 x, i32 y, i32 degrees) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.rotateTile(e, x, y, degrees);
}

void setGridType(tilemap::TilemapSystem& map, u32 entity, u32 type) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.setGridType(e, static_cast<tilemap::GridType>(type));
}

void setHexParams(tilemap::TilemapSystem& map, u32 entity, f32 sideLength, u32 staggerAxisX, u32 staggerIndexEven) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    map.setHexParams(e, sideLength, staggerAxisX != 0, staggerIndexEven != 0);
}

static f32 s_coordBuffer[2] = {};

uintptr_t tileToWorld(tilemap::TilemapSystem& map, u32 entity, i32 tx, i32 ty,
                               f32 originX, f32 originY) {
    auto e = Entity::fromRaw(entity);
    map.tileToWorld(e, tx, ty, originX, originY,
                                s_coordBuffer[0], s_coordBuffer[1]);
    return reinterpret_cast<uintptr_t>(s_coordBuffer);
}

uintptr_t worldToTile(tilemap::TilemapSystem& map, u32 entity, f32 wx, f32 wy,
                               f32 originX, f32 originY) {
    auto e = Entity::fromRaw(entity);
    i32 tx, ty;
    map.worldToTile(e, wx, wy, originX, originY, tx, ty);
    s_coordBuffer[0] = static_cast<f32>(tx);
    s_coordBuffer[1] = static_cast<f32>(ty);
    return reinterpret_cast<uintptr_t>(s_coordBuffer);
}

}  // namespace

// Both entry points run on the render owner and call the same operation.
#define ES_TILEMAP_EXPAND(...) __VA_ARGS__
#define ES_TILEMAP_CALL(Result, Name, Params, Args) \
    Result tilemap_##Name Params { \
        return Name(*activeCtx().require<tilemap::TilemapWorlds>().legacy(), ES_TILEMAP_EXPAND Args); \
    } \
    Result tilemap_##Name##InWorld(ecs::Registry& registry, ES_TILEMAP_EXPAND Params) { \
        return Name(*activeCtx().require<tilemap::TilemapWorlds>().select(registry), ES_TILEMAP_EXPAND Args); \
    }

ES_TILEMAP_CALL(void, initLayer, (u32 entity, u32 width, u32 height, f32 tileWidth, f32 tileHeight),
                (entity, width, height, tileWidth, tileHeight))
ES_TILEMAP_CALL(void, initInfinite, (u32 entity, f32 tileWidth, f32 tileHeight),
                (entity, tileWidth, tileHeight))
ES_TILEMAP_CALL(void, initInfiniteLayer, (u32 entity, f32 tileWidth, f32 tileHeight),
                (entity, tileWidth, tileHeight))
ES_TILEMAP_CALL(void, destroyLayer, (u32 entity),
                (entity))
ES_TILEMAP_CALL(bool, hasLayer, (u32 entity),
                (entity))
ES_TILEMAP_CALL(u32, getEditRevision, (u32 entity),
                (entity))
ES_TILEMAP_CALL(u32, getGeneration, (u32 entity),
                (entity))
ES_TILEMAP_CALL(u32, readChunkIndex, (u32 entity, uintptr_t rowsPtr, u32 capacity),
                (entity, rowsPtr, capacity))
ES_TILEMAP_CALL(bool, readChunkTiles, (u32 entity, i32 chunkX, i32 chunkY, uintptr_t tilesPtr, u32 capacity),
                (entity, chunkX, chunkY, tilesPtr, capacity))
ES_TILEMAP_CALL(void, setTile, (u32 entity, i32 x, i32 y, u32 tileId),
                (entity, x, y, tileId))
ES_TILEMAP_CALL(u32, getTile, (u32 entity, i32 x, i32 y),
                (entity, x, y))
ES_TILEMAP_CALL(void, fillRect, (u32 entity, i32 x, i32 y, u32 w, u32 h, u32 tileId),
                (entity, x, y, w, h, tileId))
ES_TILEMAP_CALL(void, setTiles, (u32 entity, uintptr_t tilesPtr, u32 count),
                (entity, tilesPtr, count))
ES_TILEMAP_CALL(void, setChunkTiles, (u32 entity, i32 chunkX, i32 chunkY, uintptr_t tilesPtr, u32 width, u32 height),
                (entity, chunkX, chunkY, tilesPtr, width, height))
ES_TILEMAP_CALL(void, removeChunk, (u32 entity, i32 chunkX, i32 chunkY),
                (entity, chunkX, chunkY))
ES_TILEMAP_CALL(void, flipTile, (u32 entity, i32 x, i32 y, bool flipH, bool flipV, bool flipD),
                (entity, x, y, flipH, flipV, flipD))
ES_TILEMAP_CALL(void, rotateTile, (u32 entity, i32 x, i32 y, i32 degrees),
                (entity, x, y, degrees))
ES_TILEMAP_CALL(void, setTilesets, (u32 entity, uintptr_t dataPtr, u32 count),
                (entity, dataPtr, count))
ES_TILEMAP_CALL(void, setRenderProps, (u32 entity, u32 textureHandle, u32 tilesetColumns, f32 uvTileW, f32 uvTileH, i32 sortLayer, f32 depth, f32 parallaxX, f32 parallaxY),
                (entity, textureHandle, tilesetColumns, uvTileW, uvTileH, sortLayer, depth, parallaxX, parallaxY))
ES_TILEMAP_CALL(void, setTint, (u32 entity, f32 r, f32 g, f32 b, f32 a, f32 opacity),
                (entity, r, g, b, a, opacity))
ES_TILEMAP_CALL(void, setVisible, (u32 entity, bool visible),
                (entity, visible))
ES_TILEMAP_CALL(void, setOriginEntity, (u32 layerKey, u32 originEntity),
                (layerKey, originEntity))
ES_TILEMAP_CALL(void, setGridType, (u32 entity, u32 type),
                (entity, type))
ES_TILEMAP_CALL(void, setHexParams, (u32 entity, f32 sideLength, u32 staggerAxisX, u32 staggerIndexEven),
                (entity, sideLength, staggerAxisX, staggerIndexEven))
ES_TILEMAP_CALL(uintptr_t, tileToWorld, (u32 entity, i32 tx, i32 ty, f32 originX, f32 originY),
                (entity, tx, ty, originX, originY))
ES_TILEMAP_CALL(uintptr_t, worldToTile, (u32 entity, f32 wx, f32 wy, f32 originX, f32 originY),
                (entity, wx, wy, originX, originY))
ES_TILEMAP_CALL(void, setTileAnimation, (u32 entity, u32 tileId, uintptr_t framesPtr, u32 frameCount),
                (entity, tileId, framesPtr, frameCount))
ES_TILEMAP_CALL(void, clearTileAnimations, (u32 entity),
                (entity))
ES_TILEMAP_CALL(void, advanceAnimations, (u32 entity, f32 dtMs),
                (entity, dtMs))
ES_TILEMAP_CALL(void, setTileProperty, (u32 entity, u32 tileId, const std::string& key, const std::string& value),
                (entity, tileId, key, value))
ES_TILEMAP_CALL(std::string, getTileProperty, (u32 entity, i32 x, i32 y, const std::string& key),
                (entity, x, y, key))
ES_TILEMAP_CALL(std::string, exportChunks, (u32 entity),
                (entity))
ES_TILEMAP_CALL(bool, importChunks, (u32 entity, const std::string& encoded),
                (entity, encoded))

#undef ES_TILEMAP_CALL
#undef ES_TILEMAP_EXPAND

}  // namespace esengine

#endif  // ES_ENABLE_TILEMAP
