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
#include "../ecs/components/UINode.hpp"
#include "../ecs/components/UIVisual.hpp"
#include "../ecs/components/Sprite.hpp"
#include "../ecs/components/ContentRect.hpp"
#include "../ecs/components/Canvas.hpp"
#include "../ecs/components/UIMask.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "../ecs/components/MeshRenderer.hpp"
#include "../resource/ResourceManager.hpp"

#include <algorithm>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace esengine::ecs {

void UISystem::hitTestUpdate(Registry& registry, const PickRay& ray,
                             const resource::ResourceManager* resources) {
    hitTestUpdate(registry, ray, ray, resources);
}

void UISystem::hitTestUpdate(Registry& registry, const PickRay& worldRay, const PickRay& screenRay,
                             const resource::ResourceManager* resources) {
    hitResult.prev_hit_entity = hitResult.hit_entity;
    hitResult.hit_entity = INVALID_ENTITY;

    const auto& nodes = tree.nodes_;

    for (i32 i = static_cast<i32>(nodes.size()) - 1; i >= 0; i--) {
        Entity entity = nodes[i].entity;
        if (!registry.isEntityActive(entity)) continue;

        auto* interactable = registry.tryGet<Interactable>(entity);
        if (!interactable || !interactable->enabled || !interactable->raycastTarget) continue;
        if (!registry.has<Transform>(entity)) continue;

        // Which projection this node was drawn through decides which ray reaches
        // it. Resolved from the same set the renderer partitions by, so what is
        // clickable and what is visible cannot come apart.
        const PickRay& ray = screen_domain_.count(entity.id()) != 0 ? screenRay : worldRay;

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

        if (pointInTransformedBox(
            registry, entity, t, mouseWorldX, mouseWorldY,
            baseW, baseH, pivotX, pivotY
        )) {
            if (isClippedByMask(registry, entity, mouseWorldX, mouseWorldY)) {
                continue;
            }
            hitResult.hit_entity = entity;
            return;
        }
    }

    // World content is world content: the screen has no sprites or meshes in it.
    hitWorldContent(registry, worldRay, resources);
}

bool UISystem::hitInputsChanged(Registry& registry, const resource::ResourceManager* resources) {
    const u32 now = registry.beginChangeRead();
    const u64 meshes = resources ? resources->meshesRevision() : 0;
    const u32 since = hit_tick_;
    bool changed = registry.identity() != hit_registry_ || registry.activityEpoch() != hit_activity_
        || meshes != hit_meshes_
        || registry.anyChangedSince<Interactable>(since) || registry.anyChangedSince<UIMask>(since)
        || registry.anyChangedSince<Canvas>(since) || registry.anyChangedSince<Parent>(since);
    const bool moved = registry.anyChangedSince<Transform>(since);
    if (!changed && (moved || registry.anyChangedSince<Sprite>(since)
                     || registry.anyChangedSince<ContentRect>(since) || registry.anyChangedSince<MeshRenderer>(since))) {
        registry.eachLive<Interactable>([&](Entity e, Interactable&) {
            if (changed) return;
            changed = registry.changedSince<Transform>(e, since) || registry.changedSince<Sprite>(e, since)
                || registry.changedSince<ContentRect>(e, since) || registry.changedSince<MeshRenderer>(e, since);
        });
        if (!changed && moved) {
            registry.eachLive<UIMask>([&](Entity e, UIMask&) {
                if (!changed) changed = registry.changedSince<Transform>(e, since);
            });
        }
    }
    hit_registry_ = registry.identity();
    hit_activity_ = registry.activityEpoch();
    hit_meshes_ = meshes;
    hit_tick_ = now;
    return changed;
}

namespace {

// Depth and layer have already tied. A hierarchy key is the root id followed by
// the sibling indices on the way down; a parent precedes its whole subtree.
class PickHierarchyOrder {
public:
    explicit PickHierarchyOrder(const Registry& registry) : registry_(registry) {}

    bool before(Entity a, Entity b) {
        if (a == b) return false;
        const Entity pa = parentOf(a), pb = parentOf(b);
        if (pa == pb) {
            if (pa == INVALID_ENTITY) return a.id() < b.id();
            const u32 index = siblingIndex(pa, a);
            return index < siblingIndex(pa, b);
        }
        pathFrom(a, pa, path_a_);
        pathFrom(b, pb, path_b_);
        return std::lexicographical_compare(path_a_.rbegin(), path_a_.rend(),
                                            path_b_.rbegin(), path_b_.rend());
    }

private:
    struct SiblingIndices {
        usize scanned = 0;
        std::unordered_map<u32, u32> positions;
    };

    Entity parentOf(Entity entity) const {
        const auto* parent = registry_.tryGet<Parent>(entity);
        return parent && registry_.valid(parent->entity) ? parent->entity : INVALID_ENTITY;
    }

    u32 siblingIndex(Entity parent, Entity child) {
        const auto* children = registry_.tryGet<Children>(parent);
        if (!children) return 0;
        const auto& list = children->entities;
        // A contiguous scan is cheap compared with allocating a hash entry per
        // child. Only index a wide list after repeated scans of its contents.
        constexpr usize scansBeforeIndexing = 48;
        SiblingIndices* table = list.size() > scansBeforeIndexing ? &wide_[parent.id()] : nullptr;
        if (!table || table->scanned / scansBeforeIndexing < list.size()) {
            const auto found = std::find(list.begin(), list.end(), child);
            const auto index = static_cast<u32>(found - list.begin());
            if (table) table->scanned += index + (found != list.end());
            return index;
        }
        if (table->positions.empty()) {
            table->positions.reserve(list.size());
            for (u32 i = 0; i < list.size(); ++i) table->positions.try_emplace(list[i].id(), i);
        }
        const auto pos = table->positions.find(child.id());
        return pos == table->positions.end() ? static_cast<u32>(list.size()) : pos->second;
    }

    void pathFrom(Entity entity, Entity parent, std::vector<u32>& path) {
        path.clear();
        while (parent != INVALID_ENTITY) {
            path.push_back(siblingIndex(parent, entity));
            entity = parent;
            parent = parentOf(entity);
        }
        path.push_back(entity.id());
    }

    const Registry& registry_;
    std::unordered_map<u32, SiblingIndices> wide_;
    std::vector<u32> path_a_, path_b_;
};

}  // namespace

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
    PickHierarchyOrder order(registry);

    // Nearer wins; at the same distance the higher sorting layer does, and a tie
    // there goes to the later entity — the order the renderer batches in.
    const auto consider = [&](Entity entity, f32 t, i32 layer) {
        if (haveBest) {
            const bool sameDepth = std::abs(t - bestT) <= 1e-4f;
            if (!sameDepth && t > bestT) return;
            if (sameDepth && layer < bestLayer) return;
            // A full tie goes to the one drawn later, by its place in the hierarchy rather than by where a pool happened to list it or when
            // it was created: a node taken from a pool and added under a panel is made last and drawn first, and a number cannot tell.
            if (sameDepth && layer == bestLayer && order.before(entity, best)) return;
        }
        haveBest = true;
        bestT = t;
        bestLayer = layer;
        best = entity;
    };

    registry.eachLive<Sprite, Interactable>(
        [&](Entity entity, Sprite& sprite, Interactable& interactable) {
            if (!registry.isEntityActive(entity)) return;
            if (!interactable.enabled || !interactable.raycastTarget) return;
            // The layout tree owns anything with a UINode; this pass is for the rest.
            if (registry.has<UINode>(entity)) return;
            if (!registry.has<Transform>(entity)) return;

            auto& t = registry.get<Transform>(entity);
            t.ensureDecomposed();

            f32 px = 0.0f, py = 0.0f, hitT = 0.0f;
            if (!rayHitsPlaneZ(ray, t.worldPosition.z, px, py, hitT)) return;

            if (!pointInTransformedBox(
                registry, entity, t, px, py, sprite.size.x, sprite.size.y,
                sprite.pivot.x, sprite.pivot.y
            )) return;

            consider(entity, hitT, static_cast<i32>(sprite.layer));
        });

    // An entity that is only a rectangle — a touch area, a scroll viewport — has no sprite to take a box from. A sprite on the same
    // entity is handled above (it follows the rectangle), so this is for the ones that draw nothing.
    registry.eachLive<ContentRect, Interactable>(
        [&](Entity entity, ContentRect& rect, Interactable& interactable) {
            if (!registry.isEntityActive(entity)) return;
            if (!interactable.enabled || !interactable.raycastTarget) return;
            if (registry.has<UINode>(entity) || registry.has<Sprite>(entity)) return;
            if (!registry.has<Transform>(entity)) return;

            auto& t = registry.get<Transform>(entity);
            t.ensureDecomposed();

            f32 px = 0.0f, py = 0.0f, hitT = 0.0f;
            if (!rayHitsPlaneZ(ray, t.worldPosition.z, px, py, hitT)) return;

            if (!pointInTransformedBox(
                registry, entity, t, px, py, rect.size.x, rect.size.y,
                rect.pivot.x, rect.pivot.y
            )) return;

            // No sorting layer: it ties with a sprite at the same depth and loses to a higher layer, and the later entity wins a tie.
            consider(entity, hitT, 0);
        });

    registry.eachLive<MeshRenderer, Interactable>(
        [&](Entity entity, MeshRenderer& mesh, Interactable& interactable) {
            if (!registry.isEntityActive(entity)) return;
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
        if (!registry.isEntityActive(entity)) continue;
        if (!registry.has<Transform>(entity)) continue;

        auto* node = registry.tryGet<UINode>(entity);
        if (!node || node->computed_size_.x <= 0.0f || node->computed_size_.y <= 0.0f) continue;

        auto& t = registry.get<Transform>(entity);
        t.ensureDecomposed();

        if (!pointInTransformedBox(
            registry, entity, t, worldX, worldY,
            node->computed_size_.x, node->computed_size_.y, 0.5f, 0.5f
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
