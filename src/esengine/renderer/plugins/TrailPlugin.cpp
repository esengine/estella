// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "TrailPlugin.hpp"
#include "../draw/BatchBuilder.hpp"
#include "../store/MaterialStore.hpp"
#include "../frame/RenderFrame.hpp"
#include "../rhi/Texture.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/TrailRenderer.hpp"
#include "../../trail/TrailSystem.hpp"

#include <algorithm>
#include <cmath>
#include <limits>

namespace esengine {

void TrailPlugin::collect(RenderCollectContext& collect_ctx) {
    if (!trail_system_) return;

    auto& registry = collect_ctx.registry;
    auto& frustum = collect_ctx.frustum;
    auto& clips = collect_ctx.clip_state;
    auto& buffers = collect_ctx.buffer_pool;
    auto& draw_list = collect_ctx.draw_list;
    auto& ctx = collect_ctx.frame_context;

    const f32 now = trail_system_->now();

    auto view = registry.view<ecs::Transform, ecs::TrailRenderer>();
    for (auto entity : view) {
        const auto& trail = view.get<ecs::TrailRenderer>(entity);
        if (!trail.enabled) continue;

        const trail::TrailState* state = trail_system_->getState(entity);
        if (!state || state->points.empty()) continue;

        auto& transform = view.get<ecs::Transform>(entity);
        transform.ensureDecomposed();
        const glm::vec3 headWorld = transform.worldPosition;

        // --- Build the centerline: anchors (oldest→newest), then the live head. -----
        const f32 invTime = trail.time > 1e-6f ? 1.0f / trail.time : 0.0f;
        scratch_center_.clear();
        f32 minX = std::numeric_limits<f32>::max(), minY = minX;
        f32 maxX = std::numeric_limits<f32>::lowest(), maxY = maxX;
        auto extend = [&](const glm::vec2& p) {
            minX = std::min(minX, p.x); minY = std::min(minY, p.y);
            maxX = std::max(maxX, p.x); maxY = std::max(maxY, p.y);
        };

        for (const auto& pt : state->points) {
            f32 age01 = std::min(std::max((now - pt.birth_time) * invTime, 0.0f), 1.0f);
            scratch_center_.push_back({pt.position, age01});
            extend(pt.position);
        }
        // The live head glues the ribbon to the moving entity between recorded
        // anchors. Skip it when frozen (the streak fades where it was left) or when it
        // coincides with the newest anchor (avoids a degenerate zero-length segment).
        if (trail.emitting) {
            glm::vec2 head(headWorld.x, headWorld.y);
            glm::vec2 d = head - scratch_center_.back().pos;
            if (glm::dot(d, d) > 1e-4f) {
                scratch_center_.push_back({head, 0.0f});
                extend(head);
            } else {
                scratch_center_.back().age01 = 0.0f;
            }
        }

        const usize n = scratch_center_.size();
        if (n < 2) continue;  // need at least one segment to form a ribbon

        // --- Cull against the frustum (centerline AABB padded by half the max width). -
        const f32 maxHalf = 0.5f * std::max(trail.startWidth, trail.endWidth);
        glm::vec3 aabbCenter((minX + maxX) * 0.5f, (minY + maxY) * 0.5f, headWorld.z);
        glm::vec3 halfExtents((maxX - minX) * 0.5f + maxHalf,
                              (maxY - minY) * 0.5f + maxHalf, 0.0f);
        if (!frustum.intersectsAABB(aabbCenter, halfExtents)) continue;

        // --- Draw key (mirrors MeshPlugin: material owns shading when present). ------
        u32 textureId = ctx.white_texture_id;
        if (trail.texture.isValid()) {
            if (Texture* tex = ctx.resources.getTexture(trail.texture)) {
                textureId = tex->getId();
            }
        }

        BatchDrawKey key{
            .stage = ctx.current_stage,
            .layer = trail.layer,
            .shaderId = ctx.batch_shader_id,
            .blend = static_cast<BlendMode>(trail.blendMode),
            .textureId = textureId,
            .depth = headWorld.z,
            .y = headWorld.y,
            .entity = entity,
            .type = RenderType::Trail,
        };
        if (trail.material != 0) {
            if (const MaterialRecord* m = ctx.materials ? ctx.materials->find(trail.material) : nullptr) {
                key.shaderId = (m->shader != 0) ? m->shader : ctx.batch_shader_id;
                key.blend = m->blend;
                key.materialId = trail.material;
                key.depthTest = m->depthTest;
                key.depthWrite = m->depthWrite;
                key.cull = static_cast<u8>(m->cull);
            }
        }

        // --- Emit the ribbon: 2 verts per centerline point, 6 indices per segment. ---
        scratch_verts_.clear();
        scratch_verts_.reserve(n * 2);
        glm::vec2 lastTangent(1.0f, 0.0f);
        for (usize i = 0; i < n; ++i) {
            const TrailCenter& c = scratch_center_[i];
            // Central-difference tangent (forward/backward at the ends).
            const glm::vec2& a = scratch_center_[i == 0 ? 0 : i - 1].pos;
            const glm::vec2& b = scratch_center_[i + 1 == n ? i : i + 1].pos;
            glm::vec2 seg = b - a;
            f32 len = std::sqrt(seg.x * seg.x + seg.y * seg.y);
            glm::vec2 tangent = len > 1e-6f ? seg / len : lastTangent;
            lastTangent = tangent;
            glm::vec2 perp(-tangent.y, tangent.x);

            f32 halfW = 0.5f * (trail.startWidth + (trail.endWidth - trail.startWidth) * c.age01);
            u32 color = packColor(glm::mix(trail.startColor, trail.endColor, c.age01));
            f32 u = c.age01;  // U runs head(0)→tail(1) along the ribbon

            glm::vec2 left = c.pos + perp * halfW;
            glm::vec2 right = c.pos - perp * halfW;
            scratch_verts_.push_back({{left, headWorld.z}, color, glm::vec2(u, 0.0f)});
            scratch_verts_.push_back({{right, headWorld.z}, color, glm::vec2(u, 1.0f)});
        }

        scratch_indices_.clear();
        scratch_indices_.reserve((n - 1) * 6);
        for (u32 i = 0; i + 1 < n; ++i) {
            u32 l0 = i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
            scratch_indices_.push_back(l0);
            scratch_indices_.push_back(r0);
            scratch_indices_.push_back(r1);
            scratch_indices_.push_back(l0);
            scratch_indices_.push_back(r1);
            scratch_indices_.push_back(l1);
        }

        appendIndexedBatch(buffers, draw_list, clips,
                           scratch_verts_.data(), static_cast<u32>(scratch_verts_.size()),
                           scratch_indices_.data(), static_cast<u32>(scratch_indices_.size()), key);
    }
}

}  // namespace esengine
