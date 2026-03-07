#pragma once

#include "../RenderTypePlugin.hpp"

#ifdef ES_ENABLE_SPINE

namespace spine {
class Skeleton;
class SkeletonClipping;
}

namespace esengine {

namespace spine { class SpineSystem; }

class SpinePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    void setSpineSystem(spine::SpineSystem* system) { spine_system_ = system; }

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

private:
    struct SpineRenderData {
        ::spine::Skeleton* skeleton = nullptr;
        glm::mat4 transform{1.0f};
        glm::vec4 tint_color{1.0f};
        u32 material_id = 0;
    };

    spine::SpineSystem* spine_system_ = nullptr;
    u32 batch_shader_id_ = 0;
    std::vector<SpineRenderData> spine_data_;
};

}  // namespace esengine

#endif
