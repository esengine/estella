/**
 * @file    UIHitTestSystem.hpp
 * @brief   Pure geometric helpers used by UISystem hit-test
 * @details State and update entry point moved to UISystem (UISystem.hpp).
 *          This header only exposes the reusable inline math helpers.
 */
#pragma once

#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "components/UIRect.hpp"
#include "components/UIMask.hpp"

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

}  // namespace esengine::ecs
