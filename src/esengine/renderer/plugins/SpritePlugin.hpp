#pragma once

#include "../RenderTypePlugin.hpp"
#include "../../resource/TextureMetadata.hpp"

namespace esengine {

class SpritePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    void collect(
        ecs::Registry& registry,
        const Frustum& frustum,
        const ClipState& clips,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        RenderFrameContext& ctx
    ) override;

private:
    struct BatchVertex {
        glm::vec2 position;
        u32 color;
        glm::vec2 texCoord;
    };

    static u32 packColor(const glm::vec4& c) {
        u8 r = static_cast<u8>(c.r * 255.0f + 0.5f);
        u8 g = static_cast<u8>(c.g * 255.0f + 0.5f);
        u8 b = static_cast<u8>(c.b * 255.0f + 0.5f);
        u8 a = static_cast<u8>(c.a * 255.0f + 0.5f);
        return static_cast<u32>(r) | (static_cast<u32>(g) << 8)
             | (static_cast<u32>(b) << 16) | (static_cast<u32>(a) << 24);
    }

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

    void emitQuad(
        TransientBufferPool& buffers, DrawList& draw_list,
        const glm::vec2& position, const glm::vec2& size,
        const glm::vec2& pivot,
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
        const glm::vec2& pivot,
        f32 angle, f32 depth, u32 textureId,
        const glm::vec2& texSize, const resource::SliceBorder& border,
        const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        Entity entity, RenderStage stage, i32 layer,
        BlendMode blend, u32 shaderId,
        const ClipState& clips
    );

    u32 batch_shader_id_ = 0;
};

}  // namespace esengine
