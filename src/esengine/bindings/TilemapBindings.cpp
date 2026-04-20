#ifdef ES_PLATFORM_WEB
#ifdef ES_ENABLE_TILEMAP

#include "ActiveContext.hpp"
#include "../tilemap/TilemapSystem.hpp"
#include "../tilemap/TiledMapLoader.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/ImmediateDraw.hpp"
#include "../renderer/CustomGeometry.hpp"
#include "../renderer/PostProcessPipeline.hpp"
#include "../resource/ResourceManager.hpp"
#include "../ecs/TransformSystem.hpp"
#ifdef ES_ENABLE_SPINE
#include "../spine/SpineResourceManager.hpp"
#include "../spine/SpineSystem.hpp"
#endif

#include <emscripten/bind.h>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

namespace esengine {

static EstellaContext& ctx() { return activeCtx(); }

static tilemap::TilemapSystem& getTilemapSystem() {
    return ctx().require<tilemap::TilemapSystem>();
}

static tilemap::TiledMapLoader& getTiledLoader() {
    return ctx().require<tilemap::TiledMapLoader>();
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
    if (getTilemapSystem().hasLayer(e)) return;
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
    const auto* tiles = reinterpret_cast<const u16*>(tilesPtr);
    getTilemapSystem().setTiles(e, tiles, count);
}

bool tilemap_hasLayer(u32 entity) {
    return getTilemapSystem().hasLayer(Entity::fromRaw(entity));
}

void tilemap_submitLayer(u32 entity, u32 textureId,
                         i32 sortLayer, f32 depth,
                         u32 tilesetColumns,
                         f32 uvTileWidth, f32 uvTileHeight,
                         f32 originX, f32 originY,
                         f32 camLeft, f32 camBottom,
                         f32 camRight, f32 camTop,
                         f32 tintR, f32 tintG, f32 tintB, f32 tintA,
                         f32 opacity,
                         f32 parallaxX, f32 parallaxY) {
    auto* frame = ctx().tryGet<RenderFrame>();
    if (!frame) return;

    auto* rm = ctx().tryGet<resource::ResourceManager>();
    if (!rm) return;
    auto texHandle = resource::TextureHandle(textureId);
    auto* tex = rm->getTexture(texHandle);
    if (!tex) return;
    u32 glTextureId = tex->getId();

    auto layerEntity = Entity::fromRaw(entity);
    const auto* layerData = getTilemapSystem().getLayerData(layerEntity);
    if (!layerData) return;

    glm::vec4 finalColor(tintR, tintG, tintB, tintA * opacity);

    f32 camCenterX = (camLeft + camRight) * 0.5f;
    f32 camCenterY = (camBottom + camTop) * 0.5f;
    f32 parallaxOffsetX = camCenterX * (1.0f - parallaxX);
    f32 parallaxOffsetY = camCenterY * (1.0f - parallaxY);
    f32 adjOriginX = originX + parallaxOffsetX;
    f32 adjOriginY = originY + parallaxOffsetY;

    auto range = tilemap::computeVisibleRange(
        camLeft, -camTop, camRight, -camBottom,
        adjOriginX, -adjOriginY,
        layerData->tile_width, layerData->tile_height,
        layerData->width, layerData->height);
    if (range.empty()) return;

    for (i32 ty = range.min_y; ty < range.max_y; ++ty) {
        for (i32 tx = range.min_x; tx < range.max_x; ++tx) {
            u16 rawTile = layerData->tiles[
                static_cast<usize>(ty) * layerData->width + static_cast<usize>(tx)];

            u16 tileId = rawTile & tilemap::TILE_ID_MASK;
            if (tileId == tilemap::EMPTY_TILE) continue;

            bool flipH = (rawTile & tilemap::TILE_FLIP_H) != 0;
            bool flipV = (rawTile & tilemap::TILE_FLIP_V) != 0;

            u32 tileIndex = tileId - 1;
            u32 tileCol = tileIndex % tilesetColumns;
            u32 tileRow = tileIndex / tilesetColumns;

            f32 worldX = adjOriginX + static_cast<f32>(tx) * layerData->tile_width
                         + layerData->tile_width * 0.5f;
            f32 worldY = adjOriginY - static_cast<f32>(ty) * layerData->tile_height
                         - layerData->tile_height * 0.5f;

            f32 u0 = static_cast<f32>(tileCol) * uvTileWidth;
            f32 v0 = static_cast<f32>(tileRow) * uvTileHeight;
            f32 su = uvTileWidth;
            f32 sv = uvTileHeight;

            if (flipH) { u0 += uvTileWidth; su = -su; }
            if (flipV) { v0 += uvTileHeight; sv = -sv; }

            frame->submitTileQuad(
                glm::vec2(worldX, worldY),
                glm::vec2(layerData->tile_width, layerData->tile_height),
                glm::vec2(u0, v0), glm::vec2(su, sv),
                finalColor, glTextureId,
                layerEntity, sortLayer, depth
            );
        }
    }
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
        chunk.dirty = true;
        layer->chunks[tilemap::ChunkCoord{cx, cy}] = chunk;
    }

    return true;
}

// --- Tiled map loader bindings ---

u32 tiled_loadMap(uintptr_t dataPtr, u32 dataSize) {
    const auto* data = reinterpret_cast<const char*>(dataPtr);
    return getTiledLoader().loadFromMemory(data, dataSize);
}

void tiled_freeMap(u32 handle) {
    getTiledLoader().freeMap(handle);
}

u32 tiled_getExternalTilesetCount(u32 handle) {
    return getTiledLoader().getExternalTilesetCount(handle);
}

std::string tiled_getExternalTilesetSource(u32 handle, u32 index) {
    return getTiledLoader().getExternalTilesetSource(handle, index);
}

bool tiled_loadExternalTileset(u32 handle, u32 index,
                                uintptr_t dataPtr, u32 dataSize) {
    const auto* data = reinterpret_cast<const char*>(dataPtr);
    return getTiledLoader().loadExternalTileset(handle, index, data, dataSize);
}

bool tiled_finalize(u32 handle) {
    return getTiledLoader().finalize(handle);
}

u32 tiled_getMapWidth(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? map->width : 0;
}

u32 tiled_getMapHeight(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? map->height : 0;
}

u32 tiled_getMapTileWidth(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? map->tile_width : 0;
}

u32 tiled_getMapTileHeight(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? map->tile_height : 0;
}

u32 tiled_getLayerCount(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? static_cast<u32>(map->layers.size()) : 0;
}

std::string tiled_getLayerName(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return "";
    return map->layers[index].name;
}

u32 tiled_getLayerWidth(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return map->layers[index].width;
}

u32 tiled_getLayerHeight(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return map->layers[index].height;
}

bool tiled_getLayerVisible(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return false;
    return map->layers[index].visible;
}

u32 tiled_getLayerTiles(u32 handle, u32 index,
                         uintptr_t outPtr, u32 maxCount) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 0;

    const auto& tiles = map->layers[index].tiles;
    u32 count = std::min(static_cast<u32>(tiles.size()), maxCount);
    auto* out = reinterpret_cast<u16*>(outPtr);
    std::memcpy(out, tiles.data(), count * sizeof(u16));
    return count;
}

u32 tiled_getTilesetCount(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? static_cast<u32>(map->tilesets.size()) : 0;
}

std::string tiled_getTilesetName(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return "";
    return map->tilesets[index].name;
}

std::string tiled_getTilesetImage(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return "";
    return map->tilesets[index].image;
}

u32 tiled_getTilesetTileWidth(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_width;
}

u32 tiled_getTilesetTileHeight(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_height;
}

u32 tiled_getTilesetColumns(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].columns;
}

u32 tiled_getTilesetTileCount(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_count;
}

u32 tiled_getObjectGroupCount(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? static_cast<u32>(map->object_groups.size()) : 0;
}

std::string tiled_getObjectGroupName(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->object_groups.size()) return "";
    return map->object_groups[index].name;
}

u32 tiled_getObjectCount(u32 handle, u32 groupIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    return static_cast<u32>(map->object_groups[groupIndex].objects.size());
}

f32 tiled_getObjectX(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return grp.objects[objIndex].x;
}

f32 tiled_getObjectY(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return grp.objects[objIndex].y;
}

f32 tiled_getObjectWidth(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return grp.objects[objIndex].width;
}

f32 tiled_getObjectHeight(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return grp.objects[objIndex].height;
}

f32 tiled_getObjectRotation(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return grp.objects[objIndex].rotation;
}

bool tiled_getObjectEllipse(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return false;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return false;
    return grp.objects[objIndex].ellipse;
}

bool tiled_getObjectPoint(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return false;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return false;
    return grp.objects[objIndex].point;
}

u32 tiled_getObjectVertexCount(u32 handle, u32 groupIndex, u32 objIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    return static_cast<u32>(grp.objects[objIndex].vert_count);
}

u32 tiled_getObjectVertices(u32 handle, u32 groupIndex, u32 objIndex,
                             uintptr_t outPtr, u32 maxFloats) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || groupIndex >= map->object_groups.size()) return 0;
    const auto& grp = map->object_groups[groupIndex];
    if (objIndex >= grp.objects.size()) return 0;
    const auto& verts = grp.objects[objIndex].vertices;
    u32 count = std::min(static_cast<u32>(verts.size()), maxFloats);
    auto* out = reinterpret_cast<f32*>(outPtr);
    std::memcpy(out, verts.data(), count * sizeof(f32));
    return count;
}

f32 tiled_getLayerOpacity(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 1.0f;
    return map->layers[index].opacity;
}

u32 tiled_getLayerTintColor(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return map->layers[index].tint_color;
}

f32 tiled_getLayerParallaxX(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 1.0f;
    return map->layers[index].parallax_x;
}

f32 tiled_getLayerParallaxY(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 1.0f;
    return map->layers[index].parallax_y;
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
    const auto* tiles = reinterpret_cast<const u16*>(tilesPtr);
    getTilemapSystem().setChunkTiles(e, chunkX, chunkY, tiles, width, height);
}

bool tiled_isMapInfinite(u32 handle) {
    const auto* map = getTiledLoader().getMap(handle);
    return map ? map->infinite : false;
}

bool tiled_isLayerInfinite(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return false;
    return map->layers[index].infinite;
}

u32 tiled_getLayerChunkCount(u32 handle, u32 index) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return static_cast<u32>(map->layers[index].chunks.size());
}

i32 tiled_getLayerChunkX(u32 handle, u32 layerIndex, u32 chunkIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || layerIndex >= map->layers.size()) return 0;
    const auto& chunks = map->layers[layerIndex].chunks;
    if (chunkIndex >= chunks.size()) return 0;
    return chunks[chunkIndex].x;
}

i32 tiled_getLayerChunkY(u32 handle, u32 layerIndex, u32 chunkIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || layerIndex >= map->layers.size()) return 0;
    const auto& chunks = map->layers[layerIndex].chunks;
    if (chunkIndex >= chunks.size()) return 0;
    return chunks[chunkIndex].y;
}

u32 tiled_getLayerChunkWidth(u32 handle, u32 layerIndex, u32 chunkIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || layerIndex >= map->layers.size()) return 0;
    const auto& chunks = map->layers[layerIndex].chunks;
    if (chunkIndex >= chunks.size()) return 0;
    return chunks[chunkIndex].width;
}

u32 tiled_getLayerChunkHeight(u32 handle, u32 layerIndex, u32 chunkIndex) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || layerIndex >= map->layers.size()) return 0;
    const auto& chunks = map->layers[layerIndex].chunks;
    if (chunkIndex >= chunks.size()) return 0;
    return chunks[chunkIndex].height;
}

u32 tiled_getLayerChunkTiles(u32 handle, u32 layerIndex, u32 chunkIndex,
                              uintptr_t outPtr, u32 maxCount) {
    const auto* map = getTiledLoader().getMap(handle);
    if (!map || layerIndex >= map->layers.size()) return 0;
    const auto& chunks = map->layers[layerIndex].chunks;
    if (chunkIndex >= chunks.size()) return 0;
    const auto& tiles = chunks[chunkIndex].tiles;
    u32 count = std::min(static_cast<u32>(tiles.size()), maxCount);
    auto* out = reinterpret_cast<u16*>(outPtr);
    std::memcpy(out, tiles.data(), count * sizeof(u16));
    return count;
}

void tilemap_setTileAnimation(u32 entity, u32 tileId,
                               uintptr_t framesPtr, u32 frameCount) {
    auto e = Entity::fromRaw(entity);
    if (e == INVALID_ENTITY || !getTilemapSystem().hasLayer(e)) return;
    const auto* data = reinterpret_cast<const u32*>(framesPtr);
    std::vector<tilemap::AnimFrame> frames(frameCount);
    for (u32 i = 0; i < frameCount; i++) {
        frames[i].tile_id = static_cast<u16>(data[i * 2]);
        frames[i].duration_ms = static_cast<u16>(data[i * 2 + 1]);
    }
    getTilemapSystem().setTileAnimation(e, static_cast<u16>(tileId),
                                     frames.data(), frameCount);
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

EMSCRIPTEN_BINDINGS(esengine_tilemap) {
    emscripten::function("tilemap_initLayer", &esengine::tilemap_initLayer);
    emscripten::function("tilemap_initInfinite", &esengine::tilemap_initInfinite);
    emscripten::function("tilemap_destroyLayer", &esengine::tilemap_destroyLayer);
    emscripten::function("tilemap_setTile", &esengine::tilemap_setTile);
    emscripten::function("tilemap_getTile", &esengine::tilemap_getTile);
    emscripten::function("tilemap_fillRect", &esengine::tilemap_fillRect);
    emscripten::function("tilemap_setTiles", &esengine::tilemap_setTiles);
    emscripten::function("tilemap_hasLayer", &esengine::tilemap_hasLayer);
    emscripten::function("tilemap_submitLayer", &esengine::tilemap_submitLayer);
    emscripten::function("tilemap_setRenderProps", &esengine::tilemap_setRenderProps);
    emscripten::function("tilemap_setTint", &esengine::tilemap_setTint);
    emscripten::function("tilemap_setVisible", &esengine::tilemap_setVisible);
    emscripten::function("tilemap_setOriginEntity", &esengine::tilemap_setOriginEntity);
    emscripten::function("tilemap_exportChunks", &esengine::tilemap_exportChunks);
    emscripten::function("tilemap_importChunks", &esengine::tilemap_importChunks);

    emscripten::function("tiled_loadMap", &esengine::tiled_loadMap);
    emscripten::function("tiled_freeMap", &esengine::tiled_freeMap);
    emscripten::function("tiled_getExternalTilesetCount", &esengine::tiled_getExternalTilesetCount);
    emscripten::function("tiled_getExternalTilesetSource", &esengine::tiled_getExternalTilesetSource);
    emscripten::function("tiled_loadExternalTileset", &esengine::tiled_loadExternalTileset);
    emscripten::function("tiled_finalize", &esengine::tiled_finalize);
    emscripten::function("tiled_getMapWidth", &esengine::tiled_getMapWidth);
    emscripten::function("tiled_getMapHeight", &esengine::tiled_getMapHeight);
    emscripten::function("tiled_getMapTileWidth", &esengine::tiled_getMapTileWidth);
    emscripten::function("tiled_getMapTileHeight", &esengine::tiled_getMapTileHeight);
    emscripten::function("tiled_getLayerCount", &esengine::tiled_getLayerCount);
    emscripten::function("tiled_getLayerName", &esengine::tiled_getLayerName);
    emscripten::function("tiled_getLayerWidth", &esengine::tiled_getLayerWidth);
    emscripten::function("tiled_getLayerHeight", &esengine::tiled_getLayerHeight);
    emscripten::function("tiled_getLayerVisible", &esengine::tiled_getLayerVisible);
    emscripten::function("tiled_getLayerTiles", &esengine::tiled_getLayerTiles);
    emscripten::function("tiled_getTilesetCount", &esengine::tiled_getTilesetCount);
    emscripten::function("tiled_getTilesetName", &esengine::tiled_getTilesetName);
    emscripten::function("tiled_getTilesetImage", &esengine::tiled_getTilesetImage);
    emscripten::function("tiled_getTilesetTileWidth", &esengine::tiled_getTilesetTileWidth);
    emscripten::function("tiled_getTilesetTileHeight", &esengine::tiled_getTilesetTileHeight);
    emscripten::function("tiled_getTilesetColumns", &esengine::tiled_getTilesetColumns);
    emscripten::function("tiled_getTilesetTileCount", &esengine::tiled_getTilesetTileCount);
    emscripten::function("tiled_getObjectGroupCount", &esengine::tiled_getObjectGroupCount);
    emscripten::function("tiled_getObjectGroupName", &esengine::tiled_getObjectGroupName);
    emscripten::function("tiled_getObjectCount", &esengine::tiled_getObjectCount);
    emscripten::function("tiled_getObjectX", &esengine::tiled_getObjectX);
    emscripten::function("tiled_getObjectY", &esengine::tiled_getObjectY);
    emscripten::function("tiled_getObjectWidth", &esengine::tiled_getObjectWidth);
    emscripten::function("tiled_getObjectHeight", &esengine::tiled_getObjectHeight);
    emscripten::function("tiled_getObjectRotation", &esengine::tiled_getObjectRotation);
    emscripten::function("tiled_getObjectEllipse", &esengine::tiled_getObjectEllipse);
    emscripten::function("tiled_getObjectPoint", &esengine::tiled_getObjectPoint);
    emscripten::function("tiled_getObjectVertexCount", &esengine::tiled_getObjectVertexCount);
    emscripten::function("tiled_getObjectVertices", &esengine::tiled_getObjectVertices);
    emscripten::function("tiled_getLayerOpacity", &esengine::tiled_getLayerOpacity);
    emscripten::function("tiled_getLayerTintColor", &esengine::tiled_getLayerTintColor);
    emscripten::function("tiled_getLayerParallaxX", &esengine::tiled_getLayerParallaxX);
    emscripten::function("tiled_getLayerParallaxY", &esengine::tiled_getLayerParallaxY);

    emscripten::function("tilemap_initInfiniteLayer", &esengine::tilemap_initInfiniteLayer);
    emscripten::function("tilemap_setChunkTiles", &esengine::tilemap_setChunkTiles);
    emscripten::function("tiled_isMapInfinite", &esengine::tiled_isMapInfinite);
    emscripten::function("tiled_isLayerInfinite", &esengine::tiled_isLayerInfinite);
    emscripten::function("tiled_getLayerChunkCount", &esengine::tiled_getLayerChunkCount);
    emscripten::function("tiled_getLayerChunkX", &esengine::tiled_getLayerChunkX);
    emscripten::function("tiled_getLayerChunkY", &esengine::tiled_getLayerChunkY);
    emscripten::function("tiled_getLayerChunkWidth", &esengine::tiled_getLayerChunkWidth);
    emscripten::function("tiled_getLayerChunkHeight", &esengine::tiled_getLayerChunkHeight);
    emscripten::function("tiled_getLayerChunkTiles", &esengine::tiled_getLayerChunkTiles);

    emscripten::function("tilemap_setTileAnimation", &esengine::tilemap_setTileAnimation);
    emscripten::function("tilemap_advanceAnimations", &esengine::tilemap_advanceAnimations);
    emscripten::function("tilemap_setTileProperty", &esengine::tilemap_setTileProperty);
    emscripten::function("tilemap_getTileProperty", &esengine::tilemap_getTileProperty);
    emscripten::function("tilemap_flipTile", &esengine::tilemap_flipTile);
    emscripten::function("tilemap_rotateTile", &esengine::tilemap_rotateTile);
    emscripten::function("tilemap_setGridType", &esengine::tilemap_setGridType);
    emscripten::function("tilemap_tileToWorld", &esengine::tilemap_tileToWorld);
    emscripten::function("tilemap_worldToTile", &esengine::tilemap_worldToTile);
}

#endif  // ES_ENABLE_TILEMAP
#endif  // ES_PLATFORM_WEB
