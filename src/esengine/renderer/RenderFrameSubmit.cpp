// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "RenderFrame.hpp"
#include "BatchBuilder.hpp"
#include "BatchVertex.hpp"

#include <glm/gtc/type_ptr.hpp>

#include <algorithm>

namespace esengine {

void RenderFrame::submitTileQuad(
    const glm::vec2& position, const glm::vec2& size,
    const glm::vec2& uvOffset, const glm::vec2& uvScale,
    const glm::vec4& color, u32 textureId,
    Entity entity, i32 layer, f32 depth
) {
    f32 hw = size.x * 0.5f;
    f32 hh = size.y * 0.5f;
    u32 pc = packColor(color);

    BatchVertex verts[4] = {
        { {position.x - hw, position.y - hh}, pc, uvOffset },
        { {position.x + hw, position.y - hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y} },
        { {position.x + hw, position.y + hh}, pc, {uvOffset.x + uvScale.x, uvOffset.y + uvScale.y} },
        { {position.x - hw, position.y + hh}, pc, {uvOffset.x, uvOffset.y + uvScale.y} },
    };

    appendQuad(pool_, draw_list_, clip_state_, verts, BatchDrawKey{
        .stage = current_stage_,
        .layer = layer,
        .shaderId = batch_shader_id_,
        .blend = BlendMode::Normal,
        .textureId = textureId,
        .depth = depth,
        .entity = entity,
        .type = RenderType::Sprite,
    });
}

void RenderFrame::submitTextBatch(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, const f32* transform16,
    Entity entity, i32 layer, f32 depth
) {
    if (vertexCount <= 0 || indexCount <= 0) return;

    constexpr i32 FLOATS_PER_VERTEX = 8;  // x, y, u, v, r, g, b, a
    glm::mat4 model = glm::make_mat4(transform16);

    u32 vBytes = static_cast<u32>(vertexCount) * sizeof(BatchVertex);
    u32 vOff = pool_.allocVertices(LayoutId::Batch, vBytes);
    auto* dst = reinterpret_cast<BatchVertex*>(pool_.vertexData(LayoutId::Batch) + vOff);

    for (i32 i = 0; i < vertexCount; ++i) {
        const f32* v = vertices + i * FLOATS_PER_VERTEX;
        glm::vec4 worldPos = model * glm::vec4(v[0], v[1], 0.0f, 1.0f);
        u32 pc = packColor(glm::vec4(v[4], v[5], v[6], v[7]));
        dst[i] = { {worldPos.x, worldPos.y}, pc, {v[2], v[3]} };
    }

    // Glyph atlas is SDF — route through the SDF batch variant. Text uses normal
    // alpha blending; coverage comes from the shader, not the source alpha curve.
    pushBatchCommand(pool_, draw_list_, clip_state_, vOff, static_cast<u32>(vertexCount), indices,
                     static_cast<u32>(indexCount), BatchDrawKey{
        .stage = current_stage_,
        .layer = layer,
        .shaderId = batchProgram({"SDF"}),
        .blend = BlendMode::Normal,
        .textureId = textureId,
        .depth = depth,
        .entity = entity,
        .type = RenderType::Text,
    });
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

    // Format the transformed vertices in place — a complex skeleton can carry many
    // vertices, so we avoid staging them into a temporary before the pool copy.
    u32 vBytes = static_cast<u32>(vertexCount) * sizeof(BatchVertex);
    u32 vOff = pool_.allocVertices(LayoutId::Batch, vBytes);
    auto* dst = reinterpret_cast<BatchVertex*>(pool_.vertexData(LayoutId::Batch) + vOff);

    for (i32 i = 0; i < vertexCount; ++i) {
        const f32* v = vertices + i * FLOATS_PER_VERTEX;
        glm::vec4 worldPos = model * glm::vec4(v[0], v[1], 0.0f, 1.0f);
        u32 pc = packColor(glm::vec4(v[4], v[5], v[6], v[7]));
        dst[i] = { {worldPos.x, worldPos.y}, pc, {v[2], v[3]} };
    }

    pushBatchCommand(pool_, draw_list_, clip_state_, vOff, static_cast<u32>(vertexCount), indices,
                     static_cast<u32>(indexCount), BatchDrawKey{
        .stage = current_stage_,
        .layer = layer,
        .shaderId = batch_shader_id_,
        .blend = blend,
        .textureId = textureId,
        .depth = depth,
        .entity = entity,
        .type = RenderType::Spine,
    });
}
#endif

}  // namespace esengine
