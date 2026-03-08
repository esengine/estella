#include "TilemapRenderPlugin.hpp"

#include "../../tilemap/TilemapSystem.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../RenderFrame.hpp"

#include <glm/gtc/matrix_inverse.hpp>
#include <cmath>

namespace esengine {

static constexpr u16 QUAD_IDX[6] = { 0, 1, 2, 2, 3, 0 };

void TilemapRenderPlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

u32 TilemapRenderPlugin::packColor(const glm::vec4& c) {
    u8 r = static_cast<u8>(c.r * 255.0f + 0.5f);
    u8 g = static_cast<u8>(c.g * 255.0f + 0.5f);
    u8 b = static_cast<u8>(c.b * 255.0f + 0.5f);
    u8 a = static_cast<u8>(c.a * 255.0f + 0.5f);
    return (static_cast<u32>(a) << 24) |
           (static_cast<u32>(b) << 16) |
           (static_cast<u32>(g) << 8) |
           static_cast<u32>(r);
}

void TilemapRenderPlugin::collect(
    ecs::Registry& registry,
    const Frustum& /* frustum */,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
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
        if (!layer.visible || layer.texture_handle == 0 || layer.tileset_columns == 0) continue;

        auto* texRes = ctx.resources.getTexture(resource::TextureHandle(layer.texture_handle));
        if (!texRes) continue;
        u32 glTextureId = texRes->getId();

        f32 originX = 0, originY = 0;
        Entity transformEntity = (layer.origin_entity != INVALID_ENTITY)
            ? layer.origin_entity : entity;
        if (auto* transform = registry.tryGet<ecs::Transform>(transformEntity)) {
            originX = transform->worldPosition.x;
            originY = transform->worldPosition.y;
        }

        glm::vec4 finalColor(
            layer.tint.r, layer.tint.g, layer.tint.b,
            layer.tint.a * layer.opacity);
        u32 packedColor = packColor(finalColor);

        f32 camCenterX = (camLeft + camRight) * 0.5f;
        f32 camCenterY = (camBottom + camTop) * 0.5f;
        f32 parallaxOffsetX = camCenterX * (1.0f - layer.parallax_factor.x);
        f32 parallaxOffsetY = camCenterY * (1.0f - layer.parallax_factor.y);
        f32 adjOriginX = originX + parallaxOffsetX;
        f32 adjOriginY = originY + parallaxOffsetY;

        auto range = tilemap::computeVisibleRange(
            camLeft, -camTop, camRight, -camBottom,
            adjOriginX, -adjOriginY,
            layer.tile_width, layer.tile_height,
            layer.width, layer.height);
        if (range.empty()) continue;

        vertices_.clear();
        indices_.clear();

        for (i32 ty = range.min_y; ty < range.max_y; ++ty) {
            for (i32 tx = range.min_x; tx < range.max_x; ++tx) {
                u16 rawTile = layer.tiles[
                    static_cast<usize>(ty) * layer.width + static_cast<usize>(tx)];

                u16 tileId = rawTile & tilemap::TILE_ID_MASK;
                if (tileId == tilemap::EMPTY_TILE) continue;

                bool flipH = (rawTile & tilemap::TILE_FLIP_H) != 0;
                bool flipV = (rawTile & tilemap::TILE_FLIP_V) != 0;

                u32 tileIndex = tileId - 1;
                u32 tileCol = tileIndex % layer.tileset_columns;
                u32 tileRow = tileIndex / layer.tileset_columns;

                f32 worldX = adjOriginX + static_cast<f32>(tx) * layer.tile_width
                             + layer.tile_width * 0.5f;
                f32 worldY = adjOriginY - static_cast<f32>(ty) * layer.tile_height
                             - layer.tile_height * 0.5f;

                f32 u0 = static_cast<f32>(tileCol) * layer.uv_tile_width;
                f32 v0 = static_cast<f32>(tileRow) * layer.uv_tile_height;
                f32 su = layer.uv_tile_width;
                f32 sv = layer.uv_tile_height;

                if (flipH) { u0 += layer.uv_tile_width; su = -su; }
                if (flipV) { v0 += layer.uv_tile_height; sv = -sv; }

                f32 hw = layer.tile_width * 0.5f;
                f32 hh = layer.tile_height * 0.5f;

                u16 baseVertex = static_cast<u16>(vertices_.size());
                vertices_.push_back({ {worldX - hw, worldY - hh}, packedColor, {u0, v0} });
                vertices_.push_back({ {worldX + hw, worldY - hh}, packedColor, {u0 + su, v0} });
                vertices_.push_back({ {worldX + hw, worldY + hh}, packedColor, {u0 + su, v0 + sv} });
                vertices_.push_back({ {worldX - hw, worldY + hh}, packedColor, {u0, v0 + sv} });

                for (u32 i = 0; i < 6; ++i) {
                    indices_.push_back(baseVertex + QUAD_IDX[i]);
                }
            }
        }

        if (indices_.empty()) continue;

        u32 vBytes = static_cast<u32>(vertices_.size()) * sizeof(TileVertex);
        u32 vOff = buffers.appendVertices(vertices_.data(), vBytes);
        u32 baseVertex = vOff / sizeof(TileVertex);

        for (auto& idx : indices_) {
            idx = static_cast<u16>(idx + baseVertex);
        }
        u32 iOff = buffers.appendIndices(indices_.data(), static_cast<u32>(indices_.size()));

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(
            ctx.current_stage, layer.sort_layer, batch_shader_id_,
            BlendMode::Normal, 0, glTextureId, layer.depth);
        cmd.index_offset = iOff;
        cmd.index_count = static_cast<u32>(indices_.size());
        cmd.vertex_byte_offset = vOff;
        cmd.shader_id = batch_shader_id_;
        cmd.blend_mode = BlendMode::Normal;
        cmd.layout_id = LayoutId::Batch;
        cmd.texture_count = 1;
        cmd.texture_ids[0] = glTextureId;
        cmd.entity = entity;
        cmd.type = RenderType::Sprite;
        cmd.layer = layer.sort_layer;

        clips.applyTo(entity, cmd);

        draw_list.push(cmd);
    }
}

}  // namespace esengine
