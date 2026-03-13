#include "RenderFrame.hpp"
#include "../core/Log.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UIRect.hpp"
#include "../ecs/components/UIMask.hpp"
#include "../ecs/components/Hierarchy.hpp"

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#include <glm/glm.hpp>

#include <algorithm>
#include <cmath>
#include <unordered_set>
#include <vector>

namespace esengine {

namespace {

struct ScreenRect {
    i32 x = 0, y = 0, w = 0, h = 0;
};

ScreenRect intersectRects(const ScreenRect& a, const ScreenRect& b) {
    i32 x1 = std::max(a.x, b.x);
    i32 y1 = std::max(a.y, b.y);
    i32 x2 = std::min(a.x + a.w, b.x + b.w);
    i32 y2 = std::min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return {0, 0, 0, 0};
    return {x1, y1, x2 - x1, y2 - y1};
}

glm::vec2 worldToScreen(f32 wx, f32 wy, const glm::mat4& vp,
                         i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    glm::vec4 clip = vp * glm::vec4(wx, wy, 0.0f, 1.0f);
    f32 ndcX = clip.x / clip.w;
    f32 ndcY = clip.y / clip.w;
    f32 sx = static_cast<f32>(vpX) + (ndcX * 0.5f + 0.5f) * static_cast<f32>(vpW);
    f32 sy = static_cast<f32>(vpY) + (ndcY * 0.5f + 0.5f) * static_cast<f32>(vpH);
    return {sx, sy};
}

ScreenRect computeMaskScreenRect(
    ecs::Registry& registry, Entity entity,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    if (!registry.has<ecs::UIRect>(entity) || !registry.has<ecs::Transform>(entity)) {
        return {0, 0, 0, 0};
    }
    const auto& uiRect = registry.get<ecs::UIRect>(entity);
    const auto& transform = registry.get<ecs::Transform>(entity);

    f32 sizeX = uiRect.computed_size_.x > 0 ? uiRect.computed_size_.x : uiRect.size.x;
    f32 sizeY = uiRect.computed_size_.y > 0 ? uiRect.computed_size_.y : uiRect.size.y;
    f32 worldW = sizeX * transform.worldScale.x;
    f32 worldH = sizeY * transform.worldScale.y;
    f32 cx = transform.worldPosition.x;
    f32 cy = transform.worldPosition.y;
    f32 px = uiRect.pivot.x;
    f32 py = uiRect.pivot.y;

    f32 localLeft = -worldW * px;
    f32 localRight = worldW * (1.0f - px);
    f32 localBottom = -worldH * py;
    f32 localTop = worldH * (1.0f - py);

    f32 angle = 2.0f * std::atan2(transform.worldRotation.z, transform.worldRotation.w);
    f32 cosA = std::cos(angle);
    f32 sinA = std::sin(angle);

    glm::vec2 corners[4] = {
        {cx + localLeft  * cosA - localBottom * sinA, cy + localLeft  * sinA + localBottom * cosA},
        {cx + localRight * cosA - localBottom * sinA, cy + localRight * sinA + localBottom * cosA},
        {cx + localRight * cosA - localTop    * sinA, cy + localRight * sinA + localTop    * cosA},
        {cx + localLeft  * cosA - localTop    * sinA, cy + localLeft  * sinA + localTop    * cosA},
    };

    f32 minX = std::numeric_limits<f32>::max();
    f32 minY = std::numeric_limits<f32>::max();
    f32 maxX = std::numeric_limits<f32>::lowest();
    f32 maxY = std::numeric_limits<f32>::lowest();
    for (const auto& c : corners) {
        glm::vec2 s = worldToScreen(c.x, c.y, vp, vpX, vpY, vpW, vpH);
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
        if (maskSet.count(static_cast<u32>(parent))) {
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
        if (stencilSet.count(static_cast<u32>(parent))) return true;
        current = parent;
    }
    return false;
}

void applyScissorToDescendants(
    ecs::Registry& registry, RenderFrame& frame, Entity entity,
    const ScreenRect& clipRect, const std::unordered_set<u32>& maskSet,
    const glm::mat4& vp, i32 vpX, i32 vpY, i32 vpW, i32 vpH
) {
    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        ScreenRect childClip = clipRect;

        if (maskSet.count(static_cast<u32>(child))) {
            const auto& childMask = registry.get<ecs::UIMask>(child);
            if (childMask.mode == ecs::MaskMode::Scissor) {
                ScreenRect childRect = computeMaskScreenRect(registry, child, vp, vpX, vpY, vpW, vpH);
                childClip = intersectRects(clipRect, childRect);
            }
        }

        frame.setEntityClipRect(static_cast<u32>(child), childClip.x, childClip.y, childClip.w, childClip.h);
        applyScissorToDescendants(registry, frame, child, childClip, maskSet, vp, vpX, vpY, vpW, vpH);
    }
}

static constexpr i32 MAX_STENCIL_REF = 255;

void applyStencilDescendants(ecs::Registry& registry, RenderFrame& frame,
                              Entity entity, i32 refValue,
                              const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed);

void applyStencilHierarchy(ecs::Registry& registry, RenderFrame& frame,
                            Entity entity, i32 refValue,
                            const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed) {
    if (overflowed) return;
    frame.setEntityStencilMask(static_cast<u32>(entity), refValue);

    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        if (overflowed) return;
        if (stencilSet.count(static_cast<u32>(child))) {
            if (nextRef > MAX_STENCIL_REF) { overflowed = true; return; }
            applyStencilHierarchy(registry, frame, child, nextRef++, stencilSet, nextRef, overflowed);
        } else {
            frame.setEntityStencilTest(static_cast<u32>(child), refValue);
            applyStencilDescendants(registry, frame, child, refValue, stencilSet, nextRef, overflowed);
        }
    }
}

void applyStencilDescendants(ecs::Registry& registry, RenderFrame& frame,
                              Entity entity, i32 refValue,
                              const std::unordered_set<u32>& stencilSet, i32& nextRef, bool& overflowed) {
    if (overflowed) return;
    if (!registry.has<ecs::Children>(entity)) return;
    const auto& children = registry.get<ecs::Children>(entity);
    for (auto child : children.entities) {
        if (overflowed) return;
        if (stencilSet.count(static_cast<u32>(child))) {
            if (nextRef > MAX_STENCIL_REF) { overflowed = true; return; }
            applyStencilHierarchy(registry, frame, child, nextRef++, stencilSet, nextRef, overflowed);
        } else {
            frame.setEntityStencilTest(static_cast<u32>(child), refValue);
            applyStencilDescendants(registry, frame, child, refValue, stencilSet, nextRef, overflowed);
        }
    }
}

}  // anonymous namespace

void RenderFrame::processMasks(ecs::Registry& registry, i32 vpX, i32 vpY, i32 vpW, i32 vpH) {
    clearAllClipRects();
    clearAllStencilMasks();

    auto maskView = registry.view<ecs::UIMask>();
    std::vector<Entity> scissorMasks;
    std::vector<Entity> stencilMasks;
    std::unordered_set<u32> maskSet;
    std::unordered_set<u32> stencilSet;

    for (auto entity : maskView) {
        const auto& mask = registry.get<ecs::UIMask>(entity);
        if (!mask.enabled) continue;
        maskSet.insert(static_cast<u32>(entity));
        if (mask.mode == ecs::MaskMode::Stencil) {
            stencilMasks.push_back(entity);
            stencilSet.insert(static_cast<u32>(entity));
        } else {
            scissorMasks.push_back(entity);
        }
    }

    if (scissorMasks.empty() && stencilMasks.empty()) return;

    if (!scissorMasks.empty()) {
        std::vector<Entity> rootScissors;
        for (auto entity : scissorMasks) {
            if (!hasAncestorScissorMask(registry, entity, maskSet)) {
                rootScissors.push_back(entity);
            }
        }

        for (auto entity : rootScissors) {
            ScreenRect rect = computeMaskScreenRect(registry, entity, view_projection_, vpX, vpY, vpW, vpH);
            applyScissorToDescendants(registry, *this, entity, rect, maskSet, view_projection_, vpX, vpY, vpW, vpH);
        }
    }

    if (!stencilMasks.empty()) {
#ifdef ES_PLATFORM_WEB
        glClearStencil(0);
        glClear(GL_STENCIL_BUFFER_BIT);
#endif

        std::vector<Entity> rootStencils;
        for (auto entity : stencilMasks) {
            if (!hasAncestorStencilMask(registry, entity, stencilSet)) {
                rootStencils.push_back(entity);
            }
        }

        i32 nextRef = 1;
        bool overflowed = false;
        for (auto entity : rootStencils) {
            if (overflowed) break;
            if (nextRef > MAX_STENCIL_REF) break;
            applyStencilHierarchy(registry, *this, entity, nextRef++, stencilSet, nextRef, overflowed);
        }

        if (overflowed) {
            ES_LOG_WARN("Stencil mask overflow: too many nested masks (>255)");
        }
    }
}

}  // namespace esengine
