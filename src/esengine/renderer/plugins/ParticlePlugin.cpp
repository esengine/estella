#include "ParticlePlugin.hpp"
#include "../RenderContext.hpp"
#include "../RenderFrame.hpp"
#include "../Shader.hpp"
#include "../ShaderEmbeds.generated.hpp"
#include "../Texture.hpp"
#include "../BatchVertex.hpp"   // packColor
#include "../../resource/ShaderParser.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/ParticleEmitter.hpp"
#include "../../particle/ParticleSystem.hpp"
#include "../../particle/Particle.hpp"

#include <cmath>

namespace esengine {

namespace {
// One record per live particle, matching the PARTICLE_INSTANCE vertex attributes
// (locations 2-7). The GPU expands the 4-vertex quad; the CPU only fills these 40 bytes
// per particle (vs. the old 4 verts + 6 indices), which is the whole point of RC7-1.
struct ParticleInstanceData {
    f32 px, py;          // a_inst_position (world)
    f32 sx, sy;          // a_inst_size
    f32 rotation;        // a_inst_rotation
    u32 color;           // a_inst_color (RGBA8)
    f32 uvOffsetX, uvOffsetY;
    f32 uvScaleX, uvScaleY;
};
static_assert(sizeof(ParticleInstanceData) == 40, "instance stride must match the VAO layout");
}  // namespace

void ParticlePlugin::init(RenderFrameContext& ctx) {
    // Particle instancing shader, authored as particle.esshader (single source) and
    // embedded for the web build. Attribute locations are explicit, so no name bindings.
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::PARTICLE);
    auto handle = ctx.resources.createShaderWithBindings(
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex),
        resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment),
        {});
    Shader* shader = ctx.resources.getShader(handle);
    if (shader && shader->isValid()) {
        particle_shader_id_ = shader->getProgramId();
        shader->bind();
        shader->setUniform("u_texture", 0);  // sampler unit 0
        shader->unbind();
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
            glm::vec2 worldPos;
            glm::vec2 size;
            if (isLocalSpace) {
                glm::vec2 rel = p.position * emitterScale;
                if (std::abs(emitterAngle) > 0.001f) {
                    worldPos = glm::vec2(emitterWorldPos) +
                        glm::vec2(rel.x * cosA - rel.y * sinA, rel.x * sinA + rel.y * cosA);
                } else {
                    worldPos = glm::vec2(emitterWorldPos) + rel;
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
            d.px = worldPos.x;       d.py = worldPos.y;
            d.sx = size.x;           d.sy = size.y;
            d.rotation = p.rotation;
            d.color = packColor(p.color);
            d.uvOffsetX = u0;        d.uvOffsetY = v0;
            d.uvScaleX = sheet ? uvScaleX : 1.0f;
            d.uvScaleY = sheet ? uvScaleY : 1.0f;
        });

        DrawCommand cmd{};
        cmd.sort_key = DrawCommand::buildSortKey(
            ctx.current_stage, emitter.layer, particle_shader_id_, blendMode, 0, textureId,
            emitterWorldPos.z);
        cmd.index_offset = 0;            // static unit-quad indices
        cmd.index_count = 6;
        cmd.vertex_byte_offset = instByteOffset;  // base of this emitter's instance slice
        cmd.instance_count = particleCount;
        cmd.shader_id = particle_shader_id_;
        cmd.blend_mode = blendMode;
        cmd.layout_id = LayoutId::ParticleInstance;
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
