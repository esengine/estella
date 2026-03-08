#pragma once

#include "../RenderTypePlugin.hpp"

#ifdef ES_ENABLE_SPINE

#include <spine/spine.h>
#include <vector>

namespace esengine {

namespace spine { class SpineSystem; }

class SpinePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    u32 skipFlag() const override { return 1; }

    void setSpineSystem(spine::SpineSystem* system) { spine_system_ = system; }

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

    static u32 packColor(f32 r, f32 g, f32 b, f32 a);
    u32 getTextureId(void* spineTexture, RenderFrameContext& ctx);

    static BlendMode mapBlendMode(::spine::BlendMode mode);

    void emitRegionAttachment(
        ::spine::RegionAttachment* attachment,
        ::spine::Slot& slot,
        const glm::mat4& transform,
        const glm::vec4& tintColor,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        const ClipState& clips,
        Entity entity, i32 layer, f32 depth,
        RenderFrameContext& ctx
    );

    void emitMeshAttachment(
        ::spine::MeshAttachment* attachment,
        ::spine::Slot& slot,
        const glm::mat4& transform,
        const glm::vec4& tintColor,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        const ClipState& clips,
        Entity entity, i32 layer, f32 depth,
        RenderFrameContext& ctx
    );

    void emitBatch(
        u32 textureId, BlendMode blend,
        TransientBufferPool& buffers,
        DrawList& draw_list,
        const ClipState& clips,
        Entity entity, i32 layer, f32 depth,
        RenderFrameContext& ctx
    );

    spine::SpineSystem* spine_system_ = nullptr;
    u32 batch_shader_id_ = 0;

    std::vector<BatchVertex> vertices_;
    std::vector<u16> indices_;
    std::vector<f32> world_vertices_;
    ::spine::SkeletonClipping clipper_;
};

}  // namespace esengine

#endif
