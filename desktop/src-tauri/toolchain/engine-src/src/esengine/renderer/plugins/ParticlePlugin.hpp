#pragma once

#include "../RenderTypePlugin.hpp"

namespace esengine {

namespace particle { class ParticleSystem; }

class ParticlePlugin : public RenderTypePlugin {
public:
    void init(RenderFrameContext& ctx) override;
    void shutdown() override {}

    u32 skipFlag() const override { return 2; }

    void setParticleSystem(particle::ParticleSystem* system) { particle_system_ = system; }

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
    struct ParticleRenderEntry {
        glm::vec2 position;
        glm::vec2 size;
        f32 rotation;
        glm::vec4 color;
        glm::vec2 uv_offset{0.0f, 0.0f};
        glm::vec2 uv_scale{1.0f, 1.0f};
    };

    struct ParticleBatchData {
        u32 texture_id = 0;
        BlendMode blend_mode = BlendMode::Normal;
        u32 material_id = 0;
        u32 first_entry = 0;
        u32 entry_count = 0;
        Entity entity = static_cast<Entity>(0);
    };

    particle::ParticleSystem* particle_system_ = nullptr;
    u32 batch_shader_id_ = 0;
    std::vector<ParticleRenderEntry> entries_;
    std::vector<ParticleBatchData> batches_;
};

}  // namespace esengine
