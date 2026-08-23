// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "ParticlePlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../frame/RenderContext.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Shader.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../rhi/Texture.hpp"
#include "../draw/BatchVertex.hpp"   // packColor
#include "../../resource/ShaderParser.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../particle/ParticleSystem.hpp"
#include "../../particle/Particle.hpp"

#include <algorithm>
#include <string>
#include <cmath>

namespace esengine {

namespace {
// One record per live particle, matching the PARTICLE_INSTANCE vertex attributes
// (locations 2-7). The GPU expands the 4-vertex quad; the CPU only fills these 44 bytes
// per particle (vs. the old 4 verts + 6 indices), which is the whole point of RC7-1.
struct ParticleInstanceData {
    f32 px, py, pz;      // a_inst_position (world)
    f32 sx, sy;          // a_inst_size
    f32 rotation;        // a_inst_rotation
    u32 color;           // a_inst_color (RGBA8)
    f32 uvOffsetX, uvOffsetY;
    f32 uvScaleX, uvScaleY;
};
static_assert(sizeof(ParticleInstanceData) == 44, "instance stride must match the VAO layout");
}  // namespace

void ParticlePlugin::init(RenderFrameContext& ctx) {
    // Particle instancing shader, authored as particle.esshader (single source,
    // WGSL twin included) and embedded for the web build. Attribute locations
    // are explicit, so no name bindings.
    if (particle_shader_handle_.isValid()) ctx.resources.releaseShader(particle_shader_handle_);
    const auto target = ctx.resources.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::PARTICLE);
    // The same feature a material's particle variant is compiled with, so the
    // built-in fragment and an authored one sit on one vertex stage.
    const std::vector<std::string> features{ "PARTICLE" };
    resource::ShaderHandle& handle = particle_shader_handle_;
    handle = ctx.resources.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target),
        {}, ctx.resources.preferredShaderLanguage());
    Shader* shader = ctx.resources.getShader(handle);
    if (shader && shader->isValid()) {
        particle_shader_id_ = shader->getProgramId();
        if (shader->language() == GfxShaderLanguage::GLSL_ES300) {
            // Sampler seeding is a GLSL concept; on WGSL the texture rides the
            // bind group.
            shader->bind();
            for (i32 unit = 0; unit < 8; ++unit) {
                shader->setUniform("u_textures[" + std::to_string(unit) + "]", unit);
            }
            shader->unbind();
        }
    }
}

void ParticlePlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    if (!particle_system_ || particle_shader_id_ == 0) return;

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
            if (tex) textureId = tex->getId();
        }

        i32 cols = std::max(emitter.spriteColumns, 1);
        i32 rows = std::max(emitter.spriteRows, 1);
        f32 uvScaleX = 1.0f / static_cast<f32>(cols);
        f32 uvScaleY = 1.0f / static_cast<f32>(rows);
        bool sheet = (cols > 1 || rows > 1);

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
        u32 instByteOffset = buffers.allocVertices(LayoutId::ParticleInstance,
                                                   particleCount * sizeof(ParticleInstanceData));
        auto* inst = reinterpret_cast<ParticleInstanceData*>(
            buffers.vertexData(LayoutId::ParticleInstance) + instByteOffset);

        u32 i = 0;
        state->pool.forEachAlive([&](const particle::Particle& p) {
            glm::vec3 worldPos;
            glm::vec2 size;
            if (isLocalSpace) {
                // The emitter's own turn is about Z, as a flat scene's is; depth
                // rides through it untouched rather than being dropped.
                glm::vec3 rel = p.position * glm::vec3(emitterScale, 1.0f);
                if (std::abs(emitterAngle) > 0.001f) {
                    worldPos = emitterWorldPos +
                        glm::vec3(rel.x * cosA - rel.y * sinA, rel.x * sinA + rel.y * cosA, rel.z);
                } else {
                    worldPos = emitterWorldPos + rel;
                }
                size = glm::vec2(p.size) * emitterScale;
            } else {
                worldPos = p.position;
                size = glm::vec2(p.size);
            }

            f32 u0 = 0.0f, v0 = 0.0f;
            if (sheet) {
                i32 col = p.sprite_frame % cols;
                i32 row = p.sprite_frame / cols;
                u0 = static_cast<f32>(col) * uvScaleX;
                v0 = static_cast<f32>(row) * uvScaleY;
            }

            ParticleInstanceData& d = inst[i++];
            d.px = worldPos.x;       d.py = worldPos.y;       d.pz = worldPos.z;
            d.sx = size.x;           d.sy = size.y;
            d.rotation = p.rotation;
            d.color = packColor(p.color);
            d.uvOffsetX = u0;        d.uvOffsetY = v0;
            d.uvScaleX = sheet ? uvScaleX : 1.0f;
            d.uvScaleY = sheet ? uvScaleY : 1.0f;
        });

        // A material owns shading fully: its program is this one compiled for the
        // particle vertex source, so the author's fragment sees the same quad the
        // built-in one does. A handle nothing registered draws plainly.
        u32 shaderId = particle_shader_id_;
        u32 materialId = 0;
        BlendMode blend = blendMode;
        if (emitter.material != 0 && ctx.materials) {
            if (const MaterialRecord* m = ctx.materials->find(emitter.material)) {
                const u32 program = ctx.materials->particleProgram(emitter.material, ctx.resources);
                if (program != 0) {
                    shaderId = program;
                    materialId = emitter.material;
                    blend = m->blend;
                }
            }
        }

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = emitter.layer,
            .shaderId = shaderId,
            .blend = blend,
            .textureId = textureId,
            .depth = collect_ctx.camera.viewDepth(emitterWorldPos),
            // Sorted by world Y like every other draw — a burst left at y = 0
            // loses to any sprite standing anywhere else, so an emitter placed on
            // a character disappears behind them.
            .y = emitterWorldPos.y,
            .entity = entity,
            .type = RenderType::Particle,
            .materialId = materialId,
            .layoutId = LayoutId::ParticleInstance,
            .instanceCount = particleCount,
        };
        // The stream's static unit-quad indices (offset 0) drawn once per particle,
        // with the instance slice based at instByteOffset.
        pushBatchDraw(draw_list, clips, instByteOffset, 0, 0, 6, key);

        // --- Per-particle trails --------------------------------------------------
        // Each live particle drags a tapering ribbon along its recorded path. Built on
        // the CPU and streamed through the Batch face (triangle strip), exactly like the
        // standalone TrailRenderer — no new GPU path. Off unless the emitter opts in.
        if (emitter.trailEnabled && emitter.trailWidth > 0.0f &&
            state->trail_count.size() == state->pool.particles().size()) {
            BatchDrawKey trailKey{
                .stage = ctx.current_stage,
                .layer = emitter.layer,
                .shaderId = ctx.batch_shader_id,
                .blend = blendMode,
                .textureId = ctx.white_texture_id,
                .depth = collect_ctx.camera.viewDepth(emitterWorldPos),
                .y = emitterWorldPos.y,
                .entity = entity,
                .type = RenderType::Trail,
            };
            const int keep = std::min(std::max(emitter.trailPoints, 2), particle::kMaxTrailPoints);
            const auto& particles = state->pool.particles();
            auto toWorld = [&](glm::vec3 pos) -> glm::vec3 {
                if (!isLocalSpace) return pos;
                glm::vec3 rel = pos * glm::vec3(emitterScale, 1.0f);
                if (std::abs(emitterAngle) > 0.001f)
                    return emitterWorldPos +
                           glm::vec3(rel.x * cosA - rel.y * sinA, rel.x * sinA + rel.y * cosA, rel.z);
                return emitterWorldPos + rel;
            };

            for (std::size_t idx = 0; idx < particles.size(); ++idx) {
                const particle::Particle& p = particles[idx];
                if (!p.alive || state->trail_count[idx] == 0) continue;
                const glm::vec3* ring = &state->trail_pos[idx * particle::kMaxTrailPoints];

                // Centerline: recorded points (oldest→newest) then the live head.
                trail_center_.clear();
                int m = std::min<int>(state->trail_count[idx], keep);
                for (int k = 0; k < m; ++k) trail_center_.push_back(toWorld(ring[k]));
                glm::vec3 head = toWorld(p.position);
                glm::vec3 dHead = head - trail_center_.back();
                if (glm::dot(dHead, dHead) > 1e-4f) trail_center_.push_back(head);
                const int n = static_cast<int>(trail_center_.size());
                if (n < 2) continue;

                // 2 verts per point: t runs 0 at the faded zero-width tail (oldest) → 1
                // at the full-width head carrying the particle's current colour.
                // Widened in the scene's own plane, not toward the eye: the
                // centreline carries depth, but a billboarded ribbon is a
                // per-segment turn this vertex path has no room for.
                trail_verts_.clear();
                glm::vec2 lastTangent(1.0f, 0.0f);
                for (int j = 0; j < n; ++j) {
                    const glm::vec3& a = trail_center_[j == 0 ? 0 : j - 1];
                    const glm::vec3& b = trail_center_[j + 1 == n ? j : j + 1];
                    glm::vec2 seg = glm::vec2(b) - glm::vec2(a);
                    f32 len = std::sqrt(seg.x * seg.x + seg.y * seg.y);
                    glm::vec2 tangent = len > 1e-6f ? seg / len : lastTangent;
                    lastTangent = tangent;
                    glm::vec2 perp(-tangent.y, tangent.x);

                    f32 t = static_cast<f32>(j) / static_cast<f32>(n - 1);
                    f32 halfW = 0.5f * emitter.trailWidth * t;
                    glm::vec4 col = p.color;
                    col.a *= t;
                    u32 packed = packColor(col);

                    const glm::vec3& c = trail_center_[j];
                    trail_verts_.push_back({{c.x + perp.x * halfW, c.y + perp.y * halfW, c.z}, packed, glm::vec2(1.0f - t, 0.0f)});
                    trail_verts_.push_back({{c.x - perp.x * halfW, c.y - perp.y * halfW, c.z}, packed, glm::vec2(1.0f - t, 1.0f)});
                }

                trail_indices_.clear();
                for (int j = 0; j + 1 < n; ++j) {
                    u32 l0 = static_cast<u32>(j) * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
                    trail_indices_.push_back(l0); trail_indices_.push_back(r0); trail_indices_.push_back(r1);
                    trail_indices_.push_back(l0); trail_indices_.push_back(r1); trail_indices_.push_back(l1);
                }

                appendIndexedBatch(buffers, draw_list, clips,
                                   trail_verts_.data(), static_cast<u32>(trail_verts_.size()),
                                   trail_indices_.data(), static_cast<u32>(trail_indices_.size()),
                                   trailKey);
            }
        }
    }
}

}  // namespace esengine
