// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TransformSystem.hpp
 * @brief   System for computing hierarchical world transforms
 * @details Computes world-space position/rotation/scale from local transform
 *          fields, respecting parent-child hierarchy.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "System.hpp"
#include "Registry.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "../math/Math.hpp"

#include <algorithm>

namespace esengine::ecs {

/**
 * @brief How many times a transform composition INPUT has changed
 * @details One shared counter, written by every producer of a local transform
 *          field or of the hierarchy, on either side of the wasm boundary.
 * @note Modulo 2^32: aliasing needs 2^32 invalidations between two compositions.
 */
inline u32& transformMutationEpoch() {
    static u32 epoch = 1;
    return epoch;
}

/**
 * @brief Say that composed world transforms are stale
 * @details Never call this from a writer of worldPosition/worldRotation/
 *          worldScale: those are the composition's OUTPUT, and invalidating on
 *          them makes every composition immediately stale again.
 */
inline void invalidateTransformComposition() { transformMutationEpoch()++; }

class TransformSystem : public System {
public:
    static constexpr u32 MAX_HIERARCHY_DEPTH = 256;

    TransformSystem() {
        setPriority(-100);
    }

    void init(Registry& registry) override {
        (void)registry;
    }

    void update(World& world) override { compose(world.registry); }

    /**
     * @brief Compose if anything changed since the last one; O(1) if not
     * @details Consumers call this rather than update(), so a renderer and a
     *          replication sample in one generation pay for one composition.
     * @note The registry's identity is part of the comparison — a second world
     *       holding the same epoch number has not been composed.
     */
    void ensureComposed(Registry& registry) {
        if (registry.instanceId() == composedRegistry_
            && transformMutationEpoch() == composedEpoch_) return;
        compose(registry);
    }

    u32 composedEpoch() const { return composedEpoch_; }

    /**
     * @brief How many compositions have RUN
     * @details A consumer maintaining a structure from {@link lastChanged} reads
     *          this to know what it is holding: the same number means nothing
     *          composed, one more means that set is the whole difference, and any
     *          other gap means it missed compositions and has to rebuild.
     */
    u32 compositionSerial() const { return serial_; }

    /**
     * @brief Collect which entities' composed OUTPUT changed, from now on
     * @details Off by default: comparing costs about a third of a compose
     *          (bench/transform-composition) and only a consumer maintaining an
     *          incremental structure needs it. Turning it on does not compose.
     */
    void setChangeTracking(bool on) { tracking_ = on; if (!on) changed_.clear(); }
    bool changeTracking() const { return tracking_; }

    /** @brief The entities the LAST composition changed; empty unless tracking. */
    const std::vector<Entity>& lastChanged() const { return changed_; }

    /** @brief How many entities that composition wrote, changed or not. */
    u32 visited() const { return visited_; }

private:
    // Zero, while the epoch starts at one: nothing has been composed yet, so the
    // first ensure runs rather than believing a world it has never looked at.
    u32 composedEpoch_ = 0;
    u64 composedRegistry_ = 0;

    void markComposed(Registry& registry) {
        composedEpoch_ = transformMutationEpoch();
        composedRegistry_ = registry.instanceId();
    }

    std::vector<Entity> dirty_to_clear_;

    // Off on the shipped path: composition answers "are they stale", and only a
    // caller building an incremental structure pays for "which ones moved".
    bool tracking_ = false;
    std::vector<Entity>* changedOut_ = nullptr;
    std::vector<Entity> changed_;
    u32 visited_ = 0;
    u32 serial_ = 0;

    /**
     * @brief One composition, whoever asked for it
     * @details The serial advances here and nowhere else, so "a composition ran"
     *          and "the changed set describes it" cannot come apart — a caller
     *          that composed through update() would otherwise move the serial
     *          past a set nobody collected.
     */
    void compose(Registry& registry) {
        visited_ = 0;
        if (tracking_) { changed_.clear(); changedOut_ = &changed_; }
        updateDirtyTransforms(registry);
        changedOut_ = nullptr;
        ++serial_;
        markComposed(registry);
    }

    void updateDirtyTransforms(Registry& registry) {
        dirty_to_clear_.clear();

        // eachLive (no per-frame snapshot copy of the entity list): the callback
        // only reads/writes Transform fields and defers TransformDirty removal to
        // dirty_to_clear_, so it never structurally mutates the Transform pool.
        registry.eachLive<Transform>([&registry, this](Entity entity, Transform& transform) {
            if (!registry.has<Parent>(entity)) {
                bool isStatic = registry.has<TransformStatic>(entity);
                bool isDirty = registry.has<TransformDirty>(entity);

                if (isStatic && !isDirty) {
                    auto* children = registry.tryGet<Children>(entity);
                    if (children) {
                        for (Entity child : children->entities) {
                            if (registry.valid(child)) {
                                auto* childTransform = registry.tryGet<Transform>(child);
                                if (childTransform) {
                                    updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, false, 1);
                                }
                            }
                        }
                    }
                    return;
                }

                updateRootTransform(registry, entity, transform);
            }
        });

        for (Entity e : dirty_to_clear_) {
            if (registry.has<TransformDirty>(e)) {
                registry.remove<TransformDirty>(e);
            }
        }
    }

    void updateRootTransform(Registry& registry, Entity entity, Transform& transform) {
        if (changedOut_) {
            ++visited_;
            if (!transform.decomposed_
                || transform.worldPosition != transform.position
                || transform.worldRotation != transform.rotation
                || transform.worldScale != transform.scale) {
                changedOut_->push_back(entity);
            }
        }
        transform.worldPosition = transform.position;
        transform.worldRotation = transform.rotation;
        transform.worldScale = transform.scale;
        transform.decomposed_ = true;

        if (registry.has<TransformDirty>(entity)) {
            dirty_to_clear_.push_back(entity);
        }

        auto* children = registry.tryGet<Children>(entity);
        if (!children || children->entities.empty()) {
            // A root's cachedMatrix_ is only read to transform its children, and
            // with decomposed_ = true the renderer reads world TRS directly — so
            // for a childless root (the common 2D case) the compose is dead work.
            return;
        }

        transform.cachedMatrix_ = math::compose(transform.worldPosition, transform.worldRotation, transform.worldScale);
        for (Entity child : children->entities) {
            if (registry.valid(child)) {
                auto* childTransform = registry.tryGet<Transform>(child);
                if (childTransform) {
                    updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, true, 1);
                }
            }
        }
    }

    void updateEntityTransform(Registry& registry, Entity entity,
                                Transform& transform,
                                const glm::mat4& parentWorldMatrix,
                                bool parentDirty, u32 depth) {
        if (depth >= MAX_HIERARCHY_DEPTH) {
            return;
        }

        bool isDirty = parentDirty || registry.has<TransformDirty>(entity);

        if (registry.has<TransformStatic>(entity) && !isDirty) {
            auto* children = registry.tryGet<Children>(entity);
            if (children) {
                for (Entity child : children->entities) {
                    if (registry.valid(child)) {
                        auto* childTransform = registry.tryGet<Transform>(child);
                        if (childTransform) {
                            updateEntityTransform(registry, child, *childTransform, transform.cachedMatrix_, false, depth + 1);
                        }
                    }
                }
            }
            return;
        }

        glm::mat4 localMatrix = math::compose(transform.position, transform.rotation, transform.scale);
        glm::mat4 worldMatrix = parentWorldMatrix * localMatrix;

        if (changedOut_) {
            ++visited_;
            // `decomposed_` is not part of the output: a READ flips it (the ptr
            // accessor decomposes on the way out), so testing it here reports
            // every child anyone looked at as having moved.
            if (worldMatrix != transform.cachedMatrix_) changedOut_->push_back(entity);
        }
        transform.cachedMatrix_ = worldMatrix;
        transform.decomposed_ = false;

        if (isDirty && !parentDirty) {
            dirty_to_clear_.push_back(entity);
        }

        auto* children = registry.tryGet<Children>(entity);
        if (children) {
            for (Entity child : children->entities) {
                if (registry.valid(child)) {
                    auto* childTransform = registry.tryGet<Transform>(child);
                    if (childTransform) {
                        updateEntityTransform(registry, child, *childTransform, worldMatrix, isDirty, depth + 1);
                    }
                }
            }
        }
    }
};

inline bool isDescendantOf(Registry& registry, Entity entity, Entity ancestor) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (parent == ancestor) return true;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return false;
}

inline void setParent(Registry& registry, Entity child, Entity newParent) {
    if (registry.has<Parent>(child)) {
        Entity oldParent = registry.get<Parent>(child).entity;
        if (registry.valid(oldParent) && registry.has<Children>(oldParent)) {
            auto& oldChildren = registry.get<Children>(oldParent);
            auto& vec = oldChildren.entities;
            auto it = std::find(vec.begin(), vec.end(), child);
            if (it != vec.end()) {
                *it = vec.back();
                vec.pop_back();
            }
        }

        if (newParent == INVALID_ENTITY) {
            registry.remove<Parent>(child);
        }
    }

    if (newParent != INVALID_ENTITY && registry.valid(newParent)) {
        if (child == newParent || isDescendantOf(registry, newParent, child)) {
            return;
        }

        if (registry.has<Parent>(child)) {
            registry.get<Parent>(child).entity = newParent;
        } else {
            registry.emplace<Parent>(child, newParent);
        }

        if (!registry.has<Children>(newParent)) {
            registry.emplace<Children>(newParent);
        }
        auto& newChildren = registry.get<Children>(newParent).entities;
        if (std::find(newChildren.begin(), newChildren.end(), child) == newChildren.end()) {
            newChildren.push_back(child);
        }

        u32 parentDepth = 0;
        if (registry.has<HierarchyDepth>(newParent)) {
            parentDepth = registry.get<HierarchyDepth>(newParent).depth;
        }
        if (registry.has<HierarchyDepth>(child)) {
            registry.get<HierarchyDepth>(child).depth = parentDepth + 1;
        } else {
            registry.emplace<HierarchyDepth>(child, parentDepth + 1);
        }
    }

    if (!registry.has<TransformDirty>(child)) {
        registry.emplace<TransformDirty>(child);
    }
    invalidateTransformComposition();
}

/**
 * @brief Applies a scene's authored entity order to the whole world
 * @param order Entities in the desired order (first draws first, i.e. behind)
 * @param count How many entries @p order holds
 *
 * @details Two things read "order" when deciding what covers what, and one
 *          authored order has to reach both: component STORAGE order, which is
 *          the painter order of everything the renderer collects by pool walk,
 *          and each parent's CHILD LIST, which is the order the UI tree lays out
 *          and draws in (see UIRenderOrderSystem). A scene file gets both for
 *          free by spawning in order; this re-establishes them on a world that is
 *          already populated, so an editor drag or a runtime "bring to front"
 *          means the same thing a reload would.
 *
 *          Entities left out of @p order keep their relative order, after the
 *          listed ones — including inside child lists, where reparenting's
 *          swap-with-back removal can otherwise leave a stale order.
 */
inline void applySceneEntityOrder(Registry& registry, const Entity* order, usize count) {
    if (!order || count == 0) return;
    const std::vector<u32> rank = registry.buildEntityRank(order, count);
    registry.applyEntityRank(rank);

    const auto rankOf = [&rank](Entity e) {
        const u32 idx = e.index();
        return idx < rank.size() ? rank[idx] : SparseSetBase::UNRANKED;
    };
    registry.eachLive<Children>([&rankOf](Entity, Children& children) {
        auto& list = children.entities;
        if (list.size() <= 1) return;
        std::stable_sort(list.begin(), list.end(),
                         [&rankOf](Entity a, Entity b) { return rankOf(a) < rankOf(b); });
    });
}

inline Entity getRoot(Registry& registry, Entity entity) {
    while (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return entity;
}

inline void destroyWithChildren(Registry& registry, Entity entity) {
    if (registry.has<Children>(entity)) {
        auto children = registry.get<Children>(entity).entities;
        for (Entity child : children) {
            if (registry.valid(child)) {
                destroyWithChildren(registry, child);
            }
        }
    }

    if (registry.has<Parent>(entity)) {
        Entity parent = registry.get<Parent>(entity).entity;
        if (registry.valid(parent) && registry.has<Children>(parent)) {
            auto& parentChildren = registry.get<Children>(parent);
            auto& vec = parentChildren.entities;
            auto it = std::find(vec.begin(), vec.end(), entity);
            if (it != vec.end()) {
                *it = vec.back();
                vec.pop_back();
            }
        }
    }

    registry.destroy(entity);
}

}  // namespace esengine::ecs
