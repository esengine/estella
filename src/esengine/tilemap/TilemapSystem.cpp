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

static std::string s_propertyResult;

const char* TilemapSystem::getTileProperty(Entity entity, u16 tileId,
                                            const std::string& key) const {
    const auto* layer = getLayerData(entity);
    if (!layer) return "";

    auto tileIt = layer->tile_properties.find(tileId);
    if (tileIt == layer->tile_properties.end()) return "";

    auto propIt = tileIt->second.find(key);
    if (propIt == tileIt->second.end()) return "";

    s_propertyResult = propIt->second;
    return s_propertyResult.c_str();
}

void TilemapSystem::flipTile(Entity entity, i32 x, i32 y,
                              bool flipH, bool flipV, bool flipD) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    if (x < 0 || y < 0 ||
        static_cast<u32>(x) >= layer->width ||
        static_cast<u32>(y) >= layer->height) return;

    auto idx = static_cast<usize>(y) * layer->width + static_cast<usize>(x);
    u16 raw = layer->tiles[idx];
    u16 id = raw & TILE_ID_MASK;
    if (id == EMPTY_TILE) return;

    u16 flags = 0;
    if (flipH) flags |= TILE_FLIP_H;
    if (flipV) flags |= TILE_FLIP_V;
    if (flipD) flags |= TILE_FLIP_D;
    layer->tiles[idx] = id | flags;
}

void TilemapSystem::rotateTile(Entity entity, i32 x, i32 y, i32 degrees) {
    auto* layer = getLayerDataMut(entity);
    if (!layer) return;
    if (x < 0 || y < 0 ||
        static_cast<u32>(x) >= layer->width ||
        static_cast<u32>(y) >= layer->height) return;

    auto idx = static_cast<usize>(y) * layer->width + static_cast<usize>(x);
    u16 raw = layer->tiles[idx];
    u16 id = raw & TILE_ID_MASK;
    if (id == EMPTY_TILE) return;

    i32 rot = ((degrees % 360) + 360) % 360;
    u16 flags = 0;
    switch (rot) {
        case 90:  flags = TILE_FLIP_H | TILE_FLIP_D; break;
        case 180: flags = TILE_FLIP_H | TILE_FLIP_V; break;
        case 270: flags = TILE_FLIP_V | TILE_FLIP_D; break;
        default: break;
    }
    layer->tiles[idx] = id | flags;
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
