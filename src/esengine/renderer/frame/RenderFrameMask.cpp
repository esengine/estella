// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#include "./RenderFrame.hpp"
#include "../../core/Log.hpp"
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/UINode.hpp"
#include "../../ecs/components/ContentRect.hpp"
#include "../../ecs/components/UIMask.hpp"
#include "../../ecs/components/Hierarchy.hpp"
#include "../../ecs/FlatGeometry.hpp"

#include <glm/glm.hpp>

#include <algorithm>
#include <cmath>
#include <unordered_set>
#include <vector>

namespace esengine {

namespace {

using ScreenRect = ScissorRect;

ScreenRect intersectRects(const ScreenRect& a, const ScreenRect& b) {
    i32 x1 = std::max(a.x, b.x);
    i32 y1 = std::max(a.y, b.y);
    i32 x2 = std::min(a.x + a.w, b.x + b.w);
    i32 y2 = std::min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return {0, 0, 0, 0};
    return {x1, y1, x2 - x1, y2 - y1};
}

glm::vec2 worldToScreen(const glm::vec3& world, const glm::mat4& vp,
                         i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    glm::vec4 clip = vp * glm::vec4(world, 1.0f);
    f32 ndcX = clip.x / clip.w;
    f32 ndcY = clip.y / clip.w;
    f32 sx = static_cast<f32>(vpX) + (ndcX * 0.5f + 0.5f) * static_cast<f32>(vpW);
    f32 sy = static_cast<f32>(vpY) + (ndcY * 0.5f + 0.5f) * static_cast<f32>(vpH);
    return {sx, sy};
}

/// Whether the masks being laid out stand in the world (and so are taken from the render origin) or on the screen, whose units have none.
thread_local bool g_masksInWorld = false;

/// The box a mask clips to and where it sits: a UINode's computed box centred on the transform, or, for content laid out by its
/// transform alone, the entity's ContentRect about its pivot. A zero size means there is no box.
struct MaskBox {
    glm::vec2 size{0.0f, 0.0f};
    /// The box centre's offset from the transform, in local units (0,0 for a UINode, whose box is centred).
    glm::vec2 centerOffset{0.0f, 0.0f};
    bool present = false;
};

MaskBox maskBoxOf(ecs::Registry& registry, Entity entity) {
    if (const auto* node = registry.tryGet<ecs::UINode>(entity)) {
        return {node->computed_size_, {0.0f, 0.0f}, true};
    }
    if (const auto* rect = registry.tryGet<ecs::ContentRect>(entity)) {
        return {rect->size, {(0.5f - rect->pivot.x) * rect->size.x, (0.5f - rect->pivot.y) * rect->size.y}, true};
    }
    return {};
}

ScreenRect computeMaskScreenRect(
    ecs::Registry& registry, Entity entity,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    const MaskBox box = maskBoxOf(registry, entity);
    if (!box.present || !registry.has<ecs::Transform>(entity)) {
        return {0, 0, 0, 0};
    }
    if (box.size.x <= 0.0f || box.size.y <= 0.0f) return {0, 0, 0, 0};
    auto& transform = registry.get<ecs::Transform>(entity);
    // The world TRS below is decomposed on demand, so a mask whose transform no
    // other pass has read this frame would be clipped to where it used to be.
    transform.ensureDecomposed();

    if (transform.worldScale.x == 0 || transform.worldScale.y == 0
        || !ecs::hasFlatGeometryArea(registry, entity, transform)) return {0, 0, 0, 0};
    glm::vec3 axisX, axisY;
    if (registry.has<ecs::Parent>(entity)) {
        axisX = glm::vec3(transform.cachedMatrix_[0]);
        axisY = glm::vec3(transform.cachedMatrix_[1]);
    } else {
        const auto turn = flatTurnZ(transform.worldRotation);
        axisX = glm::vec3(turn.x, turn.y, 0) * transform.worldScale.x;
        axisY = glm::vec3(-turn.y, turn.x, 0) * transform.worldScale.y;
    }
    const glm::vec3 hx = axisX * box.size.x * .5f;
    const glm::vec3 hy = axisY * box.size.y * .5f;
    const glm::vec3 origin = g_masksInWorld ? rebased(transform.worldPosition) : glm::vec3(transform.worldPosition);
    const glm::vec3 center = origin + axisX * box.centerOffset.x + axisY * box.centerOffset.y;
    const glm::vec3 corners[] = {center - hx - hy, center + hx - hy,
                                center + hx + hy, center - hx + hy};

    f32 minX = std::numeric_limits<f32>::max();
    f32 minY = std::numeric_limits<f32>::max();
    f32 maxX = std::numeric_limits<f32>::lowest();
    f32 maxY = std::numeric_limits<f32>::lowest();
    for (const auto& c : corners) {
        glm::vec2 s = worldToScreen(c, vp, vpX, vpY, vpW, vpH);
        minX = std::min(minX, s.x);
        minY = std::min(minY, s.y);
        maxX = std::max(maxX, s.x);
        maxY = std::max(maxY, s.y);
    }

    return {
        static_cast<i32>(std::round(minX)),
        static_cast<i32>(std::round(minY)),
        static_cast<i32>(std::round(maxX - minX)),
        static_cast<i32>(std::round(maxY - minY)),
    };
}

bool hasAncestorScissorMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& maskSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (maskSet.count(parent.id())) {
            const auto& parentMask = registry.get<ecs::UIMask>(parent);
            if (parentMask.mode == ecs::MaskMode::Scissor) return true;
        }
        current = parent;
    }
    return false;
}

bool hasAncestorStencilMask(ecs::Registry& registry, Entity entity,
                             const std::unordered_set<u32>& stencilSet) {
    Entity current = entity;
    while (registry.has<ecs::Parent>(current)) {
        Entity parent = registry.get<ecs::Parent>(current).entity;
        if (parent == INVALID_ENTITY) break;
        if (stencilSet.count(parent.id())) return true;
        current = parent;
    }
    return false;
}

void applyScissorToDescendants(
    ecs::Registry& registry, RenderFrame& frame, Entity entity,
    const ScreenRect& clipRect, const std::unordered_set<u32>& maskSet,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH,
    std::vector<std::pair<Entity, ScissorRect>>& work
) {
    work.clear();
    work.emplace_back(entity, clipRect);
    usize walked = 0;
    while (!work.empty()) {
        if (++walked > registry.entityCount()) {
            ES_LOG_WARN("Scissor hierarchy repeats nodes; stopping mask traversal");
            work.clear();
            return;
        }
        const auto [owner, parentClip] = work.back();
        work.pop_back();
        if (!registry.has<ecs::Children>(owner)) continue;
        const auto& children = registry.get<ecs::Children>(owner).entities;
        for (auto it = children.rbegin(); it != children.rend(); ++it) {
            const Entity child = *it;
            if (!registry.valid(child)) continue;
            ScreenRect childClip = parentClip;
            if (maskSet.count(child.id())) {
                const auto& childMask = registry.get<ecs::UIMask>(child);
                if (childMask.mode == ecs::MaskMode::Scissor) {
                    const auto childRect = computeMaskScreenRect(registry, child, vp, vpX, vpY, vpW, vpH);
                    childClip = intersectRects(parentClip, childRect);
                }
            }
            frame.setEntityClipRect(child.id(), childClip.x, childClip.y, childClip.w, childClip.h);
            work.emplace_back(child, childClip);
        }
    }
}

static constexpr i32 MAX_STENCIL_REF = 255;

bool hasEmptyMaskBox(ecs::Registry& registry, Entity entity) {
    const MaskBox box = maskBoxOf(registry, entity);
    auto* transform = registry.tryGet<ecs::Transform>(entity);
    if (!box.present || !transform) return false;
    if (box.size.x <= 0.0f || box.size.y <= 0.0f) return true;
    transform->ensureDecomposed();
    return transform->worldScale.x == 0 || transform->worldScale.y == 0
        || !ecs::hasFlatGeometryArea(registry, entity, *transform);
}

void applyStencilHierarchy(ecs::Registry& registry, RenderFrame& frame,
                            Entity entity, i32 refValue,
                            const std::unordered_set<u32>& stencilSet, bool& overflowed,
                            std::vector<std::pair<Entity, i32>>& work) {
    work.clear();
    if (hasEmptyMaskBox(registry, entity)) {
        refValue = 0;
        frame.setEntityClipRect(entity.id(), 0, 0, 0, 0);
    } else {
        frame.setEntityStencilMask(entity.id(), refValue, true);
    }
    const auto enqueueChildren = [&](Entity owner, i32 parentRef) {
        if (!registry.has<ecs::Children>(owner)) return;
        const auto& children = registry.get<ecs::Children>(owner).entities;
        for (auto it = children.rbegin(); it != children.rend(); ++it) {
            if (registry.valid(*it)) work.emplace_back(*it, parentRef);
        }
    };
    enqueueChildren(entity, refValue);
    usize walked = 0;
    while (!work.empty()) {
        if (++walked > registry.entityCount()) {
            ES_LOG_WARN("Stencil hierarchy repeats nodes; stopping mask traversal");
            work.clear();
            return;
        }
        auto [owner, currentRef] = work.back();
        work.pop_back();
        if (currentRef == 0) {
            frame.setEntityClipRect(owner.id(), 0, 0, 0, 0);
        } else if (stencilSet.count(owner.id())) {
            if (hasEmptyMaskBox(registry, owner)) {
                frame.setEntityClipRect(owner.id(), 0, 0, 0, 0);
                enqueueChildren(owner, 0);
                continue;
            }
            if (currentRef == MAX_STENCIL_REF) {
                overflowed = true;
                frame.setEntityClipRect(owner.id(), 0, 0, 0, 0);
                enqueueChildren(owner, 0);
                continue;
            }
            ++currentRef;
            frame.setEntityStencilMask(owner.id(), currentRef, true);
        } else {
            frame.setEntityStencilTest(owner.id(), currentRef, true);
        }
        enqueueChildren(owner, currentRef);
    }
}

}  // anonymous namespace

void RenderFrame::processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    g_masksInWorld = true;
    processMasks(registry, view_projection_, vpX, vpY, vpW, vpH);
    g_masksInWorld = false;
}

void RenderFrame::processMasks(ecs::Registry& registry, const glm::mat4& projection,
                               i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    clearAllClipRects();
    clearAllStencilMasks();

    auto maskView = registry.activeView<ecs::UIMask>();
    std::vector<Entity>& scissorMasks = mask_scissor_scratch_;
    std::vector<Entity>& stencilMasks = mask_stencil_scratch_;
    std::unordered_set<u32>& maskSet = mask_set_scratch_;
    std::unordered_set<u32>& stencilSet = stencil_set_scratch_;
    scissorMasks.clear();
    stencilMasks.clear();
    maskSet.clear();
    stencilSet.clear();

    for (auto entity : maskView) {
        const auto& mask = registry.get<ecs::UIMask>(entity);
        if (!mask.enabled) continue;
        maskSet.insert(entity.id());
        if (mask.mode == ecs::MaskMode::Stencil) {
            stencilMasks.push_back(entity);
            stencilSet.insert(entity.id());
        } else {
            scissorMasks.push_back(entity);
        }
    }

    if (scissorMasks.empty() && stencilMasks.empty()) return;

    if (!scissorMasks.empty()) {
        std::vector<Entity>& rootScissors = mask_root_scratch_;
        rootScissors.clear();
        for (auto entity : scissorMasks) {
            if (!hasAncestorScissorMask(registry, entity, maskSet)) {
                rootScissors.push_back(entity);
            }
        }

        for (auto entity : rootScissors) {
            ScreenRect rect = computeMaskScreenRect(registry, entity, projection, vpX, vpY, vpW, vpH);
            rect = intersectRects(rect, {vpX, vpY, vpW, vpH});
            applyScissorToDescendants(registry, *this, entity, rect, maskSet, projection, vpX, vpY, vpW, vpH, mask_scissor_walk_scratch_);
        }
    }

    if (!stencilMasks.empty()) {
#ifdef ES_PLATFORM_WEB
        device_.clearStencil(0);
#endif

        std::vector<Entity>& rootStencils = mask_root_scratch_;
        rootStencils.clear();
        for (auto entity : stencilMasks) {
            if (!hasAncestorStencilMask(registry, entity, stencilSet)) {
                rootStencils.push_back(entity);
            }
        }

        bool overflowed = false;
        for (auto entity : rootStencils) {
            applyStencilHierarchy(registry, *this, entity, 1, stencilSet, overflowed, mask_stencil_walk_scratch_);
        }

        if (overflowed) {
            ES_LOG_WARN("Stencil mask overflow: too many nested masks (>255)");
        }
    }
}

}  // namespace esengine
