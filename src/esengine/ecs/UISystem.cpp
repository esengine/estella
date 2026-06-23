// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UISystem.cpp
 * @brief   UISystem hit-test implementation
 * @details Layout methods are defined in UILayoutSystem.cpp to share the
 *          anonymous-namespace helpers (resolveFlexChildren, etc.).
 */

#include "UISystem.hpp"
#include "UIHitTestSystem.hpp"

#include "components/Interactable.hpp"
#include "components/Transform.hpp"
#include "components/UIInteraction.hpp"
#include "components/UIRect.hpp"
#include "components/UINode.hpp"

namespace esengine::ecs {

void UISystem::hitTestUpdate(
    Registry& registry,
    f32 mouseWorldX, f32 mouseWorldY,
    bool mouseDown, bool mousePressed, bool mouseReleased
) {
    (void)mouseDown;
    (void)mousePressed;
    (void)mouseReleased;

    hitResult.prev_hit_entity = hitResult.hit_entity;
    hitResult.hit_entity = INVALID_ENTITY;

    const auto& nodes = tree.nodes_;

    for (i32 i = static_cast<i32>(nodes.size()) - 1; i >= 0; i--) {
        Entity entity = nodes[i].entity;

        auto* interactable = registry.tryGet<Interactable>(entity);
        if (!interactable || !interactable->enabled || !interactable->raycastTarget) continue;
        if (!registry.has<Transform>(entity)) continue;

        registry.getOrEmplace<UIInteraction>(entity);

        auto& t = registry.get<Transform>(entity);
        t.ensureDecomposed();

        // Hit geometry from the modern UINode (CSS box, pivot-centered) or the
        // legacy UIRect.
        f32 baseW, baseH, pivotX, pivotY;
        if (auto* node = registry.tryGet<UINode>(entity)) {
            baseW = node->computed_size_.x;
            baseH = node->computed_size_.y;
            pivotX = 0.5f;
            pivotY = 0.5f;
        } else if (auto* rect = registry.tryGet<UIRect>(entity)) {
            baseW = rect->computed_size_.x > 0.0f ? rect->computed_size_.x : rect->size.x;
            baseH = rect->computed_size_.y > 0.0f ? rect->computed_size_.y : rect->size.y;
            pivotX = rect->pivot.x;
            pivotY = rect->pivot.y;
        } else {
            continue;
        }

        f32 worldW = baseW * t.worldScale.x;
        f32 worldH = baseH * t.worldScale.y;

        if (pointInOBB(
            mouseWorldX, mouseWorldY,
            t.worldPosition.x, t.worldPosition.y,
            worldW, worldH,
            pivotX, pivotY,
            t.worldRotation.z, t.worldRotation.w
        )) {
            if (isClippedByMask(registry, entity, mouseWorldX, mouseWorldY)) {
                continue;
            }
            hitResult.hit_entity = entity;
            return;
        }
    }
}

}  // namespace esengine::ecs
