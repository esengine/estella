// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Relation.hpp
 * @brief   A relationship between entities, stored as one: (Relation, target) pairs in the manner of Flecs
 * @details An exclusive relation gives an entity at most one target (ChildOf: one parent). It is kept in flat arrays indexed
 *          by entity index, struct of arrays, rather than as a component holding a list:
 *
 *            target   the entity's one target, or none
 *            first    the first entity that names this one as its target (its first child)
 *            last     the last such entity
 *            next     the next entity with the same target (the next sibling)
 *            prev     the previous one
 *            count    how many entities name this one
 *            depth    how many links lie between the entity and the root of its tree
 *
 *          Every edit is O(1) and allocates nothing once the arrays have grown to the entity count: linking, unlinking, and
 *          moving an entity within its siblings touch a constant number of slots. A walk over an entity's sources (its
 *          children) follows `next` through one array. The arrays are plain u32 in linear memory, so a script can read them
 *          where they lie instead of asking for a copy.
 *
 *          Flecs stores a pair as part of an archetype's type, which suits its table storage; this engine stores components
 *          in sparse sets, where the answer to "the sources of this target, in order" is an intrusive list, and the answer to
 *          "this entity's target" is one array read.
 *
 *          A slot belongs to whichever entity holds that index now: the registry clears an entity's slots when it destroys
 *          the entity (onDestroy), so no slot outlives its entity and none needs a generation check on read.
 */
#pragma once

#include "../core/Types.hpp"

#include <algorithm>
#include <vector>

namespace esengine::ecs {

class ExclusiveRelation {
public:
    static constexpr u32 NONE = Entity::INVALID_RAW;

    /** @brief The entity's target (its parent), or INVALID_ENTITY. */
    Entity target(Entity source) const { return Entity::fromRaw(read(target_, source)); }
    bool hasTarget(Entity source) const { return read(target_, source) != NONE; }
    /** @brief The first / last entity naming @p target (first and last child), or INVALID_ENTITY. */
    Entity first(Entity target) const { return Entity::fromRaw(read(first_, target)); }
    Entity last(Entity target) const { return Entity::fromRaw(read(last_, target)); }
    /** @brief The entity after / before @p source among those naming the same target (siblings), or INVALID_ENTITY. */
    Entity next(Entity source) const { return Entity::fromRaw(read(next_, source)); }
    Entity prev(Entity source) const { return Entity::fromRaw(read(prev_, source)); }
    /** @brief How many entities name @p target. */
    u32 count(Entity target) const { return target.index() < count_.size() ? count_[target.index()] : 0; }
    bool hasSources(Entity target) const { return count(target) != 0; }
    /** @brief Links between @p entity and the root of its tree: 0 for a root. */
    u32 depth(Entity entity) const { return entity.index() < depth_.size() ? depth_[entity.index()] : 0; }
    /** @brief How many entities have a target: the size of (Relation, *). */
    u32 linkCount() const { return links_; }
    /** @brief Bumped by every edit to the relation's shape, so a cache built from it can tell it is stale. */
    u32 epoch() const { return epoch_; }

    /** @brief Calls @p visit(source) for each entity naming @p target, in order. @p visit must not edit the relation. */
    template<typename Visit>
    void eachSource(Entity target, Visit&& visit) const {
        for (u32 at = read(first_, target); at != NONE; at = next_[Entity::fromRaw(at).index()]) {
            visit(Entity::fromRaw(at));
        }
    }

    /** @brief The entities naming @p target, in order: for a caller that edits the relation while it walks them. */
    std::vector<Entity> sources(Entity target) const {
        std::vector<Entity> out;
        out.reserve(count(target));
        eachSource(target, [&out](Entity e) { out.push_back(e); });
        return out;
    }

    /** @brief Whether @p ancestor is @p entity's target, or its target's, and so on up. Bounded: no cycle can form here. */
    bool isDescendantOf(Entity entity, Entity ancestor) const {
        for (u32 at = read(target_, entity); at != NONE; at = read(target_, Entity::fromRaw(at))) {
            if (at == ancestor.raw) return true;
        }
        return false;
    }

    /** @brief The top of @p entity's tree (itself when it has no target). */
    Entity root(Entity entity) const {
        while (hasTarget(entity)) entity = target(entity);
        return entity;
    }

    /**
     * @brief Gives @p source the target @p target, placed before @p before among its sources (last when @p before is none)
     * @details The caller has checked the edit: both are live, @p source is not @p target or one of its ancestors. A source
     *          with a target already is moved, keeping nothing of where it was. Depth follows for the whole moved subtree.
     */
    void link(Entity source, Entity target, Entity before = INVALID_ENTITY) {
        markTree(source);
        if (hasTarget(source)) detach(source);
        grow(std::max(source.index(), target.index()));
        const u32 s = source.index(), t = target.index();
        if (before.isValid() && read(target_, before) == target.raw) {
            const u32 b = before.index();
            const u32 p = prev_[b];
            prev_[s] = p;
            next_[s] = before.raw;
            prev_[b] = source.raw;
            if (p == NONE) first_[t] = source.raw; else next_[Entity::fromRaw(p).index()] = source.raw;
        } else {
            const u32 l = last_[t];
            prev_[s] = l;
            next_[s] = NONE;
            if (l == NONE) first_[t] = source.raw; else next_[Entity::fromRaw(l).index()] = source.raw;
            last_[t] = source.raw;
        }
        target_[s] = target.raw;
        ++count_[t];
        ++links_;
        setSubtreeDepth(source, depth_[t] + 1);
        noteRetargeted(source.raw);
        markTree(target);
        ++epoch_;
    }

    /** @brief Takes @p source's target away; its own sources stay with it. */
    void unlink(Entity source) {
        if (!hasTarget(source)) return;
        markTree(source);
        detach(source);
        setSubtreeDepth(source, 0);
        noteRetargeted(source.raw);
        markTree(source);
        ++epoch_;
    }

    /**
     * @brief Puts @p target's sources in the order of @p rank (per entity index, lower first; stable; past the end last)
     * @return Whether the order changed.
     */
    bool sortSources(Entity target, const std::vector<u32>& rank) {
        if (count(target) <= 1) return false;
        scratch_ = sources(target);
        const auto rankOf = [&rank](Entity e) { return e.index() < rank.size() ? rank[e.index()] : NONE; };
        if (std::is_sorted(scratch_.begin(), scratch_.end(), [&](Entity a, Entity b) { return rankOf(a) < rankOf(b); })) return false;
        std::stable_sort(scratch_.begin(), scratch_.end(), [&](Entity a, Entity b) { return rankOf(a) < rankOf(b); });
        const u32 t = target.index();
        u32 prev = NONE;
        for (const Entity e : scratch_) {
            prev_[e.index()] = prev;
            if (prev == NONE) first_[t] = e.raw; else next_[Entity::fromRaw(prev).index()] = e.raw;
            prev = e.raw;
        }
        next_[Entity::fromRaw(prev).index()] = NONE;
        last_[t] = prev;
        markTree(target);
        ++epoch_;
        return true;
    }

    /**
     * @brief Forgets @p entity, which is being destroyed: it leaves its target, and its sources become roots
     * @details Called by the registry for every destroyed entity, so a slot never outlives the entity that owned it. Removing
     *          the sources is this relation's policy for a destroyed target; a caller that wants them gone as well
     *          (destroyWithChildren) destroys them first.
     */
    void onDestroy(Entity entity) {
        const u32 i = entity.index();
        if (i >= target_.size()) return;
        if (target_[i] != NONE || first_[i] != NONE) markTree(entity);
        bool changed = false;
        if (target_[i] != NONE) { detach(entity); changed = true; }
        for (u32 at = first_[i]; at != NONE;) {
            const u32 c = Entity::fromRaw(at).index();
            const u32 following = next_[c];
            target_[c] = prev_[c] = next_[c] = NONE;
            --links_;
            setSubtreeDepth(Entity::fromRaw(at), 0);
            noteRetargeted(at);
            markTree(Entity::fromRaw(at));
            at = following;
            changed = true;
        }
        first_[i] = last_[i] = NONE;
        count_[i] = 0;
        depth_[i] = 0;
        if (changed) ++epoch_;
    }

    void clear() {
        target_.clear(); first_.clear(); last_.clear(); next_.clear(); prev_.clear(); count_.clear(); depth_.clear();
        links_ = 0;
        retargeted_.clear();
        retargetedOverflow_ = true;
        all_dirty_ = true;
        dirty_roots_.clear();
        ++epoch_;
    }

    /**
     * @brief Hands over the entities whose target changed since the last call (moved, detached, orphaned by a destroyed
     *        target), and empties the list. One reader: whoever takes it, takes it for everyone.
     * @return false when the list overflowed (or the relation was cleared): too many to list, so the reader treats all as moved.
     */
    bool takeRetargeted(std::vector<Entity>& out) {
        out.clear();
        const bool listed = !retargetedOverflow_;
        if (listed) for (const u32 raw : retargeted_) out.push_back(Entity::fromRaw(raw));
        retargeted_.clear();
        retargetedOverflow_ = false;
        return listed;
    }

    /** @brief One entity of a tree, in cascade order. */
    struct CascadeEntry {
        Entity entity;
        /** Where its target sits in the same tree's array; NONE for the root of the tree. */
        u32 parent;
        /** One past its last descendant: its subtree is [this entry, end), contiguous, as preorder lays it out. */
        u32 end;
    };

    /** @brief One tree, root first, every entity after its target and in its siblings' order (preorder). */
    struct CascadeTree {
        Entity root;
        std::vector<CascadeEntry> entries;
        /** False for a slot whose tree is gone, kept so the other trees' numbers do not move; reused by the next new tree. */
        bool alive = false;
    };

    /** @brief Where an entity sits in the cascade: which tree, and where in it. */
    struct CascadeAt {
        u32 tree;
        u32 slot;
    };

    /**
     * @brief Every tree of the relation, each in cascade order: Flecs' cascade, one array per tree
     * @details A walk from the front of a tree sees a parent before any of its children, so a caller that needs the parent's
     *          result reads it by `parent` from what it wrote earlier in the same walk. Kept per tree so an edit rebuilds only
     *          the trees it touched (the one an entity left and the one it joined), in O(their size), not every tree.
     *          Skip the entries whose tree is not alive. Only entities in a tree are listed: a root with no sources is not.
     */
    const std::vector<CascadeTree>& cascade() const {
        refreshCascade();
        return trees_;
    }

    /** @brief Where @p entity sits in cascade(), or tree NONE when it is in no tree. Current as of the last cascade() call. */
    CascadeAt cascadeAt(Entity entity) const {
        const u32 i = entity.index();
        if (i >= tree_of_.size() || tree_of_[i] == NONE) return {NONE, NONE};
        return {tree_of_[i], slot_of_[i]};
    }

    /** @brief The arrays themselves, for a reader across the wasm boundary; valid until the next edit that grows them. */
    const u32* targets() const { return target_.data(); }
    const u32* firsts() const { return first_.data(); }
    const u32* nexts() const { return next_.data(); }
    usize capacity() const { return target_.size(); }

private:
    std::vector<u32> target_, first_, last_, next_, prev_, count_, depth_;
    std::vector<Entity> scratch_;
    std::vector<u32> walk_;
    u32 links_ = 0;
    u32 epoch_ = 1;
    /** Entities whose target changed since the last takeRetargeted; past the cap it stops listing and says so. */
    std::vector<u32> retargeted_;
    bool retargetedOverflow_ = false;
    static constexpr usize RETARGETED_CAP = 4096;

    void noteRetargeted(u32 raw) {
        if (retargetedOverflow_) return;
        if (retargeted_.size() >= RETARGETED_CAP) { retargeted_.clear(); retargetedOverflow_ = true; return; }
        retargeted_.push_back(raw);
    }

    mutable std::vector<CascadeTree> trees_;
    mutable std::vector<u32> free_trees_;
    /** Per entity index: its tree and its slot there, NONE when it is in no tree. */
    mutable std::vector<u32> tree_of_, slot_of_;
    /** Roots whose tree an edit may have changed, created or ended since the cascade was last refreshed. */
    mutable std::vector<u32> dirty_roots_;
    mutable bool all_dirty_ = true;
    mutable std::vector<std::pair<u32, u32>> pending_;
    static constexpr usize DIRTY_ROOTS_CAP = 1024;

    /** @brief The tree around @p entity changed shape, or it began or ended one. */
    void markTree(Entity entity) {
        if (all_dirty_ || !entity.isValid()) return;
        if (dirty_roots_.size() >= DIRTY_ROOTS_CAP) { all_dirty_ = true; dirty_roots_.clear(); return; }
        dirty_roots_.push_back(root(entity).raw);
    }

    /** @brief The entity at @p index if it is the root of a tree now (no target, some sources), else NONE. */
    u32 rootAt(u32 index) const {
        if (index >= target_.size() || target_[index] != NONE || first_[index] == NONE) return NONE;
        // A root's own id is not stored at its slot; its first child names it.
        return target_[Entity::fromRaw(first_[index]).index()];
    }

    void refreshCascade() const {
        if (all_dirty_) {
            for (auto& tree : trees_) for (const auto& e : tree.entries) forget(e.entity);
            trees_.clear();
            free_trees_.clear();
            tree_of_.assign(target_.size(), NONE);
            slot_of_.assign(target_.size(), NONE);
            for (u32 i = 0, n = static_cast<u32>(target_.size()); i < n; ++i) {
                const u32 r = rootAt(i);
                if (r != NONE) buildTree(Entity::fromRaw(r));
            }
            all_dirty_ = false;
            dirty_roots_.clear();
            return;
        }
        if (dirty_roots_.empty()) return;
        if (tree_of_.size() < target_.size()) {
            tree_of_.resize(target_.size(), NONE);
            slot_of_.resize(target_.size(), NONE);
        }
        std::sort(dirty_roots_.begin(), dirty_roots_.end());
        dirty_roots_.erase(std::unique(dirty_roots_.begin(), dirty_roots_.end()), dirty_roots_.end());
        // First every touched tree lets go of its entities, then the trees that still have a root are built again: an entity
        // that moved from one touched tree to another ends up in the one built last only if no clearing comes after it.
        for (const u32 raw : dirty_roots_) {
            const u32 t = treeRootedAt(Entity::fromRaw(raw));
            if (t == NONE) continue;
            for (const auto& e : trees_[t].entries) forget(e.entity);
            trees_[t].entries.clear();
            trees_[t].alive = false;
            free_trees_.push_back(t);
        }
        for (const u32 raw : dirty_roots_) {
            const u32 i = Entity::fromRaw(raw).index();
            if (rootAt(i) == raw) buildTree(Entity::fromRaw(raw));
        }
        dirty_roots_.clear();
    }

    /** @brief The tree whose root is @p root, or NONE. */
    u32 treeRootedAt(Entity root) const {
        const u32 i = root.index();
        if (i >= tree_of_.size() || tree_of_[i] == NONE || slot_of_[i] != 0) return NONE;
        const u32 t = tree_of_[i];
        return trees_[t].alive && trees_[t].root == root ? t : NONE;
    }

    void forget(Entity entity) const {
        const u32 i = entity.index();
        if (i < tree_of_.size()) tree_of_[i] = slot_of_[i] = NONE;
    }

    void buildTree(Entity root) const {
        u32 t;
        if (!free_trees_.empty()) { t = free_trees_.back(); free_trees_.pop_back(); }
        else { t = static_cast<u32>(trees_.size()); trees_.emplace_back(); }
        auto& tree = trees_[t];
        tree.root = root;
        tree.alive = true;
        auto& out = tree.entries;
        out.clear();
        out.push_back({root, NONE, 0});
        pushSources(root.index(), 0);
        while (!pending_.empty()) {
            const auto [raw, parent] = pending_.back();
            pending_.pop_back();
            out.push_back({Entity::fromRaw(raw), parent, 0});
            pushSources(Entity::fromRaw(raw).index(), static_cast<u32>(out.size() - 1));
        }
        // Each entry's subtree ends where its last descendant's does: walked back to front, a child has its end before its
        // parent takes the larger of the two.
        const u32 n = static_cast<u32>(out.size());
        for (u32 i = 0; i < n; ++i) {
            out[i].end = i + 1;
            const u32 e = out[i].entity.index();
            if (e >= tree_of_.size()) { tree_of_.resize(e + 1, NONE); slot_of_.resize(e + 1, NONE); }
            tree_of_[e] = t;
            slot_of_[e] = i;
        }
        for (u32 i = n; i-- > 0;) {
            const u32 p = out[i].parent;
            if (p != NONE && out[i].end > out[p].end) out[p].end = out[i].end;
        }
    }

    /** @brief Queues the sources of the entity at @p index, last first so they leave the stack in order. */
    void pushSources(u32 index, u32 slot) const {
        for (u32 at = last_[index]; at != NONE; at = prev_[Entity::fromRaw(at).index()]) pending_.emplace_back(at, slot);
    }

    static u32 read(const std::vector<u32>& slots, Entity entity) {
        const u32 i = entity.index();
        return i < slots.size() ? slots[i] : NONE;
    }

    void grow(u32 index) {
        if (index < target_.size()) return;
        // Doubling: an entity count that grows one at a time costs amortised O(1) per link.
        const usize size = std::max<usize>(static_cast<usize>(index) + 1, target_.size() * 2);
        target_.resize(size, NONE); first_.resize(size, NONE); last_.resize(size, NONE);
        next_.resize(size, NONE); prev_.resize(size, NONE); count_.resize(size, 0); depth_.resize(size, 0);
    }

    /** @brief Takes @p source out of its target's list; its depth is the caller's. */
    void detach(Entity source) {
        const u32 s = source.index();
        const u32 t = Entity::fromRaw(target_[s]).index();
        const u32 p = prev_[s], n = next_[s];
        if (p == NONE) first_[t] = n; else next_[Entity::fromRaw(p).index()] = n;
        if (n == NONE) last_[t] = p; else prev_[Entity::fromRaw(n).index()] = p;
        target_[s] = prev_[s] = next_[s] = NONE;
        --count_[t];
        --links_;
    }

    /** @brief @p root's depth becomes @p depth, and each entity under it follows: O(subtree), only when the depth moved. */
    void setSubtreeDepth(Entity root, u32 depth) {
        const u32 r = root.index();
        if (r >= depth_.size() || depth_[r] == depth) return;
        const i64 delta = static_cast<i64>(depth) - static_cast<i64>(depth_[r]);
        walk_.clear();
        walk_.push_back(root.raw);
        while (!walk_.empty()) {
            const u32 at = walk_.back();
            walk_.pop_back();
            const u32 i = Entity::fromRaw(at).index();
            depth_[i] = static_cast<u32>(static_cast<i64>(depth_[i]) + delta);
            for (u32 c = first_[i]; c != NONE; c = next_[Entity::fromRaw(c).index()]) walk_.push_back(c);
        }
    }
};

}  // namespace esengine::ecs
