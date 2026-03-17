#include "ParticlePlugin.hpp"
#include "../RenderContext.hpp"
#include "../Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../particle/ParticleSystem.hpp"
#include "../../particle/Particle.hpp"

#include <cmath>
#include <algorithm>

namespace esengine {

void ParticlePlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void ParticlePlugin::collect(
    ecs::Registry& registry,
    const Frustum& frustum,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    if (!particle_system_) return;

    entries_.clear();
    batches_.clear();

    auto emitterView = registry.view<ecs::Transform, ecs::ParticleEmitter>();

    for (auto entity : emitterView) {
        const auto& emitter = emitterView.get<ecs::ParticleEmitter>(entity);
        if (!emitter.enabled) continue;

        auto& transform = emitterView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();

        const auto* state = particle_system_->getState(entity);
        if (!state) continue;

        u32 textureId = ctx.white_texture_id;
        if (emitter.texture.isValid()) {
            Texture* tex = ctx.resources.getTexture(emitter.texture);
            if (tex) {
                textureId = tex->getId();
            }
        }

        i32 cols = std::max(emitter.spriteColumns, 1);
        i32 rows = std::max(emitter.spriteRows, 1);
        f32 uvScaleX = 1.0f / static_cast<f32>(cols);
        f32 uvScaleY = 1.0f / static_cast<f32>(rows);

        bool isLocalSpace = emitter.simulationSpace ==
                            static_cast<i32>(ecs::SimulationSpace::Local);
        glm::vec3 emitterWorldPos = transform.worldPosition;
        f32 emitterAngle = 0.0f;
        glm::vec2 emitterScale(transform.worldScale);
        if (isLocalSpace) {
            const auto& rot = transform.worldRotation;
            emitterAngle = 2.0f * std::atan2(rot.z, rot.w);
        }

        ParticleBatchData batch;
        batch.texture_id = textureId;
        batch.blend_mode = static_cast<BlendMode>(emitter.blendMode);
        batch.material_id = emitter.material;
        batch.first_entry = static_cast<u32>(entries_.size());
        batch.entity = entity;

        u32 particleCount = 0;
        state->pool.forEachAlive([&](const particle::Particle& p) {
            ParticleRenderEntry entry;

            if (isLocalSpace) {
                glm::vec2 worldPos = glm::vec2(emitterWorldPos) +
                    glm::vec2(p.position.x * emitterScale.x, p.position.y * emitterScale.y);
                if (std::abs(emitterAngle) > 0.001f) {
                    f32 cosA = std::cos(emitterAngle);
                    f32 sinA = std::sin(emitterAngle);
                    glm::vec2 rel = p.position * emitterScale;
                    worldPos = glm::vec2(emitterWorldPos) +
                        glm::vec2(rel.x * cosA - rel.y * sinA,
                                  rel.x * sinA + rel.y * cosA);
                }
                entry.position = worldPos;
                entry.size = glm::vec2(p.size) * emitterScale;
            } else {
                entry.position = p.position;
                entry.size = glm::vec2(p.size);
            }

            entry.rotation = p.rotation;
            entry.color = p.color;

            if (cols > 1 || rows > 1) {
                i32 col = p.sprite_frame % cols;
                i32 row = p.sprite_frame / cols;
                entry.uv_offset = glm::vec2(static_cast<f32>(col) * uvScaleX,
                                              static_cast<f32>(row) * uvScaleY);
                entry.uv_scale = glm::vec2(uvScaleX, uvScaleY);
            }

            entries_.push_back(entry);
            particleCount++;
        });

        batch.entry_count = particleCount;
        if (particleCount == 0) continue;

        u32 batchIndex = static_cast<u32>(batches_.size());
        batches_.push_back(batch);

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(ctx.current_stage, emitter.layer, batch_shader_id_, batch.blend_mode, 0, textureId, emitterWorldPos.z);
        cmd.index_offset = batchIndex;
        cmd.index_count = particleCount;
        cmd.vertex_byte_offset = 0;
        cmd.shader_id = batch_shader_id_;
        cmd.blend_mode = batch.blend_mode;
        cmd.layout_id = LayoutId::Batch;
        cmd.texture_count = 1;
        cmd.texture_ids[0] = textureId;
        cmd.entity = entity;
        cmd.type = RenderType::Particle;
        cmd.layer = emitter.layer;

        clips.applyTo(entity, cmd);

        draw_list.push(cmd);
    }
}

void ParticlePlugin::customDraw(
    const DrawCommand& cmd,
    StateTracker& state,
    TransientBufferPool& buffers,
    RenderFrameContext& ctx
) {
    u32 batchIndex = cmd.index_offset;
    if (batchIndex >= batches_.size()) return;

    (void)state;
    (void)buffers;
    (void)ctx;
}

}  // namespace esengine
