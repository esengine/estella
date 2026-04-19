#include "RenderFrame.hpp"
#include "BatchVertex.hpp"

#include <glm/gtc/type_ptr.hpp>

#include <algorithm>
#include <vector>

namespace esengine {

namespace {
static constexpr u16 TILE_QUAD_IDX[6] = { 0, 1, 2, 2, 3, 0 };
}  // namespace

void RenderFrame::submitTileQuad(
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec4& color, u32 textureId,
    Entity entity, i32 layer, f32 depth
) {
    f32 hw = size.x * 0.5f;
    f32 hh = size.y * 0.5f;
    u32 pc = packColor(color);

    BatchVertex verts[4];
    verts[0] = { {position.x - hw, position.y - hh}, pc, uvOffset };
    verts[1] = { {position.x + hw, position.y - hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y} };
    verts[2] = { {position.x + hw, position.y + hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y + uvScale.y} };
    verts[3] = { {position.x - hw, position.y + hh}, pc, {uvOffset.x, uvOffset.y + uvScale.y} };

    u32 vOff = pool_.appendVertices(LayoutId::Batch, verts, sizeof(verts));
    u32 baseVertex = vOff / sizeof(BatchVertex);

    u16 indices[6];
    for (u32 i = 0; i < 6; ++i) {
        indices[i] = static_cast<u16>(baseVertex + TILE_QUAD_IDX[i]);
    }
    u32 iOff = pool_.appendIndices(LayoutId::Batch, indices, 6);

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(
        current_stage_, layer, batch_shader_id_, BlendMode::Normal, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = 6;
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = batch_shader_id_;
    cmd.blend_mode = BlendMode::Normal;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::Sprite;
    cmd.layer = layer;

    clip_state_.applyTo(entity, cmd);

    draw_list_.push(cmd);
}

#ifdef ES_ENABLE_SPINE
void RenderFrame::submitSpineBatch(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, i32 blendMode,
    const f32* transform16,
    Entity entity, i32 layer, f32 depth
) {
    if (vertexCount <= 0 || indexCount <= 0) return;

    constexpr i32 FLOATS_PER_VERTEX = 8;
    glm::mat4 model = glm::make_mat4(transform16);
    BlendMode blend = static_cast<BlendMode>(std::clamp(blendMode, 0, 5));

    u32 vBytes = static_cast<u32>(vertexCount) * sizeof(BatchVertex);
    u32 vOff = pool_.allocVertices(LayoutId::Batch, vBytes);
    auto* dst = reinterpret_cast<BatchVertex*>(pool_.vertexData(LayoutId::Batch) + vOff);

    for (i32 i = 0; i < vertexCount; ++i) {
        const f32* v = vertices + i * FLOATS_PER_VERTEX;
        glm::vec4 worldPos = model * glm::vec4(v[0], v[1], 0.0f, 1.0f);
        u32 pc = packColor(glm::vec4(v[4], v[5], v[6], v[7]));
        dst[i] = { {worldPos.x, worldPos.y}, pc, {v[2], v[3]} };
    }

    u32 baseVertex = vOff / sizeof(BatchVertex);
    std::vector<u16> offsetIndices(indexCount);
    for (i32 i = 0; i < indexCount; ++i) {
        offsetIndices[i] = static_cast<u16>(baseVertex + indices[i]);
    }
    u32 iOff = pool_.appendIndices(LayoutId::Batch, offsetIndices.data(), static_cast<u32>(indexCount));

    DrawCommand cmd{};
    cmd.sort_key = DrawCommand::buildSortKey(
        current_stage_, layer, batch_shader_id_, blend, 0, textureId, depth);
    cmd.index_offset = iOff;
    cmd.index_count = static_cast<u32>(indexCount);
    cmd.vertex_byte_offset = vOff;
    cmd.shader_id = batch_shader_id_;
    cmd.blend_mode = blend;
    cmd.layout_id = LayoutId::Batch;
    cmd.texture_count = 1;
    cmd.texture_ids[0] = textureId;
    cmd.entity = entity;
    cmd.type = RenderType::Spine;
    cmd.layer = layer;

    clip_state_.applyTo(entity, cmd);
    draw_list_.push(cmd);
}
#endif

}  // namespace esengine
