// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"
#include "./frame/RenderStage.hpp"
#include "./draw/RenderItem.hpp"
#include "./draw/DrawCommand.hpp"
#include "./draw/DrawList.hpp"
#include "./draw/ClipState.hpp"
#include "./rhi/TransientBufferPool.hpp"
#include "../ecs/Registry.hpp"
#include "../ecs/components/Transform.hpp"
#include "../resource/ResourceManager.hpp"

#include <glm/glm.hpp>

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
};

/** @brief The camera's view bounds in world space, derived once per collect from the
 *         inverse view-projection — the single source for every plugin's parallax and
 *         world-rect culling math (previously re-derived inside each plugin). */
struct CameraWorldRect {
    f32 left = 0.0f, bottom = 0.0f, right = 0.0f, top = 0.0f;
    glm::vec2 center{0.0f};
};

inline CameraWorldRect computeCameraWorldRect(const glm::mat4& viewProjection) {
    glm::mat4 invVP = glm::inverse(viewProjection);
    glm::vec4 bl = invVP * glm::vec4(-1.0f, -1.0f, 0.0f, 1.0f);
    glm::vec4 tr = invVP * glm::vec4( 1.0f,  1.0f, 0.0f, 1.0f);
    CameraWorldRect rect;
    rect.left   = bl.x / bl.w;
    rect.bottom = bl.y / bl.w;
    rect.right  = tr.x / tr.w;
    rect.top    = tr.y / tr.w;
    rect.center = { (rect.left + rect.right) * 0.5f, (rect.bottom + rect.top) * 0.5f };
    return rect;
}

struct RenderCollectContext {
    ecs::Registry& registry;
    const Frustum& frustum;
    const ClipState& clip_state;
    TransientBufferPool& buffer_pool;
    DrawList& draw_list;
    RenderFrameContext& frame_context;
    CameraWorldRect camera;
};

/** @brief Decomposes @p transform and returns its world position shifted toward the
 *         camera by (1 - parallax); factor 1 = no shift, 0 = screen-pinned. Applied
 *         before the frustum cull so a parallaxed renderable is culled where drawn. */
inline glm::vec3 parallaxedWorldPosition(ecs::Transform& transform, const glm::vec2& parallax,
                                         const CameraWorldRect& camera) {
    transform.ensureDecomposed();
    glm::vec3 position = transform.worldPosition;
    position.x += camera.center.x * (1.0f - parallax.x);
    position.y += camera.center.y * (1.0f - parallax.y);
    return position;
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
