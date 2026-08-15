// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "MeshPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Texture.hpp"
#include "../rhi/ShaderEmbeds.generated.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Mesh2D.hpp"
#include "../../resource/Mesh.hpp"
#include "../../resource/ShaderParser.hpp"
#include "../../core/Log.hpp"

#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/matrix_inverse.hpp>

#include <string>
#include <vector>

#include <cmath>
#include <cstring>

namespace esengine {

namespace {
// Per-channel RGBA8 multiply, for tinting per-vertex colors.
u32 mulColor(u32 a, u32 b) {
    u32 r = (((a >> 0)  & 0xFF) * ((b >> 0)  & 0xFF)) / 255u;
    u32 g = (((a >> 8)  & 0xFF) * ((b >> 8)  & 0xFF)) / 255u;
    u32 bl = (((a >> 16) & 0xFF) * ((b >> 16) & 0xFF)) / 255u;
    u32 al = (((a >> 24) & 0xFF) * ((b >> 24) & 0xFF)) / 255u;
    return r | (g << 8) | (bl << 16) | (al << 24);
}
}  // namespace

void MeshPlugin::init(RenderFrameContext& ctx) {
    // Authored as mesh.esshader, WGSL twin included. Its vertex stage is the one
    // that reads a model matrix, which is what lets the vertices stay local.
    const auto target = ctx.resources.preferredShaderTarget();
    auto parsed = resource::ShaderParser::parse(ShaderEmbeds::MESH);
    // Two permutations, because a vertex layout may only declare attributes its
    // shader consumes: geometry without normals must not be drawn by a program
    // that reads them, and the reverse leaves the normals unlit.
    auto compile = [&](std::vector<std::string> features) -> u32 {
        resource::ShaderHandle handle = ctx.resources.createShaderWithBindings(
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Vertex, "", features, target),
            resource::ShaderParser::assembleStage(parsed, resource::ShaderStage::Fragment, "", features, target),
            {}, ctx.resources.preferredShaderLanguage());
        Shader* shader = ctx.resources.getShader(handle);
        if (!shader || !shader->isValid()) return 0;
        if (shader->language() == GfxShaderLanguage::GLSL_ES300) {
            shader->bind();
            shader->setUniform("u_texture", 0);
            shader->unbind();
        }
        return shader->getProgramId();
    };
    mesh_shader_id_ = compile({});
    mesh_lit_shader_id_ = compile({"LIT"});
}

void MeshPlugin::collect(RenderCollectContext& collect_ctx) {
    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;
    auto meshView = registry.view<ecs::Transform, ecs::Mesh2D>();

    u32 litProgram = 0;

    for (auto entity : meshView) {
        const auto& mesh = meshView.get<ecs::Mesh2D>(entity);
        // Empty indices no longer mean "nothing to draw": a resident mesh keeps
        // its geometry on the GPU and its inline payload deliberately empty.
        if (!mesh.enabled || (mesh.indices.empty() && !mesh.mesh.isValid())) continue;

        auto& transform = meshView.get<ecs::Transform>(entity);
        glm::vec3 position = parallaxedWorldPosition(transform, mesh.parallax, collect_ctx.camera);
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        // Bounds come from whichever geometry this is: a resident mesh keeps its
        // own, and the inline payload's are recomputed on upload. Reading the
        // component's for a resident mesh would cull it against an empty box.
        const Mesh* resident = mesh.mesh.isValid() ? ctx.resources.getMesh(mesh.mesh) : nullptr;
        const glm::vec3 localMin = resident ? resident->localMin : glm::vec3(mesh.localMin, 0.0f);
        const glm::vec3 localMax = resident ? resident->localMax : glm::vec3(mesh.localMax, 0.0f);

        // Cull at the local AABB scaled into world space (rotation ignored — the
        // same approximation the sprite path uses).
        glm::vec3 localCenter = (localMin + localMax) * 0.5f;
        glm::vec3 localHalf = (localMax - localMin) * 0.5f;
        glm::vec3 aabbCenter = position + localCenter * scale;
        glm::vec3 halfExtents = glm::abs(localHalf * scale);
        if (!frustum.intersectsAABB(aabbCenter, halfExtents)) continue;

        u32 textureId = ctx.white_texture_id;
        if (mesh.texture.isValid()) {
            if (Texture* tex = ctx.resources.getTexture(mesh.texture)) {
                textureId = tex->getId();
            }
        }

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = mesh.layer,
            .shaderId = ctx.batch_shader_id,
            .blend = BlendMode::Normal,
            .textureId = textureId,
            .depth = position.z,
            .y = position.y,
            .entity = entity,
            .type = RenderType::Mesh,
        };

        // Material resolve mirrors SpritePlugin: an unregistered handle falls back to
        // the default batch shader; a material owns shading fully, so it takes
        // precedence over the lit toggle.
        if (mesh.material != 0) {
            if (const MaterialRecord* m = ctx.materials ? ctx.materials->find(mesh.material) : nullptr) {
                key.shaderId = (m->shader != 0) ? m->shader : ctx.batch_shader_id;
                key.blend = m->blend;
                key.materialId = mesh.material;
                key.depthTest = m->depthTest;
                key.depthWrite = m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
            }
        } else if (mesh.lit && ctx.frame) {
            if (litProgram == 0) litProgram = ctx.frame->batchProgram({"LIT"});
            if (litProgram != 0) key.shaderId = litProgram;
        }

        // Resident geometry: only the transform is written for the frame. Its
        // vertices are local-space and untouched, so the CPU loop below — which
        // exists to bake world space into every vertex — is skipped entirely.
        if (resident && mesh_shader_id_ != 0) {
            const u32 residentShader = resident->hasNormals ? mesh_lit_shader_id_ : mesh_shader_id_;
            if (resident->isDrawable() && residentShader != 0) {
                const u32 stride = resident->hasNormals
                    ? MESH_INSTANCE_STRIDE_LIT : MESH_INSTANCE_STRIDE;
                u32 instOffset = buffers.allocVertices(LayoutId::MeshInstance, stride);
                auto* dst = buffers.vertexData(LayoutId::MeshInstance) + instOffset;
                glm::mat4 model = glm::translate(glm::mat4(1.0f), position)
                                * glm::mat4_cast(rotation)
                                * glm::scale(glm::mat4(1.0f), scale);
                std::memcpy(dst, &model[0][0], 64);
                u32 tintRGBA = packColor(mesh.color);
                std::memcpy(dst + 64, &tintRGBA, 4);
                if (resident->hasNormals) {
                    // Written per object rather than derived per vertex: this is
                    // the transform a normal takes under a non-uniform scale.
                    const glm::mat3 nrm = glm::transpose(glm::inverse(glm::mat3(model)));
                    for (u32 row = 0; row < 3; ++row) {
                        std::memcpy(dst + 68 + row * 12, &nrm[row][0], 12);
                    }
                }

                key.shaderId = (mesh.material != 0 && key.materialId != 0)
                    ? key.shaderId : residentShader;
                key.layoutId = LayoutId::MeshInstance;
                key.instanceCount = 1;
                key.vertexBuffer = resident->vertexBuffer;
                key.indexBuffer = resident->indexBuffer;
                key.vertexLayout = resident->layout;
                pushBatchDraw(draw_list, clips, instOffset, 0, 0, resident->indexCount, key);
            }
            continue;
        }

        f32 angle = 2.0f * std::atan2(rotation.z, rotation.w);
        bool rotated = std::abs(angle) > 0.001f;
        f32 cosA = 1.0f, sinA = 0.0f;
        if (rotated) {
            cosA = std::cos(angle);
            sinA = std::sin(angle);
        }

        u32 tint = packColor(mesh.color);
        bool tinted = tint != 0xFFFFFFFFu;

        scratch_.resize(mesh.vertices.size());
        for (usize v = 0; v < mesh.vertices.size(); ++v) {
            const auto& in = mesh.vertices[v];
            glm::vec2 local(in.position.x * scale.x, in.position.y * scale.y);
            glm::vec3 world = rotated
                ? glm::vec3(position.x + local.x * cosA - local.y * sinA,
                            position.y + local.x * sinA + local.y * cosA,
                            position.z)
                : glm::vec3(position.x + local.x, position.y + local.y, position.z);
            scratch_[v] = { world, tinted ? mulColor(in.color, tint) : in.color, in.uv };
        }

        appendIndexedBatch(buffers, draw_list, clips,
                           scratch_.data(), static_cast<u32>(scratch_.size()),
                           mesh.indices.data(), static_cast<u32>(mesh.indices.size()), key);
    }
}

}  // namespace esengine
