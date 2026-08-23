// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    UISystem.cpp
 * @brief   UISystem hit-test implementation
 * @details Layout methods are defined in UILayoutSystem.cpp to share the
 *          anonymous-namespace helpers (resolveFlexChildren, etc.).
 */

#include "./UISystem.hpp"
#include "./UIHitTestSystem.hpp"

#include "../ecs/components/Interactable.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/UIInteraction.hpp"
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/Sprite.hpp"

#include <algorithm>
#include <cstdint>

namespace esengine::ecs {

void UISystem::hitTestUpdate(Registry& registry, f32 mouseWorldX, f32 mouseWorldY) {
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
        if (!node || node->hidden_in_tree_) continue;
        // pointer-events: none on this node or any ancestor — still drawn, but
        // the pointer passes straight through to whatever is behind it.
        if (node->pointer_blocked_in_tree_) continue;
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

    hitWorldSprites(registry, mouseWorldX, mouseWorldY);
}

/**
 * World-space pick, for entities the layout tree does not contain.
 *
 * The loop above takes its geometry from UINode, so a Sprite without one can
 * never be hit there. Its size and pivot are its visible extent, so that is the
 * box; UI wins any overlap, hence running only after a miss.
 */
void UISystem::hitWorldSprites(Registry& registry, f32 mouseWorldX, f32 mouseWorldY) {
    Entity best = INVALID_ENTITY;
    i32 bestLayer = 0;
    bool haveBest = false;

    registry.eachLive<Sprite, Interactable>(
        [&](Entity entity, Sprite& sprite, Interactable& interactable) {
            if (!interactable.enabled || !interactable.raycastTarget) return;
            // The layout tree owns anything with a UINode; this pass is for the rest.
            if (registry.has<UINode>(entity)) return;
            if (!registry.has<Transform>(entity)) return;

            auto& t = registry.get<Transform>(entity);
            t.ensureDecomposed();

            if (!pointInOBB(
                mouseWorldX, mouseWorldY,
                t.worldPosition.x, t.worldPosition.y,
                sprite.size.x * t.worldScale.x, sprite.size.y * t.worldScale.y,
                sprite.pivot.x, sprite.pivot.y,
                t.worldRotation.z, t.worldRotation.w
            )) return;

            // Draw order decides who is on top, and layer is what carries it. A tie
            // goes to the later entity, which is the order the renderer batches in.
            const i32 layer = static_cast<i32>(sprite.layer);
            if (!haveBest || layer >= bestLayer) {
                haveBest = true;
                bestLayer = layer;
                best = entity;
            }
        });

    if (!haveBest) return;
    registry.getOrEmplace<UIInteraction>(best);
    hitResult.hit_entity = best;
}

u32 UISystem::pickAll(Registry& registry, f32 worldX, f32 worldY) {
    pickResults_.clear();
    const auto& nodes = tree.nodes_;

    // Depth-first ranking (a label beats its panel), draw order breaking ties.
    struct Hit {
        Entity entity;
        i32 depth;
        i32 order;
    };
    std::vector<Hit> hits;

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
        hits.push_back({entity, depth, vis ? vis->uiOrder : INT32_MIN});
    }

    std::sort(hits.begin(), hits.end(), [](const Hit& a, const Hit& b) {
        if (a.depth != b.depth) return a.depth > b.depth;
        return a.order > b.order;
    });
    pickResults_.reserve(hits.size());
    for (const Hit& h : hits) pickResults_.push_back(h.entity);
    return static_cast<u32>(pickResults_.size());
}

u32 UISystem::pick(Registry& registry, f32 worldX, f32 worldY) {
    return pickAll(registry, worldX, worldY) > 0 ? pickResults_[0].id() : INVALID_ENTITY.id();
}

}  // namespace esengine::ecs
