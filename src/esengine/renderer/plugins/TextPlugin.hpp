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
        glm::vec4 color;
        glm::vec2 texCoord;
    };

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
