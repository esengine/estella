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
#include "../ecs/components/MeshRenderer.hpp"
#include "../resource/ResourceManager.hpp"

#include <algorithm>
#include <cstdint>

namespace esengine::ecs {

void UISystem::hitTestUpdate(Registry& registry, const PickRay& ray,
                             const resource::ResourceManager* resources) {
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

        // Each node answers on the plane it stands on. Orthographically that is
        // the same point for every node, so a flat UI picks exactly as before.
        f32 mouseWorldX = 0.0f, mouseWorldY = 0.0f, hitT = 0.0f;
        if (!rayHitsPlaneZ(ray, t.worldPosition.z, mouseWorldX, mouseWorldY, hitT)) continue;

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

    hitWorldContent(registry, ray, resources);
}

/**
 * World-space pick, for entities the layout tree does not contain — it takes its
 * geometry from UINode, leaving a bare Sprite and every MeshRenderer unreachable.
 * UI wins any overlap, hence running only after a miss.
 *
 * Sprites answer on their own plane, meshes against their oriented bounds, both
 * ranked by distance along the ray. A flat scene puts every sprite at the same
 * distance, so there the sorting layer decides alone.
 */
void UISystem::hitWorldContent(Registry& registry, const PickRay& ray,
                               const resource::ResourceManager* resources) {
    Entity best = INVALID_ENTITY;
    f32 bestT = 0.0f;
    i32 bestLayer = 0;
    bool haveBest = false;

    // Nearer wins; at the same distance the higher sorting layer does, and a tie
    // there goes to the later entity — the order the renderer batches in.
    const auto consider = [&](Entity entity, f32 t, i32 layer) {
        if (haveBest) {
            const bool sameDepth = std::abs(t - bestT) <= 1e-4f;
            if (!sameDepth && t > bestT) return;
            if (sameDepth && layer < bestLayer) return;
        }
        haveBest = true;
        bestT = t;
        bestLayer = layer;
        best = entity;
    };

    registry.eachLive<Sprite, Interactable>(
        [&](Entity entity, Sprite& sprite, Interactable& interactable) {
            if (!interactable.enabled || !interactable.raycastTarget) return;
            // The layout tree owns anything with a UINode; this pass is for the rest.
            if (registry.has<UINode>(entity)) return;
            if (!registry.has<Transform>(entity)) return;

            auto& t = registry.get<Transform>(entity);
            t.ensureDecomposed();

            f32 px = 0.0f, py = 0.0f, hitT = 0.0f;
            if (!rayHitsPlaneZ(ray, t.worldPosition.z, px, py, hitT)) return;

            if (!pointInOBB(
                px, py,
                t.worldPosition.x, t.worldPosition.y,
                sprite.size.x * t.worldScale.x, sprite.size.y * t.worldScale.y,
                sprite.pivot.x, sprite.pivot.y,
                t.worldRotation.z, t.worldRotation.w
            )) return;

            consider(entity, hitT, static_cast<i32>(sprite.layer));
        });

    registry.eachLive<MeshRenderer, Interactable>(
        [&](Entity entity, MeshRenderer& mesh, Interactable& interactable) {
            if (!interactable.enabled || !interactable.raycastTarget) return;
            if (!mesh.enabled) return;
            if (registry.has<UINode>(entity)) return;
            if (!registry.has<Transform>(entity)) return;

            // Bounds come from whichever geometry this is, the same way the cull
            // reads them: a resident mesh keeps its own and leaves the component's
            // empty, so reading the component's would test an empty box.
            const Mesh* resident =
                (resources && mesh.mesh.isValid()) ? resources->getMesh(mesh.mesh) : nullptr;
            if (!resident && mesh.indices.empty()) return;
            const glm::vec3 localMin = resident ? resident->localMin
                                                : glm::vec3(mesh.localMin, 0.0f);
            const glm::vec3 localMax = resident ? resident->localMax
                                                : glm::vec3(mesh.localMax, 0.0f);

            auto& t = registry.get<Transform>(entity);
            t.ensureDecomposed();

            f32 hitT = 0.0f;
            if (!rayHitsOBB(ray, t.worldPosition, t.worldRotation, t.worldScale,
                            localMin, localMax, hitT)) return;

            consider(entity, hitT, static_cast<i32>(mesh.layer));
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
