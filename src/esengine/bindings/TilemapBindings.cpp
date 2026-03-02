#ifdef ES_PLATFORM_WEB

#include "EngineContext.hpp"
#include "../tilemap/TilemapSystem.hpp"
#include "../tilemap/TiledMapLoader.hpp"
#include "../renderer/RenderContext.hpp"
#include "../renderer/RenderFrame.hpp"
#include "../renderer/RenderItem.hpp"
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

namespace esengine {

static tilemap::TilemapSystem s_tilemapSystem;
static tilemap::TiledMapLoader s_tiledLoader;

static EngineContext& ctx() { return EngineContext::instance(); }

void tilemap_initLayer(u32 entity, u32 width, u32 height,
                       f32 tileWidth, f32 tileHeight) {
    s_tilemapSystem.initLayer(static_cast<Entity>(entity),
                              width, height, tileWidth, tileHeight);
}

void tilemap_destroyLayer(u32 entity) {
    s_tilemapSystem.destroyLayer(static_cast<Entity>(entity));
}

void tilemap_setTile(u32 entity, i32 x, i32 y, u32 tileId) {
    s_tilemapSystem.setTile(static_cast<Entity>(entity),
                            x, y, static_cast<u16>(tileId));
}

u32 tilemap_getTile(u32 entity, i32 x, i32 y) {
    return s_tilemapSystem.getTile(static_cast<Entity>(entity), x, y);
}

void tilemap_fillRect(u32 entity, i32 x, i32 y,
                      u32 w, u32 h, u32 tileId) {
    s_tilemapSystem.fillRect(static_cast<Entity>(entity),
                             x, y, w, h, static_cast<u16>(tileId));
}

void tilemap_setTiles(u32 entity, uintptr_t tilesPtr, u32 count) {
    const auto* tiles = reinterpret_cast<const u16*>(tilesPtr);
    s_tilemapSystem.setTiles(static_cast<Entity>(entity), tiles, count);
}

bool tilemap_hasLayer(u32 entity) {
    return s_tilemapSystem.hasLayer(static_cast<Entity>(entity));
}

void tilemap_submitLayer(u32 entity, u32 textureId,
                         i32 sortLayer, f32 depth,
                         u32 tilesetColumns,
                         f32 uvTileWidth, f32 uvTileHeight,
                         f32 originX, f32 originY,
                         f32 camLeft, f32 camBottom,
                         f32 camRight, f32 camTop) {
    auto* frame = ctx().renderFrame();
    if (!frame) return;

    auto* rm = ctx().resourceManager();
    if (!rm) return;
    auto texHandle = resource::TextureHandle(textureId);
    auto* tex = rm->getTexture(texHandle);
    if (!tex) return;
    u32 glTextureId = tex->getId();

    auto layerEntity = static_cast<Entity>(entity);
    const auto* layerData = s_tilemapSystem.getLayerData(layerEntity);
    if (!layerData) return;

    auto range = tilemap::computeVisibleRange(
        camLeft, -camTop, camRight, -camBottom,
        originX, -originY,
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

            f32 worldX = originX + static_cast<f32>(tx) * layerData->tile_width
                         + layerData->tile_width * 0.5f;
            f32 worldY = originY - static_cast<f32>(ty) * layerData->tile_height
                         - layerData->tile_height * 0.5f;

            f32 u0 = static_cast<f32>(tileCol) * uvTileWidth;
            f32 v0 = static_cast<f32>(tileRow) * uvTileHeight;
            f32 su = uvTileWidth;
            f32 sv = uvTileHeight;

            if (flipH) { u0 += uvTileWidth; su = -su; }
            if (flipV) { v0 += uvTileHeight; sv = -sv; }

            RenderItemBase base;
            base.entity = layerEntity;
            base.type = RenderType::Sprite;
            base.stage = RenderStage::Transparent;
            base.world_position = glm::vec3(worldX, worldY, 0.0f);
            base.world_scale = glm::vec2(1.0f);
            base.world_angle = 0.0f;
            base.layer = sortLayer;
            base.depth = depth;
            base.color = glm::vec4(1.0f);
            base.texture_id = glTextureId;

            SpriteData sd;
            sd.size = glm::vec2(layerData->tile_width, layerData->tile_height);
            sd.uv_offset = glm::vec2(u0, v0);
            sd.uv_scale = glm::vec2(su, sv);

            frame->submit(base, sd);
        }
    }
}

// --- Tiled map loader bindings ---

u32 tiled_loadMap(uintptr_t dataPtr, u32 dataSize) {
    const auto* data = reinterpret_cast<const char*>(dataPtr);
    return s_tiledLoader.loadFromMemory(data, dataSize);
}

void tiled_freeMap(u32 handle) {
    s_tiledLoader.freeMap(handle);
}

u32 tiled_getExternalTilesetCount(u32 handle) {
    return s_tiledLoader.getExternalTilesetCount(handle);
}

std::string tiled_getExternalTilesetSource(u32 handle, u32 index) {
    return s_tiledLoader.getExternalTilesetSource(handle, index);
}

bool tiled_loadExternalTileset(u32 handle, u32 index,
                                uintptr_t dataPtr, u32 dataSize) {
    const auto* data = reinterpret_cast<const char*>(dataPtr);
    return s_tiledLoader.loadExternalTileset(handle, index, data, dataSize);
}

bool tiled_finalize(u32 handle) {
    return s_tiledLoader.finalize(handle);
}

u32 tiled_getMapWidth(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? map->width : 0;
}

u32 tiled_getMapHeight(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? map->height : 0;
}

u32 tiled_getMapTileWidth(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? map->tile_width : 0;
}

u32 tiled_getMapTileHeight(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? map->tile_height : 0;
}

u32 tiled_getLayerCount(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? static_cast<u32>(map->layers.size()) : 0;
}

std::string tiled_getLayerName(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->layers.size()) return "";
    return map->layers[index].name;
}

u32 tiled_getLayerWidth(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return map->layers[index].width;
}

u32 tiled_getLayerHeight(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->layers.size()) return 0;
    return map->layers[index].height;
}

bool tiled_getLayerVisible(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->layers.size()) return false;
    return map->layers[index].visible;
}

u32 tiled_getLayerTiles(u32 handle, u32 index,
                         uintptr_t outPtr, u32 maxCount) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->layers.size()) return 0;

    const auto& tiles = map->layers[index].tiles;
    u32 count = std::min(static_cast<u32>(tiles.size()), maxCount);
    auto* out = reinterpret_cast<u16*>(outPtr);
    std::memcpy(out, tiles.data(), count * sizeof(u16));
    return count;
}

u32 tiled_getTilesetCount(u32 handle) {
    const auto* map = s_tiledLoader.getMap(handle);
    return map ? static_cast<u32>(map->tilesets.size()) : 0;
}

std::string tiled_getTilesetName(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return "";
    return map->tilesets[index].name;
}

std::string tiled_getTilesetImage(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return "";
    return map->tilesets[index].image;
}

u32 tiled_getTilesetTileWidth(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_width;
}

u32 tiled_getTilesetTileHeight(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_height;
}

u32 tiled_getTilesetColumns(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].columns;
}

u32 tiled_getTilesetTileCount(u32 handle, u32 index) {
    const auto* map = s_tiledLoader.getMap(handle);
    if (!map || index >= map->tilesets.size()) return 0;
    return map->tilesets[index].tile_count;
}

}  // namespace esengine

EMSCRIPTEN_BINDINGS(esengine_tilemap) {
    emscripten::function("tilemap_initLayer", &esengine::tilemap_initLayer);
    emscripten::function("tilemap_destroyLayer", &esengine::tilemap_destroyLayer);
    emscripten::function("tilemap_setTile", &esengine::tilemap_setTile);
    emscripten::function("tilemap_getTile", &esengine::tilemap_getTile);
    emscripten::function("tilemap_fillRect", &esengine::tilemap_fillRect);
    emscripten::function("tilemap_setTiles", &esengine::tilemap_setTiles);
    emscripten::function("tilemap_hasLayer", &esengine::tilemap_hasLayer);
    emscripten::function("tilemap_submitLayer", &esengine::tilemap_submitLayer);

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
}

#endif  // ES_PLATFORM_WEB
