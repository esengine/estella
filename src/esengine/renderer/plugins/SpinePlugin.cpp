#include "SpinePlugin.hpp"

#ifdef ES_ENABLE_SPINE

#include "../RenderContext.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/SpineAnimation.hpp"
#include "../../spine/SpineSystem.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/quaternion.hpp>

namespace esengine {

void SpinePlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void SpinePlugin::collect(
    ecs::Registry& registry,
    const Frustum& frustum,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    if (!spine_system_) return;

    spine_data_.clear();
    auto view = registry.view<ecs::SpineAnimation>();

    for (auto entity : view) {
        auto& comp = registry.get<ecs::SpineAnimation>(entity);
        if (!comp.enabled) continue;
        auto* instance = spine_system_->getInstance(entity);
        if (!instance || !instance->skeleton) continue;

        glm::vec3 position{0.0f};
        glm::quat rotation{1.0f, 0.0f, 0.0f, 0.0f};
        glm::vec3 scale{1.0f};

        if (registry.has<ecs::Transform>(entity)) {
            auto& t = registry.get<ecs::Transform>(entity);
            t.ensureDecomposed();
            position = t.worldPosition;
            rotation = t.worldRotation;
            scale = t.worldScale;
        }

        SpineRenderData sd;
        sd.transform = glm::mat4(1.0f);
        sd.transform = glm::translate(sd.transform, position);
        sd.transform *= glm::mat4_cast(rotation);
        sd.transform = glm::scale(sd.transform, scale);
        sd.skeleton = instance->skeleton.get();
        sd.tint_color = comp.color;
        sd.material_id = comp.material;

        u32 dataIndex = static_cast<u32>(spine_data_.size());
        spine_data_.push_back(sd);

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(ctx.current_stage, comp.layer, batch_shader_id_, BlendMode::Normal, 0, 0, position.z);
        cmd.index_offset = dataIndex;
        cmd.index_count = 0;
        cmd.vertex_byte_offset = 0;
        cmd.shader_id = batch_shader_id_;
        cmd.blend_mode = BlendMode::Normal;
        cmd.layout_id = LayoutId::Batch;
        cmd.texture_count = 0;
        cmd.entity = entity;
        cmd.type = RenderType::Spine;
        cmd.layer = comp.layer;

        clips.applyTo(entity, cmd);

        draw_list.push(cmd);
    }
}

void SpinePlugin::customDraw(
    const DrawCommand& cmd,
    StateTracker& state,
    TransientBufferPool& buffers,
    RenderFrameContext& ctx
) {
    u32 dataIndex = cmd.index_offset;
    if (dataIndex >= spine_data_.size()) return;

    (void)state;
    (void)buffers;
    (void)ctx;
}

}  // namespace esengine

#endif
