// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TilemapRenderPlugin.hpp"
#include "../BatchBuilder.hpp"

#include "../../tilemap/TilemapSystem.hpp"
#include "../../tilemap/TileFlip.hpp"
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
    const std::vector<tilemap::TilesetSlot>& slots,
    const std::vector<ResolvedSlot>& resolved,
    Entity entity, ChunkCache& cache
) {
    cache.slots.resize(slots.size());
    for (auto& mesh : cache.slots) { mesh.vertices.clear(); mesh.indices.clear(); }
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

            // Resolve which tileset (slot) this tile belongs to, then its local
            // index within that tileset. A tile whose tileset texture is missing
            // is skipped.
            int slotIndex = tilemap::resolveTilesetSlot(slots, tileId);
            if (slotIndex < 0 || !resolved[slotIndex].valid) continue;
            u32 tilesetColumns = slots[slotIndex].columns;
            if (tilesetColumns == 0) continue;
            f32 uvTileW = resolved[slotIndex].uvW;
            f32 uvTileH = resolved[slotIndex].uvH;

            bool flipH = (rawTile & tilemap::TILE_FLIP_H) != 0;
            bool flipV = (rawTile & tilemap::TILE_FLIP_V) != 0;
            bool flipD = (rawTile & tilemap::TILE_FLIP_D) != 0;

            u32 tileIndex = tileId - slots[slotIndex].first_id;
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

            // Base tile UV rect (GL v increases upward, so vBottom < vTop).
            f32 uMin = static_cast<f32>(tileCol) * uvTileW;
            f32 uMax = uMin + uvTileW;
            f32 vBottom = 1.0f - static_cast<f32>(tileRow + 1) * uvTileH;
            f32 vTop = vBottom + uvTileH;

            // Map a corner's normalized (s,t) in {0,1}^2 to its texture UV, applying
            // the tile flip flags. Tiled order — diagonal (transpose) first, then H,
            // then V — so the standard 90°/270° combos (H|D, V|D) come out as true
            // rotations. H/V-only reduce to the previous behavior exactly.
            auto cornerUV = [&](f32 s, f32 t) -> glm::vec2 {
                tilemap::applyTileFlip(s, t, flipH, flipV, flipD);
                return glm::vec2{ uMin + s * (uMax - uMin), vBottom + t * (vTop - vBottom) };
            };

            glm::vec2 bl = cornerUV(0.0f, 0.0f);
            glm::vec2 br = cornerUV(1.0f, 0.0f);
            glm::vec2 tr = cornerUV(1.0f, 1.0f);
            glm::vec2 tl = cornerUV(0.0f, 1.0f);

            SlotMesh& mesh = cache.slots[slotIndex];
            u32 baseVertex = static_cast<u32>(mesh.vertices.size());
            mesh.vertices.push_back({ {worldX - hw, worldY - hh}, packedColor, {bl.x, bl.y} });
            mesh.vertices.push_back({ {worldX + hw, worldY - hh}, packedColor, {br.x, br.y} });
            mesh.vertices.push_back({ {worldX + hw, worldY + hh}, packedColor, {tr.x, tr.y} });
            mesh.vertices.push_back({ {worldX - hw, worldY + hh}, packedColor, {tl.x, tl.y} });

            for (u32 i = 0; i < 6; ++i) {
                mesh.indices.push_back(baseVertex + BATCH_QUAD_INDICES[i]);
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
        i32 sortLayer;
        f32 depth;
        glm::vec4 tint;
        f32 opacity;
        glm::vec2 parallax;
        resource::TextureHandle singleTileset;  // single-tileset fallback source
        u32 singleColumns;
        if (comp) {
            visible = comp->visible;
            sortLayer = comp->renderLayer;
            depth = 0.0f;
            tint = comp->tintColor;
            opacity = comp->opacity;
            parallax = comp->parallaxFactor;
            singleTileset = comp->tileset;
            singleColumns = static_cast<u32>(comp->tilesetColumns);
        } else {
            visible = layer.visible;
            sortLayer = layer.sort_layer;
            depth = layer.depth;
            tint = layer.tint;
            opacity = layer.opacity;
            parallax = layer.parallax_factor;
            singleTileset = resource::TextureHandle(layer.texture_handle);
            singleColumns = layer.tileset_columns;
        }

        if (!visible) continue;

        // The layer's tileset slot list: the multi-tileset table when present
        // (Tiled imports), else a single slot from the painted/synthetic tileset.
        std::vector<tilemap::TilesetSlot> slots;
        if (!layer.tilesets.empty()) {
            slots = layer.tilesets;
        } else {
            if (!singleTileset.isValid() || singleColumns == 0) continue;
            slots.push_back(tilemap::TilesetSlot{ 1, singleTileset.id(), singleColumns });
        }

        // Resolve each slot's texture + UV scale (tile size / texture size). Kept
        // parallel to `slots`; a slot whose texture is missing renders nothing.
        std::vector<ResolvedSlot> resolved(slots.size());
        bool anySlotValid = false;
        for (usize i = 0; i < slots.size(); ++i) {
            auto* tex = ctx.resources.getTexture(resource::TextureHandle(slots[i].texture_handle));
            if (!tex) continue;
            f32 tw = static_cast<f32>(tex->getWidth());
            f32 th = static_cast<f32>(tex->getHeight());
            if (tw <= 0.0f || th <= 0.0f) continue;
            resolved[i].valid = true;
            resolved[i].glTexId = tex->getId();
            resolved[i].uvW = layer.tile_width / tw;
            resolved[i].uvH = layer.tile_height / th;
            anySlotValid = true;
        }
        if (!anySlotValid) continue;

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

        // Per-slot merged geometry for this layer (one draw call per slot/texture).
        std::vector<std::vector<BatchVertex>> slotVertices(slots.size());
        std::vector<std::vector<u32>> slotIndices(slots.size());

        for (i32 cy = minCY; cy < maxCY; ++cy) {
            for (i32 cx = minCX; cx < maxCX; ++cx) {
                tilemap::ChunkCoord coord{cx, cy};
                auto chunkIt = layer.chunks.find(coord);
                if (chunkIt == layer.chunks.end()) continue;

                const auto& chunkData = chunkIt->second;
                auto& cache = chunkCaches[coord];

                if (chunkData.revision != cache.built_revision
                    || cache.has_animated_tiles
                    || cache.slots.size() != slots.size()) {
                    rebuildChunk(layer, chunkData, coord,
                                adjOriginX, adjOriginY, packedColor,
                                slots, resolved, entity, cache);
                    cache.built_revision = chunkData.revision;
                }

                for (usize si = 0; si < slots.size() && si < cache.slots.size(); ++si) {
                    const SlotMesh& mesh = cache.slots[si];
                    if (mesh.indices.empty()) continue;
                    u32 baseVertex = static_cast<u32>(slotVertices[si].size());
                    slotVertices[si].insert(slotVertices[si].end(),
                                            mesh.vertices.begin(), mesh.vertices.end());
                    for (u32 idx : mesh.indices) {
                        slotIndices[si].push_back(baseVertex + idx);
                    }
                }
            }
        }

        // Emit one batch per tileset slot that produced geometry. Indices are
        // 0-based within each slot's merged vertices; appendIndexedBatch rebases them.
        for (usize si = 0; si < slots.size(); ++si) {
            if (!resolved[si].valid || slotIndices[si].empty()) continue;
            appendIndexedBatch(buffers, draw_list, clips,
                slotVertices[si].data(), static_cast<u32>(slotVertices[si].size()),
                slotIndices[si].data(), static_cast<u32>(slotIndices[si].size()),
                BatchDrawKey{
                    .stage = ctx.current_stage,
                    .layer = sortLayer,
                    .shaderId = batch_shader_id_,
                    .blend = BlendMode::Normal,
                    .textureId = resolved[si].glTexId,
                    .depth = depth,
                    .entity = entity,
                    .type = RenderType::Sprite,
                });
        }
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
