#include "ParticlePlugin.hpp"
#include "../RenderContext.hpp"
#include "../Texture.hpp"
#include "../BatchVertex.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../particle/ParticleSystem.hpp"
#include "../../particle/Particle.hpp"

#include <cmath>

namespace esengine {

static constexpr u16 QUAD_INDICES[6] = { 0, 1, 2, 0, 2, 3 };

void ParticlePlugin::init(RenderFrameContext& ctx) {
    batch_shader_id_ = ctx.batch_shader_id;
}

void ParticlePlugin::collect(
    ecs::Registry& registry,
    const Frustum&,
    const ClipState& clips,
    TransientBufferPool& buffers,
    DrawList& draw_list,
    RenderFrameContext& ctx
) {
    if (!particle_system_) return;

    auto emitterView = registry.view<ecs::Transform, ecs::ParticleEmitter>();

    for (auto entity : emitterView) {
        const auto& emitter = emitterView.get<ecs::ParticleEmitter>(entity);
        if (!emitter.enabled) continue;

        auto& transform = emitterView.get<ecs::Transform>(entity);
        transform.ensureDecomposed();

        const auto* state = particle_system_->getState(entity);
        if (!state || state->pool.aliveCount() == 0) continue;

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
        f32 cosA = 1.0f, sinA = 0.0f;
        if (isLocalSpace) {
            const auto& rot = transform.worldRotation;
            emitterAngle = 2.0f * std::atan2(rot.z, rot.w);
            if (std::abs(emitterAngle) > 0.001f) {
                cosA = std::cos(emitterAngle);
                sinA = std::sin(emitterAngle);
            }
        }

        BlendMode blendMode = static_cast<BlendMode>(emitter.blendMode);

        u32 particleCount = state->pool.aliveCount();
        u32 vertCount = particleCount * 4;
        u32 idxCount = particleCount * 6;

        u32 vertByteSize = vertCount * sizeof(BatchVertex);
        u32 vertByteOffset = buffers.allocVertices(vertByteSize);
        u32 idxOffset = buffers.allocIndices(idxCount);

        auto* verts = reinterpret_cast<BatchVertex*>(buffers.vertexData() + vertByteOffset);
        u16 baseVertex = static_cast<u16>(vertByteOffset / sizeof(BatchVertex));

        u32 pi = 0;
        state->pool.forEachAlive([&](const particle::Particle& p) {
            glm::vec2 worldPos;
            glm::vec2 size;

            if (isLocalSpace) {
                glm::vec2 rel = p.position * emitterScale;
                if (std::abs(emitterAngle) > 0.001f) {
                    worldPos = glm::vec2(emitterWorldPos) +
                        glm::vec2(rel.x * cosA - rel.y * sinA,
                                  rel.x * sinA + rel.y * cosA);
                } else {
                    worldPos = glm::vec2(emitterWorldPos) + rel;
                }
                size = glm::vec2(p.size) * emitterScale;
            } else {
                worldPos = p.position;
                size = glm::vec2(p.size);
            }

            u32 color = packColor(p.color);
            f32 halfW = size.x * 0.5f;
            f32 halfH = size.y * 0.5f;

            f32 cosR = std::cos(p.rotation);
            f32 sinR = std::sin(p.rotation);

            glm::vec2 corners[4] = {
                { -halfW, -halfH },
                {  halfW, -halfH },
                {  halfW,  halfH },
                { -halfW,  halfH },
            };

            f32 u0, v0, u1, v1;
            if (cols > 1 || rows > 1) {
                i32 col = p.sprite_frame % cols;
                i32 row = p.sprite_frame / cols;
                u0 = static_cast<f32>(col) * uvScaleX;
                v0 = static_cast<f32>(row) * uvScaleY;
                u1 = u0 + uvScaleX;
                v1 = v0 + uvScaleY;
            } else {
                u0 = 0.0f; v0 = 0.0f; u1 = 1.0f; v1 = 1.0f;
            }

            u32 vi = pi * 4;
            for (u32 c = 0; c < 4; ++c) {
                f32 rx = corners[c].x * cosR - corners[c].y * sinR;
                f32 ry = corners[c].x * sinR + corners[c].y * cosR;
                verts[vi + c].position = worldPos + glm::vec2(rx, ry);
                verts[vi + c].color = color;
            }
            verts[vi + 0].texCoord = { u0, v1 };
            verts[vi + 1].texCoord = { u1, v1 };
            verts[vi + 2].texCoord = { u1, v0 };
            verts[vi + 3].texCoord = { u0, v0 };

            u32 ii = pi * 6;
            u16 bv = baseVertex + static_cast<u16>(vi);
            for (u32 q = 0; q < 6; ++q) {
                buffers.writeIndices(idxOffset + ii + q, &QUAD_INDICES[q], 1);
            }
            // Patch base vertex into indices
            u16 patched[6];
            for (u32 q = 0; q < 6; ++q) {
                patched[q] = bv + QUAD_INDICES[q];
            }
            buffers.writeIndices(idxOffset + ii, patched, 6);

            ++pi;
        });

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(ctx.current_stage, emitter.layer, batch_shader_id_, blendMode, 0, textureId, emitterWorldPos.z);
        cmd.index_offset = idxOffset;
        cmd.index_count = idxCount;
        cmd.vertex_byte_offset = vertByteOffset;
        cmd.shader_id = batch_shader_id_;
        cmd.blend_mode = blendMode;
        cmd.layout_id = LayoutId::Batch;
        cmd.texture_count = 1;
        cmd.texture_ids[0] = textureId;
        cmd.entity = entity;
        cmd.entity_count = 1;
        cmd.type = RenderType::Particle;
        cmd.layer = emitter.layer;

        clips.applyTo(entity, cmd);

        draw_list.push(cmd);
    }
}

}  // namespace esengine
