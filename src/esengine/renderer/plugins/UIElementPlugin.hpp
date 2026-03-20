#pragma once

#include "../RenderTypePlugin.hpp"
#include "../BatchVertex.hpp"
#include "../../resource/TextureMetadata.hpp"

namespace esengine {

class UIElementPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    void collect(RenderCollectContext& ctx) override;

private:
    static constexpr glm::vec4 QUAD_POSITIONS[4] = {
        { -0.5f, -0.5f, 0.0f, 1.0f },
        {  0.5f, -0.5f, 0.0f, 1.0f },
        {  0.5f,  0.5f, 0.0f, 1.0f },
        { -0.5f,  0.5f, 0.0f, 1.0f }
    };

    static constexpr glm::vec2 QUAD_TEX_COORDS[4] = {
        { 0.0f, 0.0f },
        { 1.0f, 0.0f },
        { 1.0f, 1.0f },
        { 0.0f, 1.0f }
    };

    static constexpr u16 QUAD_INDICES[6] = { 0, 1, 2, 2, 3, 0 };

    static constexpr i32 UI_BASE_LAYER = 1000;

    void emitQuad(
        TransientBufferPool& buffers, DrawList& draw_list,
        const glm::vec2& position, const glm::vec2& size,
        f32 angle, f32 depth, u32 textureId,
        const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        Entity entity, RenderStage stage, i32 layer,
        BlendMode blend, u32 shaderId,
        const ClipState& clips
    );

    void emitNineSlice(
        TransientBufferPool& buffers, DrawList& draw_list,
        const glm::vec2& position, const glm::vec2& size,
        f32 angle, f32 depth, u32 textureId,
        const glm::vec2& texSize, const glm::vec4& sliceBorder,
        const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        Entity entity, RenderStage stage, i32 layer,
        BlendMode blend, u32 shaderId,
        const ClipState& clips
    );

    u32 batch_shader_id_ = 0;
};

}  // namespace esengine
