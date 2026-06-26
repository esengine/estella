// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TilemapRenderPlugin.hpp"
#include "../BatchBuilder.hpp"

#include "../../tilemap/TilemapSystem.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/TilemapLayer.hpp"
#include "../RenderFrame.hpp"

#include <cmath>

namespace esengine {

void TilemapRenderPlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void TilemapRenderPlugin::rebuildChunk(
    const tilemap::TilemapSystem::LayerData& layer,
    const tilemap::ChunkData& chunk, tilemap::ChunkCoord coord,
    f32 originX, f32 originY, u32 packedColor,
    u32 tilesetColumns, f32 uvTileW, f32 uvTileH,
    Entity entity, ChunkCache& cache
) {
    cache.vertices.clear();
    cache.indices.clear();
    cache.has_animated_tiles = false;

    i32 baseX = coord.x * static_cast<i32>(tilemap::CHUNK_SIZE);
    i32 baseY = coord.y * static_cast<i32>(tilemap::CHUNK_SIZE);

    bool hasAnimations = !layer.tile_animations.empty();
    f32 hw = layer.tile_width * 0.5f;
    f32 hh = layer.tile_height * 0.5f;

    for (u32 ly = 0; ly < tilemap::CHUNK_SIZE; ++ly) {
        i32 ty = baseY + static_cast<i32>(ly);
        if (!layer.infinite && static_cast<u32>(ty) >= layer.height) break;

        for (u32 lx = 0; lx < tilemap::CHUNK_SIZE; ++lx) {
            i32 tx = baseX + static_cast<i32>(lx);
            if (!layer.infinite && static_cast<u32>(tx) >= layer.width) break;

            u16 rawTile = chunk.tiles[ly * tilemap::CHUNK_SIZE + lx];
            u16 tileId = rawTile & tilemap::TILE_ID_MASK;
            if (tileId == tilemap::EMPTY_TILE) continue;

            if (hasAnimations &&
                layer.tile_animations.find(tileId) != layer.tile_animations.end()) {
                cache.has_animated_tiles = true;
                tileId = tilemap_system_->resolveAnimatedTile(entity, tileId);
            }

            bool flipH = (rawTile & tilemap::TILE_FLIP_H) != 0;
            bool flipV = (rawTile & tilemap::TILE_FLIP_V) != 0;

            u32 tileIndex = tileId - 1;
            u32 tileCol = tileIndex % tilesetColumns;
            u32 tileRow = tileIndex / tilesetColumns;

            f32 worldX, worldY;
            if (layer.grid_type == tilemap::GridType::Isometric) {
                worldX = originX + static_cast<f32>(tx - ty) * hw;
                worldY = originY - static_cast<f32>(tx + ty) * hh;
            } else if (layer.grid_type == tilemap::GridType::StaggeredIsometric) {
                f32 offsetX = (ty & 1) ? hw : 0.0f;
                worldX = originX + static_cast<f32>(tx) * layer.tile_width + offsetX + hw;
                worldY = originY - static_cast<f32>(ty) * hh - hh;
            } else {
                worldX = originX + static_cast<f32>(tx) * layer.tile_width + hw;
                worldY = originY - static_cast<f32>(ty) * layer.tile_height - hh;
            }

            f32 u0 = static_cast<f32>(tileCol) * uvTileW;
            f32 v0 = 1.0f - static_cast<f32>(tileRow + 1) * uvTileH;
            f32 su = uvTileW;
            f32 sv = uvTileH;

            if (flipH) { u0 += uvTileW; su = -su; }
            if (flipV) { v0 += uvTileH; sv = -sv; }

            u32 baseVertex = static_cast<u32>(cache.vertices.size());
            cache.vertices.push_back({ {worldX - hw, worldY - hh}, packedColor, {u0, v0} });
            cache.vertices.push_back({ {worldX + hw, worldY - hh}, packedColor, {u0 + su, v0} });
            cache.vertices.push_back({ {worldX + hw, worldY + hh}, packedColor, {u0 + su, v0 + sv} });
            cache.vertices.push_back({ {worldX - hw, worldY + hh}, packedColor, {u0, v0 + sv} });

            for (u32 i = 0; i < 6; ++i) {
                cache.indices.push_back(baseVertex + BATCH_QUAD_INDICES[i]);
            }
        }
    }
}

void TilemapRenderPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    if (!tilemap_system_) return;

    const auto& layers = tilemap_system_->allLayers();
    if (layers.empty()) return;

    glm::mat4 invVP = glm::inverse(ctx.view_projection);
    glm::vec4 bl = invVP * glm::vec4(-1.0f, -1.0f, 0.0f, 1.0f);
    glm::vec4 tr = invVP * glm::vec4( 1.0f,  1.0f, 0.0f, 1.0f);
    f32 camLeft   = bl.x / bl.w;
    f32 camBottom = bl.y / bl.w;
    f32 camRight  = tr.x / tr.w;
    f32 camTop    = tr.y / tr.w;

    for (const auto& [entity, layer] : layers) {
        // RC2a: the TilemapLayer component is the single source of a painted
        // layer's visual metadata — the renderer reads it live each frame (so
        // animated tint/opacity need no sync). Tiled-imported synthetic layers
        // have no component and still carry their metadata in LayerData.
        const ecs::TilemapLayer* comp = registry.tryGet<ecs::TilemapLayer>(entity);

        bool visible;
        resource::TextureHandle tilesetHandle;
        u32 tilesetColumns;
        i32 sortLayer;
        f32 depth;
        glm::vec4 tint;
        f32 opacity;
        glm::vec2 parallax;
        if (comp) {
            visible = comp->visible;
            tilesetHandle = comp->tileset;
            tilesetColumns = static_cast<u32>(comp->tilesetColumns);
            sortLayer = comp->renderLayer;
            depth = 0.0f;
            tint = comp->tintColor;
            opacity = comp->opacity;
            parallax = comp->parallaxFactor;
        } else {
            visible = layer.visible;
            tilesetHandle = resource::TextureHandle(layer.texture_handle);
            tilesetColumns = layer.tileset_columns;
            sortLayer = layer.sort_layer;
            depth = layer.depth;
            tint = layer.tint;
            opacity = layer.opacity;
            parallax = layer.parallax_factor;
        }

        if (!visible || !tilesetHandle.isValid() || tilesetColumns == 0) continue;

        auto* texRes = ctx.resources.getTexture(tilesetHandle);
        if (!texRes) continue;
        u32 glTextureId = texRes->getId();

        // UVs derive from tile size / texture size — the single source is the
        // tile dimensions + the texture, so there is no synced uv copy to drift.
        f32 texW = static_cast<f32>(texRes->getWidth());
        f32 texH = static_cast<f32>(texRes->getHeight());
        if (texW <= 0.0f || texH <= 0.0f) continue;
        f32 uvTileW = layer.tile_width / texW;
        f32 uvTileH = layer.tile_height / texH;

        f32 originX = 0, originY = 0;
        Entity transformEntity = (layer.origin_entity != INVALID_ENTITY)
            ? layer.origin_entity : entity;
        if (auto* transform = registry.tryGet<ecs::Transform>(transformEntity)) {
            originX = transform->worldPosition.x;
            originY = transform->worldPosition.y;
        }

        glm::vec4 finalColor(tint.r, tint.g, tint.b, tint.a * opacity);
        u32 packedColor = packColor(finalColor);

        f32 camCenterX = (camLeft + camRight) * 0.5f;
        f32 camCenterY = (camBottom + camTop) * 0.5f;
        f32 parallaxOffsetX = camCenterX * (1.0f - parallax.x);
        f32 parallaxOffsetY = camCenterY * (1.0f - parallax.y);
        f32 adjOriginX = originX + parallaxOffsetX;
        f32 adjOriginY = originY + parallaxOffsetY;

        i32 chunkSize = static_cast<i32>(tilemap::CHUNK_SIZE);
        f32 chunkWorldW = static_cast<f32>(chunkSize) * layer.tile_width;
        f32 chunkWorldH = static_cast<f32>(chunkSize) * layer.tile_height;

        i32 minCX = static_cast<i32>(std::floor((camLeft - adjOriginX) / chunkWorldW));
        i32 minCY = static_cast<i32>(std::floor((adjOriginY - camTop) / chunkWorldH));
        i32 maxCX = static_cast<i32>(std::ceil((camRight - adjOriginX) / chunkWorldW));
        i32 maxCY = static_cast<i32>(std::ceil((adjOriginY - camBottom) / chunkWorldH));

        if (!layer.infinite) {
            i32 chunksX = static_cast<i32>((layer.width + tilemap::CHUNK_SIZE - 1) / tilemap::CHUNK_SIZE);
            i32 chunksY = static_cast<i32>((layer.height + tilemap::CHUNK_SIZE - 1) / tilemap::CHUNK_SIZE);
            minCX = std::max(minCX, 0);
            minCY = std::max(minCY, 0);
            maxCX = std::min(maxCX, chunksX);
            maxCY = std::min(maxCY, chunksY);
        }

        if (minCX >= maxCX || minCY >= maxCY) continue;

        auto& chunkCaches = layer_caches_[entity];

        vertices_.clear();
        indices_.clear();

        for (i32 cy = minCY; cy < maxCY; ++cy) {
            for (i32 cx = minCX; cx < maxCX; ++cx) {
                tilemap::ChunkCoord coord{cx, cy};
                auto chunkIt = layer.chunks.find(coord);
                if (chunkIt == layer.chunks.end()) continue;

                const auto& chunkData = chunkIt->second;
                auto& cache = chunkCaches[coord];

                if (chunkData.revision != cache.built_revision || cache.has_animated_tiles) {
                    rebuildChunk(layer, chunkData, coord,
                                adjOriginX, adjOriginY, packedColor,
                                tilesetColumns, uvTileW, uvTileH,
                                entity, cache);
                    cache.built_revision = chunkData.revision;
                }

                if (cache.indices.empty()) continue;

                u32 baseVertex = static_cast<u32>(vertices_.size());
                vertices_.insert(vertices_.end(), cache.vertices.begin(), cache.vertices.end());
                for (u32 idx : cache.indices) {
                    indices_.push_back(baseVertex + idx);
                }
            }
        }

        if (indices_.empty()) continue;

        // indices_ are 0-based within the merged vertices_; appendIndexedBatch rebases them
        // onto the pool's baseVertex and assembles the command.
        appendIndexedBatch(buffers, draw_list, clips,
            vertices_.data(), static_cast<u32>(vertices_.size()),
            indices_.data(), static_cast<u32>(indices_.size()),
            BatchDrawKey{
                .stage = ctx.current_stage,
                .layer = sortLayer,
                .shaderId = batch_shader_id_,
                .blend = BlendMode::Normal,
                .textureId = glTextureId,
                .depth = depth,
                .entity = entity,
                .type = RenderType::Sprite,
            });
    }

    for (auto it = layer_caches_.begin(); it != layer_caches_.end(); ) {
        if (layers.find(it->first) == layers.end()) {
            it = layer_caches_.erase(it);
        } else {
            ++it;
        }
    }
}

}  // namespace esengine
