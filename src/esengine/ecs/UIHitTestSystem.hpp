#pragma once

#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "components/UIRect.hpp"
#include "components/Interactable.hpp"
#include "components/UIInteraction.hpp"
#include "components/UIMask.hpp"
#include "UILayoutSystem.hpp"

#include <cmath>

namespace esengine::ecs {

inline f32 quaternionToAngle2D(f32 rz, f32 rw) {
    return 2.0f * std::atan2(rz, rw);
}

inline bool pointInOBB(
    f32 px, f32 py,
    f32 worldX, f32 worldY,
    f32 worldW, f32 worldH,
    f32 pivotX, f32 pivotY,
    f32 rotationZ, f32 rotationW
) {
    f32 angle = quaternionToAngle2D(rotationZ, rotationW);
    f32 sinA = std::sin(-angle);
    f32 cosA = std::cos(-angle);

    f32 dx = px - worldX;
    f32 dy = py - worldY;
    f32 localX = dx * cosA - dy * sinA + worldX;
    f32 localY = dx * sinA + dy * cosA + worldY;

    f32 left = worldX - worldW * pivotX;
    f32 right = worldX + worldW * (1.0f - pivotX);
    f32 bottom = worldY - worldH * pivotY;
    f32 top = worldY + worldH * (1.0f - pivotY);

    return localX >= left && localX <= right && localY >= bottom && localY <= top;
}

inline bool isClippedByMask(
    Registry& registry,
    Entity entity,
    f32 worldMouseX,
    f32 worldMouseY
) {
    Entity current = entity;
    while (registry.has<Parent>(current)) {
        Entity ancestor = registry.get<Parent>(current).entity;
        if (!registry.valid(ancestor)) break;

        auto* mask = registry.tryGet<UIMask>(ancestor);
        if (mask && mask->enabled) {
            auto* t = registry.tryGet<Transform>(ancestor);
            auto* rect = registry.tryGet<UIRect>(ancestor);
            if (t && rect) {
                t->ensureDecomposed();
                f32 maskW = (rect->computed_size_.x > 0.0f ? rect->computed_size_.x : rect->size.x) * t->worldScale.x;
                f32 maskH = (rect->computed_size_.y > 0.0f ? rect->computed_size_.y : rect->size.y) * t->worldScale.y;
                if (!pointInOBB(
                    worldMouseX, worldMouseY,
                    t->worldPosition.x, t->worldPosition.y,
                    maskW, maskH,
                    rect->pivot.x, rect->pivot.y,
                    t->worldRotation.z, t->worldRotation.w
                )) {
                    return true;
                }
            }
        }
        current = ancestor;
    }
    return false;
}

struct UIHitTestResult {
    Entity hit_entity{INVALID_ENTITY};
    Entity prev_hit_entity{INVALID_ENTITY};
};

static UIHitTestResult s_hit_test_result;

inline void uiHitTestUpdate(
    Registry& registry,
    f32 mouseWorldX, f32 mouseWorldY,
    bool mouseDown, bool mousePressed, bool mouseReleased
) {
    (void)mouseDown;
    (void)mousePressed;
    (void)mouseReleased;

    s_hit_test_result.prev_hit_entity = s_hit_test_result.hit_entity;
    s_hit_test_result.hit_entity = INVALID_ENTITY;

    const auto& tree = getUITree();
    const auto& nodes = tree.nodes_;

    for (i32 i = static_cast<i32>(nodes.size()) - 1; i >= 0; i--) {
        Entity entity = nodes[i].entity;

        auto* interactable = registry.tryGet<Interactable>(entity);
        if (!interactable || !interactable->enabled || !interactable->raycastTarget) continue;
        if (!registry.has<Transform>(entity)) continue;

        registry.getOrEmplace<UIInteraction>(entity);

        auto& t = registry.get<Transform>(entity);
        t.ensureDecomposed();
        auto& rect = registry.get<UIRect>(entity);

        f32 worldW = (rect.computed_size_.x > 0.0f ? rect.computed_size_.x : rect.size.x) * t.worldScale.x;
        f32 worldH = (rect.computed_size_.y > 0.0f ? rect.computed_size_.y : rect.size.y) * t.worldScale.y;

        if (pointInOBB(
            mouseWorldX, mouseWorldY,
            t.worldPosition.x, t.worldPosition.y,
            worldW, worldH,
            rect.pivot.x, rect.pivot.y,
            t.worldRotation.z, t.worldRotation.w
        )) {
            if (isClippedByMask(registry, entity, mouseWorldX, mouseWorldY)) {
                continue;
            }
            s_hit_test_result.hit_entity = entity;
            return;
        }
    }
}

inline u32 uiHitTestGetHitEntity() {
    return s_hit_test_result.hit_entity.id();
}

inline u32 uiHitTestGetHitEntityPrev() {
    return s_hit_test_result.prev_hit_entity.id();
}

}  // namespace esengine::ecs
