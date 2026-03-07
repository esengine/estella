#pragma once

#include "../RenderTypePlugin.hpp"

namespace esengine {

class ExternalMeshPlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override {}
    void shutdown() override {}

    void submitExternalTriangles(
        const f32* vertices, i32 vertexCount,
        const u16* indices, i32 indexCount,
        u32 textureId, i32 blendMode,
        const f32* transform16,
        RenderStage stage
    );

    void collect(
        ecs::Registry& registry,
        const Frustum& frustum,
        const ClipState& clips,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        RenderFrameContext& ctx
    ) override;

    bool needsCustomDraw() const override { return true; }
    void customDraw(const DrawCommand& cmd,
                    StateTracker& state,
                    TransientBufferPool& buffers,
                    RenderFrameContext& ctx) override;

    void clearFrameData() { meshes_.clear(); submit_order_ = 0; }

private:
    struct ExternalMeshData {
        std::vector<f32> vertices;
        std::vector<u16> indices;
        u32 texture_id = 0;
        BlendMode blend_mode = BlendMode::Normal;
        glm::mat4 transform{1.0f};
        RenderStage stage = RenderStage::Transparent;
        f32 depth = 0.0f;
    };

    std::vector<ExternalMeshData> meshes_;
    u32 submit_order_ = 0;
};

}  // namespace esengine
