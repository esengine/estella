// SPDX-License-Identifier: Apache-2.0
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
#include "components/UINode.hpp"
#include "components/UIVisual.hpp"

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

        // Hit geometry from the UINode (CSS box, pivot-centered).
        auto* node = registry.tryGet<UINode>(entity);
        if (!node) continue;
        f32 baseW = node->computed_size_.x;
        f32 baseH = node->computed_size_.y;
        f32 pivotX = 0.5f, pivotY = 0.5f;

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

u32 UISystem::pick(Registry& registry, f32 worldX, f32 worldY) const {
    const auto& nodes = tree.nodes_;

    // Rank hits by hierarchy depth (the most specific element under the
    // cursor — clicking a label picks the label, not its panel), breaking
    // ties by draw order.
    Entity best = INVALID_ENTITY;
    i32 bestDepth = -1;
    i32 bestOrder = INT32_MIN;

    for (i32 i = static_cast<i32>(nodes.size()) - 1; i >= 0; i--) {
        Entity entity = nodes[i].entity;
        if (!registry.has<Transform>(entity)) continue;

        auto* node = registry.tryGet<UINode>(entity);
        if (!node || node->computed_size_.x <= 0.0f || node->computed_size_.y <= 0.0f) continue;

        auto& t = registry.get<Transform>(entity);
        t.ensureDecomposed();

        if (!pointInOBB(
            worldX, worldY,
            t.worldPosition.x, t.worldPosition.y,
            node->computed_size_.x * t.worldScale.x,
            node->computed_size_.y * t.worldScale.y,
            0.5f, 0.5f,
            t.worldRotation.z, t.worldRotation.w
        )) continue;

        if (isClippedByMask(registry, entity, worldX, worldY)) continue;

        i32 depth = 0;
        for (Entity a = entity; registry.has<Parent>(a);) {
            Entity parent = registry.get<Parent>(a).entity;
            if (!registry.valid(parent)) break;
            depth++;
            a = parent;
        }
        auto* vis = registry.tryGet<UIVisual>(entity);
        const i32 order = vis ? vis->uiOrder : INT32_MIN;
        if (depth > bestDepth || (depth == bestDepth && order > bestOrder)) {
            bestDepth = depth;
            bestOrder = order;
            best = entity;
        }
    }
    return best.id();
}

}  // namespace esengine::ecs
