// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "./frame/RenderStage.hpp"
#include "./frame/FrameConstants.hpp"
#include "./draw/RenderItem.hpp"
#include "./draw/DrawCommand.hpp"
#include "./draw/DrawList.hpp"
#include "./draw/ClipState.hpp"
#include "./rhi/TransientBufferPool.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>

#include <cmath>

namespace esengine {

struct Frustum;
class RenderContext;
class MaterialStore;
class RenderFrame;

struct RenderFrameContext {
    RenderContext& render_context;
    resource::ResourceManager& resources;
    u32 white_texture_id = 0;
    u32 batch_shader_id = 0;
    RenderStage current_stage = RenderStage::Transparent;
    glm::mat4 view_projection{1.0f};
    const MaterialStore* materials = nullptr;
    /// The owning frame, for lazily-compiled batch variants (RenderFrame::batchProgram).
    RenderFrame* frame = nullptr;
    /// This collect is the shadow pass: geometry draws depth-only, from the light.
    /// Set by the frame, which also skips every plugin that casts nothing.
    bool shadow_pass = false;
    /// The map that pass produced, handed to the meshes that receive it (0 = none).
    u32 shadow_texture_id = 0;
    /// The frame environment's prefiltered reflection atlas (0 = none this frame).
    u32 environment_texture_id = 0;
};

/** @brief What every plugin needs to know about the camera, derived once per collect
 *         from the inverse view-projection — the single source for parallax, world-rect
 *         culling and the depth draws are sorted by (each previously re-derived, or in
 *         the depth's case assumed, inside the plugins). */
struct CameraView {
    f32 left = 0.0f, bottom = 0.0f, right = 0.0f, top = 0.0f;
    glm::vec2 center{0.0f};

    /// Where the frame is seen from, in FrameConstants::camera's convention: the
    /// eye's world position when w = 1, or the unit direction pointing at the
    /// viewer when w = 0. From cameraFromViewProjection, as the shaders' copy is.
    glm::vec4 eye{0.0f, 0.0f, 1.0f, 0.0f};

    /**
     * @brief How near @p worldPos is to the viewer, larger = nearer — the order the
     *        sort key wants, and the one world z gives only while the camera looks
     *        down -Z. Orthographic projects onto the viewer direction (head-on that
     *        is worldPos.z exactly); perspective answers with -distance to the eye.
     */
    f32 viewDepth(const glm::vec3& worldPos) const {
        if (eye.w < 0.5f) return glm::dot(worldPos, glm::vec3(eye));
        return -glm::length(worldPos - glm::vec3(eye));
    }
};

inline CameraView computeCameraView(const glm::mat4& viewProjection) {
    glm::mat4 invVP = glm::inverse(viewProjection);
    glm::vec4 bl = invVP * glm::vec4(-1.0f, -1.0f, 0.0f, 1.0f);
    glm::vec4 tr = invVP * glm::vec4( 1.0f,  1.0f, 0.0f, 1.0f);
    CameraView view;
    view.left   = bl.x / bl.w;
    view.bottom = bl.y / bl.w;
    view.right  = tr.x / tr.w;
    view.top    = tr.y / tr.w;
    view.center = { (view.left + view.right) * 0.5f, (view.bottom + view.top) * 0.5f };
    view.eye    = cameraFromViewProjection(viewProjection);
    return view;
}

struct RenderCollectContext {
    ecs::Registry& registry;
    const Frustum& frustum;
    const ClipState& clip_state;
    TransientBufferPool& buffer_pool;
    DrawList& draw_list;
    RenderFrameContext& frame_context;
    CameraView camera;
};

/** @brief Decomposes @p transform and returns its world position shifted toward the
 *         camera by (1 - parallax); factor 1 = no shift, 0 = screen-pinned. Applied
 *         before the frustum cull so a parallaxed renderable is culled where drawn. */
inline glm::vec3 parallaxedWorldPosition(ecs::Transform& transform, const glm::vec2& parallax,
                                         const CameraView& camera) {
    transform.ensureDecomposed();
    glm::vec3 position = transform.worldPosition;
    position.x += camera.center.x * (1.0f - parallax.x);
    position.y += camera.center.y * (1.0f - parallax.y);
    return position;
}

/**
 * @brief The cos/sin of the turn a plane renderable draws with: its entity's rotation
 *        about Z, which is the only part a flat quad uses.
 */
inline glm::vec2 flatTurnZ(const glm::quat& rotation) {
    const f32 n = rotation.w * rotation.w + rotation.z * rotation.z;
    if (n <= 1e-12f) return {1.0f, 0.0f};
    return {(rotation.w * rotation.w - rotation.z * rotation.z) / n,
            2.0f * rotation.w * rotation.z / n};
}

/**
 * @brief World AABB half-extents of a flat box turned by @p turn (from flatTurnZ).
 *        |R| * half, exact for a box. An unturned entity gets @p half back, so the
 *        result is never narrower than the box itself.
 */
inline glm::vec3 flatHalfExtents(const glm::vec2& turn, const glm::vec3& half) {
    const f32 c = std::abs(turn.x), s = std::abs(turn.y);
    return {c * half.x + s * half.y, s * half.x + c * half.y, half.z};
}

class RenderTypePlugin {
public:
    virtual ~RenderTypePlugin() = default;

    virtual void init(RenderFrameContext& ctx) { (void)ctx; }
    virtual void shutdown() {}

    virtual u32 skipFlag() const { return 0; }

    virtual void collect(RenderCollectContext& ctx) = 0;
};

}  // namespace esengine
