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

void TilemapSystem::initLayer(Entity entity, u32 width, u32 height,
                               f32 tileWidth, f32 tileHeight) {
    LayerData layer;
    layer.width = width;
    layer.height = height;
    layer.tile_width = tileWidth;
    layer.tile_height = tileHeight;
    layer.tiles.resize(static_cast<usize>(width) * height, EMPTY_TILE);
    layers_[entity] = std::move(layer);
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
    if (x < 0 || y < 0 ||
        static_cast<u32>(x) >= layer.width ||
        static_cast<u32>(y) >= layer.height) {
        return;
    }

    layer.tiles[static_cast<usize>(y) * layer.width + static_cast<usize>(x)] = tileId;
}

u16 TilemapSystem::getTile(Entity entity, i32 x, i32 y) const {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return EMPTY_TILE;

    const auto& layer = it->second;
    if (x < 0 || y < 0 ||
        static_cast<u32>(x) >= layer.width ||
        static_cast<u32>(y) >= layer.height) {
        return EMPTY_TILE;
    }

    return layer.tiles[static_cast<usize>(y) * layer.width + static_cast<usize>(x)];
}

void TilemapSystem::fillRect(Entity entity, i32 x, i32 y,
                              u32 w, u32 h, u16 tileId) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return;

    auto& layer = it->second;
    i32 x0 = std::max(x, 0);
    i32 y0 = std::max(y, 0);
    i32 x1 = std::min(x + static_cast<i32>(w), static_cast<i32>(layer.width));
    i32 y1 = std::min(y + static_cast<i32>(h), static_cast<i32>(layer.height));

    for (i32 ty = y0; ty < y1; ++ty) {
        for (i32 tx = x0; tx < x1; ++tx) {
            layer.tiles[static_cast<usize>(ty) * layer.width + static_cast<usize>(tx)] = tileId;
        }
    }
}

void TilemapSystem::setTiles(Entity entity, const u16* tiles, u32 count) {
    auto it = layers_.find(entity);
    if (it == layers_.end()) return;

    auto& layer = it->second;
    u32 copyCount = std::min(count,
                             static_cast<u32>(layer.tiles.size()));
    std::memcpy(layer.tiles.data(), tiles, copyCount * sizeof(u16));
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

}  // namespace esengine::tilemap
