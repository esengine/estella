// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#ifdef ES_ENABLE_TILEMAP

#include "TilemapBindings.hpp"

#include "ActiveContext.hpp"
#include "BoundarySpan.hpp"
#include "../tilemap/TilemapSystem.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/PostProcessPipeline.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"

#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

static tilemap::TilemapSystem& getTilemapSystem() {
    return ctx().require<tilemap::TilemapSystem>();
}

void tilemap_initLayer(u32 entity, u32 width, u32 height,
                       f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().initLayer(e, width, height, tileWidth, tileHeight);
}

void tilemap_initInfinite(u32 entity, f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    // Idempotent for the chunk store, but always reconcile the tile size: the scene
    // loader's importChunks auto-creates the layer with a placeholder size before the
    // sync knows the component's cellSize, and the renderer derives UVs from tile_width.
    if (auto* layer = getTilemapSystem().getLayerDataMut(e)) {
        layer->tile_width = tileWidth;
        layer->tile_height = tileHeight;
        layer->infinite = true;
        return;
    }
    getTilemapSystem().initInfiniteLayer(e, tileWidth, tileHeight);
}

void tilemap_destroyLayer(u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().destroyLayer(e);
}

void tilemap_setTile(u32 entity, i32 x, i32 y, u32 tileId) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    getTilemapSystem().setTile(e, x, y, static_cast<u16>(tileId));
}

u32 tilemap_getTile(u32 entity, i32 x, i32 y) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return 0;
    return getTilemapSystem().getTile(e, x, y);
}

void tilemap_fillRect(u32 entity, i32 x, i32 y,
                      u32 w, u32 h, u32 tileId) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    getTilemapSystem().fillRect(e, x, y, w, h, static_cast<u16>(tileId));
}

void tilemap_setTiles(u32 entity, uintptr_t tilesPtr, u32 count) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    const auto* tiles = boundarySpan<u16>(tilesPtr, count, "tilemap_setTiles");
    if (!tiles) return;
    getTilemapSystem().setTiles(e, tiles, count);
}

// Multi-tileset table: `count` slots, each 3 packed u32 [first_id, textureHandle,
// columns]. Empty table reverts the layer to its single tileset.
void tilemap_setTilesets(u32 entity, uintptr_t dataPtr, u32 count) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    const auto* d = count ? boundarySpan<u32>(dataPtr, static_cast<u64>(count) * 5, "tilemap_setTilesets") : nullptr;
    if (count && !d) return;
    std::vector<tilemap::TilesetSlot> slots;
    slots.reserve(count);
    for (u32 i = 0; i < count; ++i) {
        tilemap::TilesetSlot slot;
        slot.first_id = static_cast<u16>(d[i * 5 + 0]);
        slot.texture_handle = d[i * 5 + 1];
        slot.columns = d[i * 5 + 2];
        slot.margin = d[i * 5 + 3];
        slot.spacing = d[i * 5 + 4];
        slots.push_back(slot);
    }
    getTilemapSystem().setTilesets(e, std::move(slots));
}

bool tilemap_hasLayer(u32 entity) {
    return getTilemapSystem().hasLayer(Entity::fromRaw(entity));
}

void tilemap_setRenderProps(u32 entity, u32 textureHandle, u32 tilesetColumns,
                            f32 uvTileW, f32 uvTileH,
                            i32 sortLayer, f32 depth,
                            f32 parallaxX, f32 parallaxY) {
    getTilemapSystem().setRenderProps(Entity::fromRaw(entity),
        textureHandle, tilesetColumns, uvTileW, uvTileH,
        sortLayer, depth, parallaxX, parallaxY);
}

void tilemap_setTint(u32 entity, f32 r, f32 g, f32 b, f32 a, f32 opacity) {
    getTilemapSystem().setTint(Entity::fromRaw(entity), r, g, b, a, opacity);
}

void tilemap_setVisible(u32 entity, bool visible) {
    getTilemapSystem().setVisible(Entity::fromRaw(entity), visible);
}

void tilemap_setOriginEntity(u32 layerKey, u32 originEntity) {
    getTilemapSystem().setOriginEntity(Entity::fromRaw(layerKey),
                                    Entity::fromRaw(originEntity));
}

// --- Chunk serialization ---

namespace {

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

}  // namespace

// Exports every non-empty chunk of `entity` as a single base64-encoded
// blob. Layout (all little-endian):
//   u32 magic = 'ESTM'   (header — version-check on import)
//   u32 chunkCount
//   repeated for each chunk:
//     i32 chunkX, i32 chunkY
//     u16 tiles[CHUNK_SIZE * CHUNK_SIZE]
// Empty chunks are skipped to keep the payload compact for sparse maps.
std::string tilemap_exportChunks(u32 entity) {
    auto e = Entity::fromRaw(entity);
    const auto* layer = getTilemapSystem().getLayerData(e);
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

    const u32 magic = 0x4D545345u;  // 'ESTM'
    const u32 count = static_cast<u32>(nonEmpty.size());
    const usize perChunk = sizeof(i32) * 2
        + tilemap::CHUNK_SIZE * tilemap::CHUNK_SIZE * sizeof(u16);
    std::vector<u8> raw;
    raw.reserve(sizeof(u32) * 2 + count * perChunk);

    auto append = [&](const void* p, usize n) {
        const u8* b = static_cast<const u8*>(p);
        raw.insert(raw.end(), b, b + n);
    };
    append(&magic, sizeof(magic));
    append(&count, sizeof(count));
    for (const auto& [coord, chunk] : nonEmpty) {
        append(&coord.x, sizeof(coord.x));
        append(&coord.y, sizeof(coord.y));
        append(chunk->tiles, sizeof(chunk->tiles));
    }

    std::string out;
    base64Encode(raw.data(), raw.size(), out);
    return out;
}

bool tilemap_importChunks(u32 entity, const std::string& encoded) {
    auto e = Entity::fromRaw(entity);
    // Auto-init as infinite if the caller didn't pre-create a layer — the
    // scene loader path inserts the TilemapLayer component first and then
    // expects the chunks to land, so we can't require a separate init call.
    if (!getTilemapSystem().hasLayer(e)) {
        getTilemapSystem().initInfiniteLayer(e, 32.0f, 32.0f);
    }
    auto* layer = getTilemapSystem().getLayerDataMut(e);
    if (!layer) return false;

    std::vector<u8> raw;
    if (!base64Decode(encoded, raw)) return false;
    if (raw.size() < sizeof(u32) * 2) return false;

    auto read = [&raw](usize offset, void* out, usize n) -> bool {
        if (offset + n > raw.size()) return false;
        std::memcpy(out, raw.data() + offset, n);
        return true;
    };

    u32 magic = 0;
    u32 count = 0;
    if (!read(0, &magic, sizeof(magic))) return false;
    if (magic != 0x4D545345u) return false;
    if (!read(sizeof(u32), &count, sizeof(count))) return false;

    const usize perChunk = sizeof(i32) * 2
        + tilemap::CHUNK_SIZE * tilemap::CHUNK_SIZE * sizeof(u16);
    if (raw.size() < sizeof(u32) * 2 + static_cast<usize>(count) * perChunk) return false;

    layer->chunks.clear();
    usize cursor = sizeof(u32) * 2;
    for (u32 i = 0; i < count; ++i) {
        i32 cx = 0, cy = 0;
        if (!read(cursor, &cx, sizeof(cx))) return false;
        cursor += sizeof(cx);
        if (!read(cursor, &cy, sizeof(cy))) return false;
        cursor += sizeof(cy);

        tilemap::ChunkData chunk;
        if (!read(cursor, chunk.tiles, sizeof(chunk.tiles))) return false;
        cursor += sizeof(chunk.tiles);
        chunk.revision = ++layer->edit_revision;
        layer->chunks[tilemap::ChunkCoord{cx, cy}] = chunk;
    }

    return true;
}

void tilemap_initInfiniteLayer(u32 entity, f32 tileWidth, f32 tileHeight) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().initInfiniteLayer(e, tileWidth, tileHeight);
}

void tilemap_setChunkTiles(u32 entity, i32 chunkX, i32 chunkY,
                            uintptr_t tilesPtr, u32 width, u32 height) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    const auto* tiles = boundarySpan<u16>(tilesPtr, static_cast<u64>(width) * height, "tilemap_setChunkTiles");
    if (!tiles) return;
    getTilemapSystem().setChunkTiles(e, chunkX, chunkY, tiles, width, height);
}

void tilemap_setTileAnimation(u32 entity, u32 tileId,
                               uintptr_t framesPtr, u32 frameCount) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    const auto* data = boundarySpan<u32>(framesPtr, static_cast<u64>(frameCount) * 2, "tilemap_setTileAnimation");
    if (!data) return;
    std::vector<tilemap::AnimFrame> frames(frameCount);
    for (u32 i = 0; i < frameCount; i++) {
        frames[i].tile_id = static_cast<u16>(data[i * 2]);
        frames[i].duration_ms = static_cast<u16>(data[i * 2 + 1]);
    }
    getTilemapSystem().setTileAnimation(e, static_cast<u16>(tileId),
                                     frames.data(), frameCount);
}

void tilemap_clearTileAnimations(u32 entity) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    getTilemapSystem().clearTileAnimations(e);
}

void tilemap_advanceAnimations(u32 entity, f32 dtMs) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().advanceAnimations(e, dtMs);
}

void tilemap_setTileProperty(u32 entity, u32 tileId,
                              const std::string& key, const std::string& value) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    getTilemapSystem().setTileProperty(e, static_cast<u16>(tileId), key, value);
}

std::string tilemap_getTileProperty(u32 entity, i32 x, i32 y,
                                     const std::string& key) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return "";
    u16 raw = getTilemapSystem().getTile(e, x, y);
    u16 tileId = raw & tilemap::TILE_ID_MASK;
    if (tileId == tilemap::EMPTY_TILE) return "";
    return getTilemapSystem().getTileProperty(e, tileId, key);
}

void tilemap_flipTile(u32 entity, i32 x, i32 y,
                       bool flipH, bool flipV, bool flipD) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().flipTile(e, x, y, flipH, flipV, flipD);
}

void tilemap_rotateTile(u32 entity, i32 x, i32 y, i32 degrees) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().rotateTile(e, x, y, degrees);
}

void tilemap_setGridType(u32 entity, u32 type) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().setGridType(e, static_cast<tilemap::GridType>(type));
}

void tilemap_setHexParams(u32 entity, f32 sideLength, u32 staggerAxisX, u32 staggerIndexEven) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY) return;
    getTilemapSystem().setHexParams(e, sideLength, staggerAxisX != 0, staggerIndexEven != 0);
}

static f32 s_coordBuffer[2] = {};

uintptr_t tilemap_tileToWorld(u32 entity, i32 tx, i32 ty,
                               f32 originX, f32 originY) {
    auto e = Entity::fromRaw(entity);
    getTilemapSystem().tileToWorld(e, tx, ty, originX, originY,
                                s_coordBuffer[0], s_coordBuffer[1]);
    return reinterpret_cast<uintptr_t>(s_coordBuffer);
}

uintptr_t tilemap_worldToTile(u32 entity, f32 wx, f32 wy,
                               f32 originX, f32 originY) {
    auto e = Entity::fromRaw(entity);
    i32 tx, ty;
    getTilemapSystem().worldToTile(e, wx, wy, originX, originY, tx, ty);
    s_coordBuffer[0] = static_cast<f32>(tx);
    s_coordBuffer[1] = static_cast<f32>(ty);
    return reinterpret_cast<uintptr_t>(s_coordBuffer);
}

}  // namespace esengine

#endif  // ES_ENABLE_TILEMAP
