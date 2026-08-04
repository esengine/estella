// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "MeshPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Mesh2D.hpp"

#include <cmath>

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
        if (!mesh.enabled || mesh.indices.empty()) continue;

        auto& transform = meshView.get<ecs::Transform>(entity);
        glm::vec3 position = parallaxedWorldPosition(transform, mesh.parallax, collect_ctx.camera);
        const auto& rotation = transform.worldRotation;
        const auto& scale = transform.worldScale;

        // Cull at the local AABB scaled into world space (rotation ignored — the
        // same approximation the sprite path uses).
        glm::vec2 localCenter = (mesh.localMin + mesh.localMax) * 0.5f;
        glm::vec2 localHalf = (mesh.localMax - mesh.localMin) * 0.5f;
        glm::vec3 aabbCenter = position
            + glm::vec3(localCenter.x * scale.x, localCenter.y * scale.y, 0.0f);
        glm::vec3 halfExtents(std::abs(localHalf.x * scale.x),
                              std::abs(localHalf.y * scale.y), 0.0f);
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
