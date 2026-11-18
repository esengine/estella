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
#include "TransformEpoch.hpp"
#include "components/Transform.hpp"
#include "components/Hierarchy.hpp"
#include "FlatGeometry.hpp"
#include "../math/Math.hpp"

#include <algorithm>

namespace esengine::ecs {

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
     * @details Once more entities have changed than there are Transforms, reading
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
    /** What a tree entity hands its children in the cascade walk: the matrix they compose under, and how. */
    struct Slot {
        const glm::mat4* matrix;
        bool dirty;
        bool flatCollapsed;
    };
    std::vector<Slot> slots_;
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

    /**
     * @brief One composition, whoever asked for it
     * @details The serial advances here and nowhere else, so "a composition ran"
     *          and "the changed set describes it" cannot come apart — a caller
     *          that composed through update() would otherwise move the serial
     *          past a set nobody collected.
     */
    void compose(Registry& registry) {
        visited_ = 0;
        if (tracking_ && !overflowed_) changedOut_ = &changed_;
        updateDirtyTransforms(registry);
        changedOut_ = nullptr;
        // Past the point where replaying the list beats re-reading the world: more entries than there are Transforms to read.
        if (changed_.size() > registry.countOf<Transform>()) {
            changed_.clear();
            overflowed_ = true;
        }
        ++serial_;
        markComposed(registry);
    }

    // What the last composition saw, to tell what has changed since: the registry, the tick it read up to (its own world-matrix
    // stamps included), the Transform pool's version (a removal moves it) and whether it composed in full at all.
    u64 seenRegistry_ = 0;
    u32 seenTick_ = 0;
    u32 seenTransformVersion_ = 0;
    u32 seenUnstampedEpoch_ = 0;
    std::vector<Entity> retargeted_;
    std::vector<std::pair<u32, u32>> changedSlots_;

    /**
     * @brief Composes the Transforms stamped or tagged dirty since the last composition, and the subtrees under them
     * @details Every writer of a local transform stamps it (census-transform-writers holds them to it). Everything is composed
     *          when the stamps cannot be relied on: first time, another registry, a Transform removed, a changed hierarchy,
     *          and while the change audit runs, which exists to find a write that did not stamp.
     */
    void updateDirtyTransforms(Registry& registry) {
        dirty_to_clear_.clear();
        have_dirty_ = !registry.entitiesWith<TransformDirty>().empty();
        have_static_ = !registry.entitiesWith<TransformStatic>().empty();
        auto& rel = registry.childOf();
        have_children_ = rel.linkCount() != 0;
        have_collapsed_ = !registry.entitiesWith<FlatGeometryCollapsed>().empty();

        // A reparent is not a reason to compose everything: the entities that moved are listed, and their subtrees recompose.
        const bool retargetsListed = rel.takeRetargeted(retargeted_);
        const bool full = seenRegistry_ != registry.identity() || seenTick_ == 0 || !retargetsListed
            || seenTransformVersion_ != registry.poolVersion<Transform>()
            || seenUnstampedEpoch_ != transformUnstampedEpoch() || registry.changeAuditEnabled();
        if (full) composeAll(registry);
        else composeChanged(registry);

        for (Entity e : dirty_to_clear_) {
            if (registry.has<TransformDirty>(e)) {
                registry.remove<TransformDirty>(e);
            }
        }
        // After its own stamps: what this composition wrote is not a change the next one has to recompose.
        seenRegistry_ = registry.identity();
        seenTick_ = registry.beginChangeRead();
        if (seenTick_ == 0) seenTick_ = registry.beginChangeRead();
        seenTransformVersion_ = registry.poolVersion<Transform>();
        seenUnstampedEpoch_ = transformUnstampedEpoch();
    }

    bool inTree(const ExclusiveRelation& rel, Entity entity) const {
        return have_children_ && (rel.hasTarget(entity) || rel.hasSources(entity));
    }

    /** @brief Everything: the entities in no tree from the Transform pool, then every tree in cascade order. */
    void composeAll(Registry& registry) {
        const auto& rel = registry.childOf();
        // eachLive (no per-frame snapshot copy of the entity list): the callback
        // writes Transform fields and derived collapse tags, while deferring
        // TransformDirty removal; the Transform pool itself stays stable.
        if (plainRoots()) {
            registry.eachLive<Transform>([&registry, &rel, this](Entity entity, Transform& transform) {
                if (!inTree(rel, entity)) copyRoot(registry, entity, transform);
            });
        } else {
            registry.eachLive<Transform>([&registry, &rel, this](Entity entity, Transform& transform) {
                if (inTree(rel, entity)) return;
                const bool isStatic = have_static_ && registry.has<TransformStatic>(entity);
                const bool isDirty = have_dirty_ && registry.has<TransformDirty>(entity);
                if (isStatic && !isDirty) return;
                updateRootTransform(registry, entity, transform, isDirty);
            });
        }
        if (!have_children_) return;
        for (const auto& tree : rel.cascade()) {
            if (!tree.alive) continue;
            slots_.resize(tree.entries.size());
            for (u32 i = 0, n = static_cast<u32>(tree.entries.size()); i < n; ++i) composeEntry(registry, tree.entries, i);
        }
    }

    /** @brief Only what was written or tagged dirty since the last composition, and the subtrees under it. */
    void composeChanged(Registry& registry) {
        const auto& rel = registry.childOf();
        const auto& trees = have_children_ ? rel.cascade() : emptyCascade();
        changedSlots_.clear();

        // A static entity is recomposed only when tagged dirty, as the full walk does: a write to it is not one.
        const auto changed = [&](Entity entity, bool tagged, Transform* transform) {
            if (!tagged && have_static_ && registry.has<TransformStatic>(entity)) return;
            if (inTree(rel, entity)) {
                const auto at = rel.cascadeAt(entity);
                changedSlots_.emplace_back(at.tree, at.slot);
                return;
            }
            if (!transform) {
                if (tagged) dirty_to_clear_.push_back(entity);
                return;
            }
            updateRootTransform(registry, entity, *transform, tagged);
        };
        // Down the pool's own arrays: the written Transform is in hand, with no lookup for it.
        if (plainRoots()) {
            registry.eachChangedSince<Transform>(seenTick_, [&](Entity entity, Transform& transform) {
                if (!inTree(rel, entity)) { copyRoot(registry, entity, transform); return; }
                const auto at = rel.cascadeAt(entity);
                changedSlots_.emplace_back(at.tree, at.slot);
            });
        } else {
            registry.eachChangedSince<Transform>(seenTick_, [&](Entity entity, Transform& transform) {
                changed(entity, have_dirty_ && registry.has<TransformDirty>(entity), &transform);
            });
        }
        // Moved under another parent, detached, or left a root by a destroyed parent: composed under a new matrix whatever its
        // own stamp says, and a static one too.
        for (const Entity entity : retargeted_) {
            if (registry.valid(entity)) changed(entity, true, registry.tryGet<Transform>(entity));
        }
        if (have_dirty_) {
            for (const Entity entity : registry.entitiesWith<TransformDirty>()) {
                // Written and tagged was handled above, with its tag.
                if (!registry.changedSince<Transform>(entity, seenTick_)) changed(entity, true, registry.tryGet<Transform>(entity));
            }
        }
        if (changedSlots_.empty()) return;

        // Ranges in cascade order, tree by tree: one inside a range already recomposed is part of it.
        std::sort(changedSlots_.begin(), changedSlots_.end());
        u32 tree = ExclusiveRelation::NONE, covered = 0;
        for (const auto [t, start] : changedSlots_) {
            const auto& order = trees[t].entries;
            if (t != tree) { tree = t; covered = 0; slots_.resize(order.size()); }
            if (start < covered) continue;
            const u32 parent = order[start].parent;
            if (parent != ExclusiveRelation::NONE) slots_[parent] = contextOf(registry, order, parent);
            for (u32 i = start, end = order[start].end; i < end; ++i) composeEntry(registry, order, i);
            covered = order[start].end;
        }
    }

    static const std::vector<ExclusiveRelation::CascadeTree>& emptyCascade() {
        static const std::vector<ExclusiveRelation::CascadeTree> none;
        return none;
    }

    /**
     * @brief What the entity at @p slot hands its children, worked out without recomposing it
     * @details Down the chain from its tree's root, by the same rules composeEntry applies, reading what each one already
     *          holds: the dirty flag a static descendant obeys, the collapse a flat child inherits, and the matrix — the nearest
     *          Transform's cached one, which is current, since nothing on the chain changed.
     */
    Slot contextOf(Registry& registry, const std::vector<ExclusiveRelation::CascadeEntry>& order, u32 slot) {
        static const glm::mat4 identity{1.0f};
        chain_.clear();
        for (u32 at = slot; at != ExclusiveRelation::NONE; at = order[at].parent) chain_.push_back(at);
        Slot context{&identity, true, false};
        for (usize k = chain_.size(); k-- > 0;) {
            const Entity entity = order[chain_[k]].entity;
            auto* transform = registry.tryGet<Transform>(entity);
            const bool localDirty = have_dirty_ && registry.has<TransformDirty>(entity);
            const bool collapsedTag = have_collapsed_ && registry.has<FlatGeometryCollapsed>(entity);
            if (k + 1 == chain_.size()) {
                // The root of the tree.
                if (!transform) context = {&identity, true, false};
                else if (have_static_ && !localDirty && registry.has<TransformStatic>(entity)) context = {&transform->cachedMatrix_, false, collapsedTag};
                else {
                    // A root that just took its first child has never built the matrix (a childless root does not need one).
                    transform->cachedMatrix_ = math::compose(transform->position, transform->rotation, transform->scale);
                    context = {&transform->cachedMatrix_, true, transform->scale.x == 0 || transform->scale.y == 0};
                }
                continue;
            }
            const bool dirty = context.dirty || localDirty;
            const bool keepStatic = transform && have_static_ && !dirty && registry.has<TransformStatic>(entity);
            // Its collapse tag is what composeEntry derived for it last time, from inputs that have not changed since.
            context = {transform ? &transform->cachedMatrix_ : context.matrix, keepStatic ? false : dirty, collapsedTag};
        }
        return context;
    }
    std::vector<u32> chain_;

    /**
     * @brief Whether a root needs nothing but its copy: no static Transform to leave alone, no dirty tag to clear, no change
     *        list to feed. The usual frame; each entity then costs what copying it costs, and not the branches around it.
     */
    bool plainRoots() const { return !have_static_ && !have_dirty_ && !changedOut_; }

    /** @brief updateRootTransform for a plainRoots() frame. */
    void copyRoot(Registry& registry, Entity entity, Transform& transform) {
        transform.worldPosition = transform.position;
        transform.worldRotation = transform.rotation;
        transform.worldScale = transform.scale;
        transform.decomposed_ = true;
        const bool collapsed = transform.scale.x == 0 || transform.scale.y == 0;
        if (collapsed || have_collapsed_) setFlatCollapsed(registry, entity, collapsed);
    }

    /** @brief A root's world transform is its local one: copied, never composed from a matrix. */
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
        setFlatCollapsed(registry, entity, transform.scale.x == 0 || transform.scale.y == 0);
        if (localDirty) dirty_to_clear_.push_back(entity);
    }

    /** @brief Composes the entity at @p i of the cascade, whose parent's slot is already written. */
    void composeEntry(Registry& registry, const std::vector<ExclusiveRelation::CascadeEntry>& order, u32 i) {
        static const glm::mat4 identity{1.0f};
        const Entity entity = order[i].entity;
        auto* transform = registry.tryGet<Transform>(entity);
        const bool localDirty = have_dirty_ && registry.has<TransformDirty>(entity);

        if (order[i].parent == ExclusiveRelation::NONE) {
            // The root of a tree.
            if (!transform) {
                // A parent with no Transform of its own (a folder of entities): its children compose against identity.
                if (localDirty) dirty_to_clear_.push_back(entity);
                setFlatCollapsed(registry, entity, false);
                slots_[i] = {&identity, true, false};
            } else if (have_static_ && !localDirty && registry.has<TransformStatic>(entity)) {
                // A static root keeps the matrix it had; its children are recomposed only where they are dirty.
                slots_[i] = {&transform->cachedMatrix_, false, registry.has<FlatGeometryCollapsed>(entity)};
            } else {
                updateRootTransform(registry, entity, *transform, localDirty);
                // A root's cachedMatrix_ is only read to transform its children, so only a root with children builds it.
                transform->cachedMatrix_ = math::compose(transform->worldPosition, transform->worldRotation, transform->worldScale);
                slots_[i] = {&transform->cachedMatrix_, true, transform->scale.x == 0 || transform->scale.y == 0};
            }
            return;
        }

        const Slot parent = slots_[order[i].parent];
        const bool dirty = parent.dirty || localDirty;
        const bool keepStatic = transform && have_static_ && !dirty && registry.has<TransformStatic>(entity);
        bool flatCollapsed = parent.flatCollapsed;
        if (transform && !keepStatic) {
            flatCollapsed = transform->scale.x == 0 || transform->scale.y == 0
                || (parent.flatCollapsed && transform->rotation.x == 0 && transform->rotation.y == 0);
            const auto matrix = *parent.matrix * math::compose(transform->position, transform->rotation, transform->scale);
            if (changedOut_) ++visited_;
            // Only a matrix that changed is decomposed again: the same matrix decomposes to the same world fields, and
            // a still child of a model (most of a scene's meshes) was decomposed afresh by every view of every frame.
            if (matrix != transform->cachedMatrix_) {
                if (changedOut_) changedOut_->push_back(entity);
                transform->cachedMatrix_ = matrix;
                transform->decomposed_ = false;
                // Where it stands in the world changed (its own move or a parent's): a reader of Transform changes sees it.
                registry.markChanged<Transform>(entity);
            }
        } else if (keepStatic) {
            flatCollapsed = registry.has<FlatGeometryCollapsed>(entity);
        }
        setFlatCollapsed(registry, entity, flatCollapsed);
        if (localDirty) dirty_to_clear_.push_back(entity);
        // An entity with no Transform passes its parent's matrix through to its children. Transform storage is stable
        // throughout composition, so a slot borrows the cached matrix rather than copying it.
        slots_[i] = {transform ? &transform->cachedMatrix_ : parent.matrix, keepStatic ? false : dirty, flatCollapsed};
    }
};

inline bool isDescendantOf(Registry& registry, Entity entity, Entity ancestor) {
    return registry.childOf().isDescendantOf(entity, ancestor);
}

/**
 * @brief Writes the Parent and Children components from the ChildOf relation, for @p entity and the parents it left and joined
 * @details The relation is the hierarchy; these components are its copy for whoever reads components rather than the relation
 *          (scripts, scene files, the editor). Children lists the children in the relation's order, so a sibling removed from
 *          the middle no longer reorders the rest.
 */
inline void syncHierarchyComponents(Registry& registry, Entity entity, Entity oldParent, Entity newParent) {
    const auto& rel = registry.childOf();
    if (!entity.isValid()) {
    } else if (newParent.isValid()) {
        if (auto* parent = registry.tryGet<Parent>(entity)) {
            if (parent->entity != newParent) registry.patch<Parent>(entity).entity = newParent;
        } else {
            registry.emplace<Parent>(entity, newParent);
        }
    } else if (registry.has<Parent>(entity)) {
        registry.remove<Parent>(entity);
    }
    for (const Entity owner : {oldParent, newParent}) {
        if (!owner.isValid() || !registry.valid(owner)) continue;
        if (!registry.has<Children>(owner)) {
            if (!rel.hasSources(owner)) continue;
            registry.emplace<Children>(owner);
        }
        auto list = rel.sources(owner);
        if (registry.get<Children>(owner).entities != list) registry.patch<Children>(owner).entities = std::move(list);
    }
}

inline bool setParent(Registry& registry, Entity child, Entity newParent) {
    // SDK/scene documents use 0 for no entity; C++ uses UINT32_MAX. Index 0
    // is never allocated, so both null representations mean detachment.
    if (newParent.id() == 0) newParent = INVALID_ENTITY;
    if (registry.destructionPending(child) || registry.destructionPending(newParent)) return false;
    // Validate the entire proposed link BEFORE touching either half of the old
    // one. A rejected edit is a transaction with no observable changes.
    if (!registry.valid(child)) return false;
    auto& rel = registry.childOf();
    if (newParent != INVALID_ENTITY &&
        (!registry.valid(newParent) || child == newParent || rel.isDescendantOf(newParent, child))) {
        return false;
    }
    const Entity oldParent = rel.target(child);
    // The components can disagree with the relation only where the parent was destroyed under the child: the relation made
    // the child a root, while its Parent still names the dead entity. Detaching such a child is still an edit, of the component.
    const bool stale = !newParent.isValid() && !oldParent.isValid() && registry.has<Parent>(child);
    if (oldParent == newParent && !stale) return true;

    if (newParent.isValid()) rel.link(child, newParent); else rel.unlink(child);
    syncHierarchyComponents(registry, child, oldParent, newParent);

    if (newParent.isValid()) {
        // A childless root does not build a matrix. Its first child makes that
        // cache live, even when the parent has since been marked static.
        if (rel.count(newParent) == 1 && registry.has<TransformStatic>(newParent)
            && !registry.has<TransformDirty>(newParent)) {
            registry.emplace<TransformDirty>(newParent);
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
 * @details One order reaches both readers of it: component storage (the renderer's painter order) and each parent's children
 *          (UI layout and draw order), as a reload would. Entities left out keep their relative order, after the listed ones.
 */
inline void applySceneEntityOrder(Registry& registry, const Entity* order, usize count) {
    if (!order || count == 0) return;
    const std::vector<u32> rank = registry.buildEntityRank(order, count);
    registry.applyEntityRank(rank);

    auto& rel = registry.childOf();
    std::vector<Entity> parents;
    registry.eachLive<Children>([&parents](Entity entity, Children&) { parents.push_back(entity); });
    for (const Entity parent : parents) {
        if (rel.sortSources(parent, rank)) syncHierarchyComponents(registry, INVALID_ENTITY, INVALID_ENTITY, parent);
    }
    invalidateTransformComposition();
}

inline Entity getRoot(Registry& registry, Entity entity) {
    return registry.childOf().root(entity);
}

inline void destroyWithChildren(Registry& registry, Entity entity) {
    if (!registry.valid(entity) || registry.destructionPending(entity)) return;
    const auto& rel = registry.childOf();
    std::vector<Entity> owned, postorder;
    struct Reservations {
        Registry& registry;
        std::vector<Entity>& owned;
        ~Reservations() { for (Entity e : owned) registry.releaseDestruction(e); }
    } reservations{registry, owned};
    // Reserve the whole subtree before destroying any of it, in postorder (children before their parent, in child order):
    // an onDestroy callback that destroys part of it again joins the reservation rather than recursing.
    struct Frame { Entity entity; Entity next; };
    std::vector<Frame> stack;
    const auto enter = [&](Entity e) {
        if (!registry.valid(e) || registry.destructionPending(e)) return;
        owned.push_back(e);
        if (!registry.reserveDestruction(e)) { owned.pop_back(); return; }
        stack.push_back({e, rel.first(e)});
    };
    enter(entity);
    while (!stack.empty()) {
        auto& frame = stack.back();
        if (frame.next.isValid()) {
            const Entity child = frame.next;
            frame.next = rel.next(child);
            enter(child);
        } else {
            postorder.push_back(frame.entity);
            stack.pop_back();
        }
    }
    for (Entity e : postorder) {
        if (!registry.valid(e)) continue;
        const Entity parent = rel.target(e);
        registry.destroy(e);
        if (parent.isValid() && registry.valid(parent) && registry.has<Children>(parent)) {
            auto& children = registry.get<Children>(parent).entities;
            const auto it = std::find(children.begin(), children.end(), e);
            if (it != children.end()) children.erase(it);
        }
    }
}

}  // namespace esengine::ecs
