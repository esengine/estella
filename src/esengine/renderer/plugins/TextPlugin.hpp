#pragma once

#include "../RenderTypePlugin.hpp"

namespace esengine {
namespace text { class BitmapFont; }

class TextPlugin : public RenderTypePlugin {
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

    static constexpr u16 QUAD_INDICES[6] = { 0, 1, 2, 2, 3, 0 };

    static u32 decodeUtf8(const char* data, u16 length, u16& pos);

    void emitGlyphQuad(
        TransientBufferPool& buffers, DrawList& draw_list,
        const glm::vec2& position, const glm::vec2& size,
        f32 depth, u32 textureId,
        const glm::vec4& color,
        const glm::vec2& uvOffset, const glm::vec2& uvScale,
        Entity entity, RenderStage stage, i32 layer,
        u32 shaderId, const ClipState& clips
    );

    u32 batch_shader_id_ = 0;
};

}  // namespace esengine
