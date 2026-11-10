// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./RenderFrame.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../draw/BatchVertex.hpp"
#include "../draw/TextVertexFormat.hpp"
#include "./RenderContext.hpp"

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
        { {position.x - hw, position.y - hh, depth}, pc, uvOffset },
        { {position.x + hw, position.y - hh, depth}, pc, {uvOffset.x + uvScale.x, uvOffset.y} },
        { {position.x + hw, position.y + hh, depth}, pc, {uvOffset.x + uvScale.x, uvOffset.y + uvScale.y} },
        { {position.x - hw, position.y + hh, depth}, pc, {uvOffset.x, uvOffset.y + uvScale.y} },
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
    Entity entity, i32 layer, f32 depth, TextGlyphMode mode, u32 cullBit
) {
    if (vertexCount <= 0 || indexCount <= 0
        || !batchEntityVisible(draw_list_, clip_state_, entity, layer, cullBit)) return;

    glm::mat4 model = glm::make_mat4(transform16);

    u32 vBytes = static_cast<u32>(vertexCount) * sizeof(BatchVertex);
    u32 vOff = pool_.allocVertices(LayoutId::Batch, vBytes);
    auto* dst = reinterpret_cast<BatchVertex*>(pool_.vertexData(LayoutId::Batch) + vOff);

    for (i32 i = 0; i < vertexCount; ++i) {
        const f32* v = vertices + i * TEXT_VERTEX_FLOATS;
        glm::vec4 worldPos = model * glm::vec4(v[0], v[1], 0.0f, 1.0f);
        u32 pc = packColor(glm::vec4(v[4], v[5], v[6], v[7]));
        // texIndex is assigned at merge time; sdfBias rides in from the layout,
        // which is where an outline pass says how far to grow the glyph.
        dst[i] = { {worldPos.x, worldPos.y, worldPos.z}, pc, {v[2], v[3]}, 0.0f, v[8] };
    }

    // Sdf derives coverage from the distance field; Mask and Fill read a baked-outline page (see TextGlyphMode); Color is the featureless batch,
    // which multiplies the page's RGBA by the tint (native-AA bitmap coverage in alpha, or a colour font).
    u32 program = 0;
    switch (mode) {
        case TextGlyphMode::Sdf: program = batchProgram({"SDF"}); break;
        case TextGlyphMode::Mask: program = batchProgram({"GLYPH_MASK"}); break;
        case TextGlyphMode::Fill: program = batchProgram({"GLYPH_FILL"}); break;
        case TextGlyphMode::Color: program = batchProgram({}); break;
    }
    pushBatchCommand(pool_, draw_list_, clip_state_, vOff, static_cast<u32>(vertexCount), indices,
                     static_cast<u32>(indexCount), BatchDrawKey{
        .stage = current_stage_,
        .layer = layer,
        .shaderId = program,
        .blend = BlendMode::Normal,
        .textureId = textureId,
        .depth = depth,
        .cullBit = cullBit,
        .entity = entity,
        .type = RenderType::Text,
    });
}

void RenderFrame::submitSkeletalBatch(
    const f32* vertices, i32 vertexCount,
    const u16* indices, i32 indexCount,
    u32 textureId, i32 blendMode,
    const f32* transform16,
    Entity entity, i32 layer, f32 depth, u32 materialId, bool premultipliedColor,
    f32 treeAlpha, u32 cullBit
) {
    // The screen overlay and the cameras partition the world (RenderCollectContext::accepts):
    // a skeleton under a screen Canvas is the overlay's, and a camera drawing it too is how it
    // showed in the world at the Canvas' pixel coordinates while missing from the UI.
    const bool screen = screen_domain_ && screen_domain_->count(entity.id()) != 0;
    if (screen != overlay_active_) return;
    if (layer == 0 && ui_tree_layers_) {
        if (const auto it = ui_tree_layers_->find(entity.id()); it != ui_tree_layers_->end()) layer = it->second;
    }
    if (vertexCount <= 0 || indexCount <= 0 || treeAlpha <= 0.0f
        || !batchEntityVisible(draw_list_, clip_state_, entity, layer, cullBit)) return;

    constexpr i32 FLOATS_PER_VERTEX = 8;
    glm::mat4 model = glm::make_mat4(transform16);
    BlendMode blend = static_cast<BlendMode>(std::clamp(blendMode, 0, 5));

    const MaterialRecord* material = materialId != 0 ? context_.materials().find(materialId) : nullptr;
    const bool builtinColor = !material || material->shader == 0;

    // Format the transformed vertices in place — a complex skeleton can carry many
    // vertices, so we avoid staging them into a temporary before the pool copy.
    u32 vBytes = static_cast<u32>(vertexCount) * sizeof(BatchVertex);
    u32 vOff = pool_.allocVertices(LayoutId::Batch, vBytes);
    auto* dst = reinterpret_cast<BatchVertex*>(pool_.vertexData(LayoutId::Batch) + vOff);

    for (i32 i = 0; i < vertexCount; ++i) {
        const f32* v = vertices + i * FLOATS_PER_VERTEX;
        glm::vec4 worldPos = model * glm::vec4(v[0], v[1], 0.0f, 1.0f);
        // The UI tree's opacity, as a control's quad takes it: premultiplied colour scales whole.
        glm::vec4 color = glm::vec4(v[4], v[5], v[6], v[7]) * (premultipliedColor ? glm::vec4(treeAlpha) : glm::vec4(1.0f, 1.0f, 1.0f, treeAlpha));
        if (premultipliedColor && builtinColor) {
            // Recover straight color before 8-bit packing and the shader EOTF.
            color = color.a > 0.0f ? glm::vec4(glm::vec3(color) / color.a, color.a)
                                   : glm::vec4(0.0f);
        }
        u32 pc = packColor(color);
        dst[i] = { {worldPos.x, worldPos.y, worldPos.z}, pc, {v[2], v[3]} };
    }

    const u32 defaultShader = !builtinColor ? material->shader
        : premultipliedColor ? premultipliedBatchProgram() : batch_shader_id_;
    BatchDrawKey key{
        .stage = current_stage_,
        .layer = layer,
        .shaderId = defaultShader,
        .blend = blend,
        .textureId = textureId,
        .depth = depth,
        .cullBit = cullBit,
        .entity = entity,
        .type = RenderType::Skeletal,
    };
    // The same resolution a Sprite gets: a material owns shading fully, and a
    // handle nothing registered falls back to the batch shader rather than
    // binding a program that was never built.
    if (materialId != 0) {
        if (const MaterialRecord* m = material) {
            key.shaderId = (m->shader != 0) ? m->shader : defaultShader;
            key.blend = m->blend;
            key.materialId = materialId;
            key.depthTest = m->depthTest;
            key.depthWrite = m->depthWrite;
            key.cull = static_cast<u8>(m->cull);
        }
    }

    pushBatchCommand(pool_, draw_list_, clip_state_, vOff, static_cast<u32>(vertexCount), indices,
                     static_cast<u32>(indexCount), key);
}

}  // namespace esengine
