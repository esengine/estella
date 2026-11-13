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
#include "FlatGeometry.hpp"
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
     * @details A consumer compares it with the serial at its last acknowledgement
     *          to answer "has anything composed since?" without looking at a set.
     */
    u32 compositionSerial() const { return serial_; }

    /**
     * @brief Collect which entities' composed OUTPUT changed, from now on
     * @note One consumer. The pending set is a mailbox, not a per-reader journal:
     *       whoever acknowledges empties it for everyone.
     */
    void setChangeTracking(bool on) {
        tracking_ = on;
        if (!on) takeChanges();
    }
    bool changeTracking() const { return tracking_; }

    /**
     * @brief What every composition since the last acknowledgement changed
     * @details ACCUMULATED, not per-composition: a renderer composes each frame
     *          and a consumer samples every few. Duplicates are kept, because
     *          applying an entity twice is idempotent for every consumer.
     */
    const std::vector<Entity>& pendingChanges() const { return changed_; }

    /**
     * @brief Whether the pending set was dropped for being bigger than a rebuild
     * @details Once more entities have changed than a composition writes, reading
     *          them all again is cheaper than replaying the list — so it is
     *          dropped and the consumer is told to rebuild instead of handed a
     *          set that costs more than the thing it saves.
     */
    bool changesOverflowed() const { return overflowed_; }

    /** @brief Acknowledge the pending set: it is applied, and starts again. */
    void takeChanges() { changed_.clear(); overflowed_ = false; }

    /** @brief How many entities the last composition wrote, changed or not. */
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
    bool overflowed_ = false;
    struct TraversalTask {
        Entity entity;
        const glm::mat4* parentMatrix;
        bool parentDirty;
        bool parentFlatCollapsed;
    };
    std::vector<TraversalTask> pending_;
    std::vector<u32> traversal_stamps_;
    u32 traversal_stamp_ = 0;
    bool have_dirty_ = false;
    bool have_static_ = false;
    bool have_children_ = false;
    bool have_collapsed_ = false;

    void setFlatCollapsed(Registry& registry, Entity entity, bool collapsed) {
        if (!collapsed && !have_collapsed_) return;
        const bool present = have_collapsed_ && registry.has<FlatGeometryCollapsed>(entity);
        if (collapsed && !present) {
            registry.emplace<FlatGeometryCollapsed>(entity);
            have_collapsed_ = true;
        } else if (!collapsed && present) {
            registry.remove<FlatGeometryCollapsed>(entity);
        }
    }

    bool visitOnce(Entity entity) {
        const auto index = entity.index();
        if (index >= traversal_stamps_.size()) traversal_stamps_.resize(index + 1, 0);
        if (traversal_stamps_[index] == traversal_stamp_) return false;
        traversal_stamps_[index] = traversal_stamp_;
        return true;
    }

    /**
     * @brief One composition, whoever asked for it
     * @details The serial advances here and nowhere else, so "a composition ran"
     *          and "the changed set describes it" cannot come apart — a caller
     *          that composed through update() would otherwise move the serial
     *          past a set nobody collected.
     */
    void compose(Registry& registry) {
        if (++traversal_stamp_ == 0) {
            std::fill(traversal_stamps_.begin(), traversal_stamps_.end(), 0);
            ++traversal_stamp_;
        }
        visited_ = 0;
        if (tracking_ && !overflowed_) changedOut_ = &changed_;
        updateDirtyTransforms(registry);
        changedOut_ = nullptr;
        // Past the point where replaying the list beats re-reading the world.
        if (changed_.size() > visited_) {
            changed_.clear();
            overflowed_ = true;
        }
        ++serial_;
        markComposed(registry);
    }

    void updateDirtyTransforms(Registry& registry) {
        dirty_to_clear_.clear();
        have_dirty_ = !registry.entitiesWith<TransformDirty>().empty();
        have_static_ = !registry.entitiesWith<TransformStatic>().empty();
        have_children_ = !registry.entitiesWith<Children>().empty();
        have_collapsed_ = !registry.entitiesWith<FlatGeometryCollapsed>().empty();
        const bool haveParents = !registry.entitiesWith<Parent>().empty();

        // eachLive (no per-frame snapshot copy of the entity list): the callback
        // writes Transform fields and derived collapse tags, while deferring
        // TransformDirty removal; the Transform pool itself stays stable.
        registry.eachLive<Transform>([&registry, this, haveParents](Entity entity, Transform& transform) {
            if (!haveParents || !registry.has<Parent>(entity)) {
                bool isStatic = have_static_ && registry.has<TransformStatic>(entity);
                bool isDirty = have_dirty_ && registry.has<TransformDirty>(entity);

                if (isStatic && !isDirty) {
                    auto* children = registry.tryGet<Children>(entity);
                    if (children) {
                        visitOnce(entity);
                        for (Entity child : children->entities) {
                            updateEntityTransform(registry, child, transform.cachedMatrix_, false,
                                registry.has<FlatGeometryCollapsed>(entity));
                        }
                    }
                    return;
                }

                updateRootTransform(registry, entity, transform, isDirty);
            }
        });

        if (have_children_) {
            const glm::mat4 identity{1.0f};
            registry.eachLive<Children>([&registry, this, &identity](Entity entity, Children& children) {
                if (registry.has<Transform>(entity) || registry.has<Parent>(entity) || !visitOnce(entity)) return;
                if (have_dirty_ && registry.has<TransformDirty>(entity)) dirty_to_clear_.push_back(entity);
                setFlatCollapsed(registry, entity, false);
                for (Entity child : children.entities) updateEntityTransform(registry, child, identity, true, false);
            });
        }

        for (Entity e : dirty_to_clear_) {
            if (registry.has<TransformDirty>(e)) {
                registry.remove<TransformDirty>(e);
            }
        }
    }

    void updateRootTransform(Registry& registry, Entity entity, Transform& transform, bool localDirty) {
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
        const bool collapsed = transform.scale.x == 0 || transform.scale.y == 0;
        setFlatCollapsed(registry, entity, collapsed);

        if (localDirty) {
            dirty_to_clear_.push_back(entity);
        }

        if (!have_children_) return;
        auto* children = registry.tryGet<Children>(entity);
        if (!children || children->entities.empty()) {
            // A root's cachedMatrix_ is only read to transform its children, and
            // with decomposed_ = true the renderer reads world TRS directly — so
            // for a childless root (the common 2D case) the compose is dead work.
            return;
        }

        transform.cachedMatrix_ = math::compose(transform.worldPosition, transform.worldRotation, transform.worldScale);
        visitOnce(entity);
        for (Entity child : children->entities) {
            updateEntityTransform(registry, child, transform.cachedMatrix_, true, collapsed);
        }
    }

    void updateEntityTransform(Registry& registry, Entity entity,
                               const glm::mat4& parentWorldMatrix, bool parentDirty, bool parentFlatCollapsed) {
        pending_.clear();
        TraversalTask task{entity, &parentWorldMatrix, parentDirty, parentFlatCollapsed};
        // Explicit DFS preserves child order without a depth limit or call-stack
        // growth. Per-composition stamps bound corrupt duplicate/cyclic links.
        for (;;) {
            auto* transform = registry.tryGet<Transform>(task.entity);
            if (registry.valid(task.entity) && visitOnce(task.entity)) {
                const bool localDirty = have_dirty_ && registry.has<TransformDirty>(task.entity);
                const bool dirty = task.parentDirty || localDirty;
                const bool keepStatic = transform && have_static_ && registry.has<TransformStatic>(task.entity) && !dirty;
                const glm::mat4* childMatrix = task.parentMatrix;
                bool flatCollapsed = task.parentFlatCollapsed;
                if (transform && !keepStatic) {
                    flatCollapsed = transform->scale.x == 0 || transform->scale.y == 0
                        || (task.parentFlatCollapsed && transform->rotation.x == 0 && transform->rotation.y == 0);
                    const auto matrix = *task.parentMatrix * math::compose(transform->position, transform->rotation, transform->scale);
                    if (changedOut_) ++visited_;
                    // Only a matrix that changed is decomposed again: the same matrix decomposes to the same world fields, and
                    // a still child of a model (most of a scene's meshes) was decomposed afresh by every view of every frame.
                    if (matrix != transform->cachedMatrix_) {
                        if (changedOut_) changedOut_->push_back(task.entity);
                        transform->cachedMatrix_ = matrix;
                        transform->decomposed_ = false;
                    }
                } else if (keepStatic) {
                    flatCollapsed = registry.has<FlatGeometryCollapsed>(task.entity);
                }
                setFlatCollapsed(registry, task.entity, flatCollapsed);
                if (localDirty) dirty_to_clear_.push_back(task.entity);
                if (transform) childMatrix = &transform->cachedMatrix_;
                if (auto* children = registry.tryGet<Children>(task.entity)) {
                    const auto& list = children->entities;
                    // Descend directly into the first child. Only siblings need a
                    // stack entry; long chains do no push/pop work per node.
                    for (usize i = list.size(); i > 1; --i) {
                        // Transform storage is stable throughout composition; borrow
                        // its cache rather than copying a matrix into every task.
                        pending_.push_back({list[i - 1], childMatrix, keepStatic ? false : dirty, flatCollapsed});
                    }
                    if (!list.empty()) {
                        task = {list[0], childMatrix, keepStatic ? false : dirty, flatCollapsed};
                        continue;
                    }
                }
            }
            if (pending_.empty()) break;
            task = pending_.back();
            pending_.pop_back();
        }
    }
};

inline bool isDescendantOf(Registry& registry, Entity entity, Entity ancestor) {
    usize remaining = registry.entityCount();
    while (registry.has<Parent>(entity)) {
        // Corrupt/deserialized cycles must not hang a hierarchy edit.
        if (remaining-- == 0) return true;
        Entity parent = registry.get<Parent>(entity).entity;
        if (parent == ancestor) return true;
        if (!registry.valid(parent)) break;
        entity = parent;
    }
    return false;
}

inline bool setParent(Registry& registry, Entity child, Entity newParent) {
    // SDK/scene documents use 0 for no entity; C++ uses UINT32_MAX. Index 0
    // is never allocated, so both null representations mean detachment.
    if (newParent.id() == 0) newParent = INVALID_ENTITY;
    if (registry.destructionPending(child) || registry.destructionPending(newParent)) return false;
    // Validate the entire proposed link BEFORE touching either half of the old
    // one. A rejected edit is a transaction with no observable changes.
    if (!registry.valid(child)) return false;
    if (newParent != INVALID_ENTITY &&
        (!registry.valid(newParent) || child == newParent || isDescendantOf(registry, newParent, child))) {
        return false;
    }
    const auto* current = registry.tryGet<Parent>(child);
    if ((current ? current->entity : INVALID_ENTITY) == newParent) return true;
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
        if (registry.has<Parent>(child)) {
            registry.get<Parent>(child).entity = newParent;
        } else {
            registry.emplace<Parent>(child, newParent);
        }

        if (!registry.has<Children>(newParent)) {
            registry.emplace<Children>(newParent);
        }
        auto& newChildren = registry.get<Children>(newParent).entities;
        // A childless root does not build a matrix. Its first child makes that
        // cache live, even when the parent has since been marked static.
        if (newChildren.empty() && registry.has<TransformStatic>(newParent)
            && !registry.has<TransformDirty>(newParent)) {
            registry.emplace<TransformDirty>(newParent);
        }
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
    registry.invalidateActivityHierarchy(child);
    return true;
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
    if (!registry.valid(entity) || registry.destructionPending(entity)) return;
    std::vector<Entity> owned, postorder;
    struct Reservations {
        Registry& registry;
        std::vector<Entity>& owned;
        ~Reservations() { for (Entity e : owned) registry.releaseDestruction(e); }
    } reservations{registry, owned};
    struct Frame { Entity entity; std::vector<Entity> children; usize next = 0; };
    std::vector<Frame> stack;
    const auto enter = [&](Entity e) {
        if (!registry.valid(e) || registry.destructionPending(e)) return;
        owned.push_back(e);
        if (!registry.reserveDestruction(e)) { owned.pop_back(); return; }
        auto children = registry.has<Children>(e) ? registry.get<Children>(e).entities : std::vector<Entity>{};
        stack.push_back({e, std::move(children), 0});
    };
    enter(entity);
    // Reserve once and preserve child-list postorder. A corrupt back-edge or
    // re-entrant subtree call joins an existing owner instead of recursing.
    while (!stack.empty()) {
        auto& frame = stack.back();
        if (frame.next < frame.children.size()) {
            const Entity child = frame.children[frame.next++];
            enter(child);
        } else {
            postorder.push_back(frame.entity);
            stack.pop_back();
        }
    }
    for (Entity e : postorder) {
        if (!registry.valid(e)) continue;
        if (registry.has<Parent>(e)) {
            const Entity parent = registry.get<Parent>(e).entity;
            if (registry.valid(parent) && registry.has<Children>(parent)) {
                auto& children = registry.get<Children>(parent).entities;
                const auto it = std::find(children.begin(), children.end(), e);
                if (it != children.end()) { *it = children.back(); children.pop_back(); }
            }
        }
        registry.destroy(e);
    }
}

}  // namespace esengine::ecs
