// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    SparseSet.hpp
 * @brief   Sparse set data structure for efficient ECS component storage
 * @details Implements a sparse set providing O(1) insertion, deletion,
 *          and lookup while maintaining cache-friendly dense iteration.
 *          This is the core data structure behind the ECS component pools.
 *
 * @author  ESEngine Team
 * @date    2025
 *
 * @copyright Copyright (c) 2025 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Log.hpp"
#include "../core/Types.hpp"
#include "Entity.hpp"

// Standard library
#include <algorithm>
#include <array>
#include <concepts>
#include <cstring>
#include <memory>
#include <string>
#include <string_view>
#include <type_traits>
#include <vector>

namespace esengine::ecs {

// =============================================================================
// SparseSetBase
// =============================================================================

/**
 * @brief Type-erased base class for sparse set operations
 *
 * @details Provides a common interface for type-erased operations on
 *          component pools. Used by Registry to manage pools of different
 *          component types uniformly.
 */
class SparseSetBase {
public:
    /** @brief Virtual destructor for proper cleanup */
    virtual ~SparseSetBase() = default;

    /**
     * @brief Checks if an entity exists in the set
     * @param entity The entity to check
     * @return True if the entity has a component in this pool
     */
    virtual bool contains(Entity entity) const = 0;

    /**
     * @brief Removes an entity's component from the set
     * @param entity The entity whose component to remove
     */
    virtual void remove(Entity entity) = 0;

    /**
     * @brief Gets the number of components in the set
     * @return Number of stored components
     */
    virtual usize size() const = 0;

    /**
     * @brief Checks if the set is empty
     * @return True if no components are stored
     */
    virtual bool empty() const = 0;

    /**
     * @brief Removes all components from the set
     */
    virtual void clear() = 0;

    /**
     * @brief Gets the dense entity array for iteration
     * @return Const reference to the entity vector
     */
    virtual const std::vector<Entity>& entities() const = 0;

    /**
     * @brief Monotonic version, bumped whenever stored components may have
     *        moved in memory (buffer reallocation on growth, or swap-and-pop
     *        relocation on removal).
     * @details Single source of truth for the cross-boundary pointer-staleness
     *          guard: a raw component pointer handed to JS (e.g. getTransformPtr)
     *          is only valid while this value is unchanged. Replaces the old
     *          SchemaComponentPool::poolVersion (which lived in a now-deleted
     *          parallel store and, notably, was not bumped on remove).
     */
    virtual u32 version() const = 0;

    /**
     * @brief Permutes storage so iteration follows @p rank
     * @param rank Rank per ENTITY INDEX (Entity::index()); lower ranks iterate first
     *
     * @details Storage order is iteration order, and iteration order is the
     *          renderer's within-layer painter order, so this is how a scene's
     *          authored entity order reaches the draw list without respawning
     *          anything. Entities with no rank (index past the end, or the
     *          UNRANKED sentinel) keep their relative order after the ranked
     *          ones — the sort is stable. A no-op reorder leaves storage (and
     *          therefore every handed-out component pointer) untouched.
     */
    virtual void reorderBy(const std::vector<u32>& rank) = 0;

    /** @brief Rank for an entity the caller did not order — sorts last, stably. */
    static constexpr u32 UNRANKED = 0xFFFFFFFFu;

    // ---- Change stamps --------------------------------------------------------------------------------------------------------
    // Every component carries the tick of its last write beside it (see Registry::changeTick for what a tick is). Written by
    // whoever writes the component: Registry::patch and markChanged here, the generated setters from script.

    /** @brief The tick of @p entity's last write here, 0 where it has no component: the type-erased changedTick. */
    virtual u32 changedTickOf(Entity entity) const = 0;
    /** @brief Stamps @p entity's component as written at @p tick (no-op where it has none): the type-erased markChanged. */
    virtual void markChanged(Entity entity, u32 tick) = 0;
    /** @brief The tick of the last write to any component of this pool, or of the last add or remove: "anything since?" in O(1). */
    virtual u32 lastChangedTick() const = 0;
    /** @brief Notes an add or a remove at @p tick, which no stamp of a component that is still there records. */
    virtual void noteStructural(u32 tick) = 0;
    /** @brief Lifts every stamp older than @p floor to it, so a stamp never reads as newer after the tick wraps. */
    virtual void clampStamps(u32 floor) = 0;
    /** @brief The component type's name, for what the audit says. */
    virtual std::string_view typeName() const = 0;

    // ---- The audit -------------------------------------------------------------------------------------------------------------
    // A write that left no stamp is a consumer that will never see it (a renderer drawing the old state). The audit keeps a copy
    // of every component and reports each one that changed since the copy while its stamp did not move: by its bytes where they
    // are its value (trivially copyable), by == where it says what equal is; a component that is neither is listed as unchecked.

    /** @brief What the audit kept of a pool: its entities and their components' bytes, as they were at @p tick. */
    struct AuditCopy {
        std::vector<Entity> entities;
        std::vector<u8> bytes;                 ///< a trivially copyable component's bytes
        std::shared_ptr<void> values;          ///< otherwise a copy of the components, compared with ==
        u32 tick = 0;
    };
    /** @brief Whether this pool's components can be audited (see above). */
    virtual bool auditable() const = 0;
    /** @brief Keeps the pool's state as it is at @p tick. */
    virtual void auditKeep(AuditCopy& copy, u32 tick) const = 0;
    /**
     * @brief Calls @p report for each entity whose component changed since @p copy without a stamp after copy.tick.
     * @return How many did.
     */
    virtual u32 auditCompare(const AuditCopy& copy, void (*report)(void* user, Entity entity), void* user) const = 0;

    /**
     * @brief Which current slot belongs at each position when `dense` is put in `rank` order (stable).
     * @details Not a member of the template: the sort does not depend on the component type, and a copy of `std::stable_sort` and its
     *          merge helpers for each of the hundred-odd component types was 227KB of the engine's wasm — over a tenth of its code.
     *          Entities with no rank sort after the ranked ones, in their present order.
     */
    [[gnu::noinline]] static std::vector<usize> stablePermutation(const std::vector<Entity>& dense, const std::vector<u32>& rank) {
        const usize n = dense.size();
        std::vector<usize> perm(n);
        for (usize i = 0; i < n; ++i) perm[i] = i;
        const auto rankOf = [&](usize i) {
            const u32 idx = dense[i].index();
            return idx < rank.size() ? rank[idx] : UNRANKED;
        };
        std::stable_sort(perm.begin(), perm.end(), [&](usize a, usize b) { return rankOf(a) < rankOf(b); });
        return perm;
    }
};

/** @brief T's name as the compiler spells it, without a namespace: what an audit report says. */
template<typename T>
std::string_view componentTypeName() {
#if defined(_MSC_VER) && !defined(__clang__)
    constexpr std::string_view full = __FUNCSIG__;
    constexpr std::string_view open = "componentTypeName<";
    constexpr std::string_view close = ">(void)";
#else
    constexpr std::string_view full = __PRETTY_FUNCTION__;
    constexpr std::string_view open = "T = ";
    constexpr std::string_view close = "]";
#endif
    const usize start = full.find(open);
    if (start == std::string_view::npos) return full;
    std::string_view name = full.substr(start + open.size());
    const usize end = name.rfind(close);
    if (end != std::string_view::npos) name = name.substr(0, end);
    const usize colon = name.rfind("::");
    if (colon != std::string_view::npos) name = name.substr(colon + 2);
    // MSVC writes "struct X" / "class X".
    for (std::string_view tag : {std::string_view("struct "), std::string_view("class ")}) {
        if (name.substr(0, tag.size()) == tag) name = name.substr(tag.size());
    }
    return name;
}

/** @brief Whether stamp @p a is later than tick @p b, across a wrap of the counter (stamps are kept within half its range). */
inline bool tickAfter(u32 a, u32 b) {
    return static_cast<i32>(a - b) > 0;
}

// =============================================================================
// SparseSet
// =============================================================================

/**
 * @brief Sparse set container for efficient entity-component storage
 *
 * @tparam T The component type to store
 *
 * @details The sparse set uses a paged sparse array and dense arrays:
 *          - **Paged sparse array**: Maps entity IDs to dense array indices
 *            Divided into fixed-size pages (4096 entities each) allocated
 *            on-demand to avoid unbounded memory growth for sparse entity IDs.
 *          - **Dense array**: Stores entities and components contiguously
 *
 *          This provides:
 *          - O(1) insertion, deletion, and lookup
 *          - Cache-friendly iteration over components
 *          - Stable component pointers during iteration
 *          - Bounded memory usage even with sparse entity IDs
 *
 *          The "swap and pop" deletion strategy maintains density
 *          without gaps, at the cost of unstable ordering.
 *
 *          **Memory efficiency**: With paging, entity ID 1,000,000 only
 *          allocates 244 pages (~16KB) instead of 4MB.
 *
 * @code
 * SparseSet<Position> positions;
 *
 * // Add components
 * positions.emplace(entity1, 0.0f, 0.0f);
 * positions.emplace(entity2, 10.0f, 5.0f);
 *
 * // Access component
 * if (positions.contains(entity1)) {
 *     Position& pos = positions.get(entity1);
 * }
 *
 * // Iterate all
 * for (Entity e : positions) {
 *     Position& pos = positions.get(e);
 * }
 * @endcode
 */
template<typename T>
class SparseSet : public SparseSetBase {
public:
    /** @brief Iterator type for entity iteration */
    using Iterator = typename std::vector<Entity>::const_iterator;

    /** @brief Page size for paged sparse array (entities per page) */
    static constexpr usize SPARSE_PAGE_SIZE = 4096;

    /** @brief Sentinel for empty sparse slots */
    static constexpr u32 INVALID_INDEX = INVALID_DENSE_INDEX;

    /** @brief Page type: array of dense indices */
    using Page = std::array<u32, SPARSE_PAGE_SIZE>;

    /** @brief Default constructor */
    SparseSet() = default;

    /** @brief Destructor */
    ~SparseSet() override = default;

    // Non-copyable, movable
    SparseSet(const SparseSet&) = delete;
    SparseSet& operator=(const SparseSet&) = delete;
    SparseSet(SparseSet&&) noexcept = default;
    SparseSet& operator=(SparseSet&&) noexcept = default;

    // =========================================================================
    // Lookup Operations
    // =========================================================================

    /**
     * @brief Checks if an entity has a component in this set
     * @param entity The entity to check
     * @return True if the entity has a component
     *
     * @details O(1) complexity. Validates the sparse-dense mapping.
     *          Uses paged lookup to avoid unbounded memory growth.
     */
    bool contains(Entity entity) const override {
        u32 di = denseIndexOf(entity);
        return di != INVALID_INDEX && dense_[di] == entity;
    }

    /**
     * @brief Gets the component for an entity (must exist)
     * @param entity The entity
     * @return Reference to the component
     *
     * @note A miss is fatal in every build: there is no valid `T&` to return, and
     *       a stand-in would be written through silently. tryGet() is the checked
     *       path, getUnchecked() the one for callers that proved membership.
     */
    T& get(Entity entity) {
        const u32 di = denseIndexOf(entity);
        ES_VERIFY_FATAL(di != INVALID_INDEX && dense_[di] == entity, missMessage(entity));
        return components_[di];
    }

    /** @copydoc get() */
    const T& get(Entity entity) const {
        const u32 di = denseIndexOf(entity);
        ES_VERIFY_FATAL(di != INVALID_INDEX && dense_[di] == entity, missMessage(entity));
        return components_[di];
    }

    T& getUnchecked(Entity entity) {
        return components_[denseIndexOf(entity)];
    }

    const T& getUnchecked(Entity entity) const {
        return components_[denseIndexOf(entity)];
    }

    /**
     * @brief Tries to get a component (returns nullptr if not found)
     * @param entity The entity
     * @return Pointer to the component, or nullptr
     */
    T* tryGet(Entity entity) {
        u32 di = denseIndexOf(entity);
        if (di == INVALID_INDEX || dense_[di] != entity) return nullptr;
        return &components_[di];
    }

    /** @copydoc tryGet() */
    const T* tryGet(Entity entity) const {
        u32 di = denseIndexOf(entity);
        if (di == INVALID_INDEX || dense_[di] != entity) return nullptr;
        return &components_[di];
    }

    // =========================================================================
    // Change Stamps
    // =========================================================================

    /** @brief The tick of @p entity's last write, 0 when it has none here. */
    u32 changedTick(Entity entity) const {
        const u32 di = denseIndexOf(entity);
        return di != INVALID_INDEX && dense_[di] == entity ? changed_[di] : 0;
    }

    u32 changedTickOf(Entity entity) const override { return changedTick(entity); }

    /** @brief Stamps @p entity's component with @p tick: it was written. No-op for an entity without one. */
    void markChanged(Entity entity, u32 tick) override {
        const u32 di = denseIndexOf(entity);
        if (di == INVALID_INDEX || dense_[di] != entity) return;
        changed_[di] = tick;
        if (tickAfter(tick, last_changed_)) last_changed_ = tick;
    }

    /** @brief The stamps, parallel to components(): where a writer that holds a component's place stamps it. */
    u32* changeTicks() { return changed_.data(); }
    const u32* changeTicks() const { return changed_.data(); }

    /** @brief Where the pool's last-change tick lives, for a writer that stamps through changeTicks() to lift with it. */
    u32* lastChangedSlot() { return &last_changed_; }

    u32 lastChangedTick() const override { return last_changed_; }
    void noteStructural(u32 tick) override {
        if (tickAfter(tick, last_changed_)) last_changed_ = tick;
    }
    void clampStamps(u32 floor) override {
        for (u32& t : changed_) if (tickAfter(floor, t)) t = floor;
        if (tickAfter(floor, last_changed_)) last_changed_ = floor;
    }
    std::string_view typeName() const override { return componentTypeName<T>(); }

    static constexpr bool kAuditBytes = std::is_trivially_copyable_v<T>;
    static constexpr bool kAuditValues = !kAuditBytes && std::is_copy_constructible_v<T> && std::equality_comparable<T>;
    bool auditable() const override { return kAuditBytes || kAuditValues; }
    void auditKeep(AuditCopy& copy, u32 tick) const override {
        copy.tick = tick;
        copy.entities = dense_;
        copy.bytes.clear();
        copy.values.reset();
        if constexpr (kAuditBytes) {
            copy.bytes.resize(components_.size() * sizeof(T));
            if (!components_.empty()) std::memcpy(copy.bytes.data(), components_.data(), copy.bytes.size());
        } else if constexpr (kAuditValues) {
            copy.values = std::make_shared<std::vector<T>>(components_);
        }
    }
    u32 auditCompare(const AuditCopy& copy, void (*report)(void*, Entity), void* user) const override {
        if constexpr (!kAuditBytes && !kAuditValues) {
            return 0;
        } else {
            const auto* values = kAuditValues ? static_cast<const std::vector<T>*>(copy.values.get()) : nullptr;
            if (kAuditValues && !values) return 0;
            u32 found = 0;
            for (usize k = 0; k < copy.entities.size(); ++k) {
                const Entity entity = copy.entities[k];
                const u32 di = denseIndexOf(entity);
                if (di == INVALID_INDEX || dense_[di] != entity) continue;  // removed since: the journal says so
                if (tickAfter(changed_[di], copy.tick)) continue;           // written, and said so
                bool same = false;
                if constexpr (requires(const T& now, const T& kept) { { now.auditSame(kept) } -> std::convertible_to<bool>; }) {
                    // The component says what unchanged is (a cache it fills lazily is no write): see Transform::auditSame.
                    same = kAuditBytes
                        ? components_[di].auditSame(*reinterpret_cast<const T*>(copy.bytes.data() + k * sizeof(T)))
                        : components_[di].auditSame((*values)[k]);
                } else if constexpr (kAuditBytes) {
                    same = std::memcmp(&components_[di], copy.bytes.data() + k * sizeof(T), sizeof(T)) == 0;
                } else {
                    same = components_[di] == (*values)[k];
                }
                if (same) continue;
                ++found;
                if (report) report(user, entity);
            }
            return found;
        }
    }

    // =========================================================================
    // Modification Operations
    // =========================================================================

    /**
     * @brief Adds a component to an entity with in-place construction
     * @tparam Args Constructor argument types
     * @param entity The entity to add a component to
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the newly created component
     *
     * @note Asserts if the entity already has a component
     *
     * @details O(1) amortized complexity. Allocates pages on-demand.
     *          Memory usage is bounded: O(num_pages * SPARSE_PAGE_SIZE) where
     *          num_pages = ceil(max_entity_id / SPARSE_PAGE_SIZE).
     */
    template<typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        // Release-safe: a duplicate emplace would append a second dense slot and
        // overwrite the sparse->dense mapping, corrupting the set (ES_ASSERT is
        // stripped in release). Degrade to returning the existing component.
        ES_VERIFY(!contains(entity), return get(entity));

        const u32 idx = entity.index();
        const auto pageIndex = idx / SPARSE_PAGE_SIZE;
        const auto offset = idx % SPARSE_PAGE_SIZE;

        if (pageIndex >= pages_.size()) {
            pages_.resize(pageIndex + 1);
        }

        if (!pages_[pageIndex]) {
            pages_[pageIndex] = std::make_unique<Page>();
            std::fill(pages_[pageIndex]->begin(), pages_[pageIndex]->end(), INVALID_INDEX);
        }

        (*pages_[pageIndex])[offset] = static_cast<u32>(dense_.size());
        dense_.push_back(entity);

        // Bump the version only when the component buffer actually reallocates
        // (base pointer moves) — that is exactly when previously-handed-out raw
        // pointers into components_ become stale. A non-reallocating append
        // leaves existing component addresses intact, so no bump is needed.
        const T* before = components_.data();
        const u32* stampsBefore = changed_.data();
        components_.emplace_back(std::forward<Args>(args)...);
        // Unstamped: whoever adds it stamps it with the tick it belongs to (Registry::emplace).
        changed_.push_back(0);
        if (components_.data() != before || changed_.data() != stampsBefore) ++version_;

        return components_.back();
    }

    /**
     * @brief Removes a component from an entity
     * @param entity The entity whose component to remove
     *
     * @details O(1) complexity using swap-and-pop. The last element
     *          is moved to fill the gap, maintaining density.
     *          No-op if the entity doesn't have a component.
     */
    void remove(Entity entity) override {
        if (!contains(entity)) return;

        // Swap-and-pop relocates the last component into the freed slot, so any
        // raw pointer previously handed out for the moved entity is now stale.
        ++version_;

        const u32 idx = entity.index();
        const auto pageIndex = idx / SPARSE_PAGE_SIZE;
        const auto offset = idx % SPARSE_PAGE_SIZE;
        const u32 denseIdx = (*pages_[pageIndex])[offset];

        if (denseIdx == static_cast<u32>(dense_.size()) - 1) {
            dense_.pop_back();
            components_.pop_back();
            changed_.pop_back();
            (*pages_[pageIndex])[offset] = INVALID_INDEX;
            return;
        }

        const Entity last = dense_.back();

        dense_[denseIdx] = last;
        components_[denseIdx] = std::move(components_.back());
        changed_[denseIdx] = changed_.back();
        changed_.pop_back();

        const u32 lastIdx = last.index();
        (*pages_[lastIdx / SPARSE_PAGE_SIZE])[lastIdx % SPARSE_PAGE_SIZE] = denseIdx;

        dense_.pop_back();
        components_.pop_back();
        (*pages_[pageIndex])[offset] = INVALID_INDEX;
    }

    // =========================================================================
    // Container Operations
    // =========================================================================

    /**
     * @brief Gets the number of components in the set
     * @return Component count
     */
    usize size() const override { return dense_.size(); }

    /**
     * @brief Checks if the set is empty
     * @return True if no components are stored
     */
    bool empty() const override { return dense_.empty(); }

    /**
     * @brief Removes all components
     */
    void clear() override {
        ++version_;
        pages_.clear();
        dense_.clear();
        components_.clear();
        changed_.clear();
    }

    /** @copydoc SparseSetBase::version() */
    u32 version() const override { return version_; }

    /** @copydoc SparseSetBase::reorderBy() */
    void reorderBy(const std::vector<u32>& rank) override {
        const usize n = dense_.size();
        if (n <= 1) return;

        // perm[i] = which current slot belongs at position i. The sort keeps
        // equal-ranked (and unranked) entities in their present order, and is
        // one function for every component type (see stablePermutation).
        std::vector<usize> perm = stablePermutation(dense_, rank);

        permute(perm);
    }

    /**
     * @brief Puts slot perm[i] at position i, for every i: the entity, its component and its stamp together.
     * @details The one way storage is reordered (reorderBy, Registry::sort). A permutation that moves nothing leaves storage, and
     *          every handed-out pointer, alone. Consumes @p perm.
     */
    void permute(std::vector<usize>& perm) {
        const usize n = dense_.size();
        bool moved = false;
        for (usize i = 0; i < n; ++i) {
            if (perm[i] != i) { moved = true; break; }
        }
        if (!moved) return;

        // Cycle-walk the permutation in place.
        for (usize i = 0; i < n; ++i) {
            if (perm[i] == i) continue;
            usize j = i;
            Entity tmpEntity = std::move(dense_[i]);
            T tmpComponent = std::move(components_[i]);
            const u32 tmpStamp = changed_[i];
            while (perm[j] != i) {
                const usize src = perm[j];
                dense_[j] = std::move(dense_[src]);
                components_[j] = std::move(components_[src]);
                changed_[j] = changed_[src];
                perm[j] = j;
                j = src;
            }
            dense_[j] = std::move(tmpEntity);
            components_[j] = std::move(tmpComponent);
            changed_[j] = tmpStamp;
            perm[j] = j;
        }
        rebuildSparse();
    }

    void rebuildSparse() {
        // Called after permute() moves dense_/components_ in place —
        // component addresses changed, so any handed-out raw pointer is stale.
        ++version_;
        pages_.clear();
        for (usize i = 0; i < dense_.size(); ++i) {
            const u32 idx = dense_[i].index();
            const auto pageIndex = idx / SPARSE_PAGE_SIZE;
            const auto offset = idx % SPARSE_PAGE_SIZE;
            if (pageIndex >= pages_.size()) {
                pages_.resize(pageIndex + 1);
            }
            if (!pages_[pageIndex]) {
                pages_[pageIndex] = std::make_unique<Page>();
                std::fill(pages_[pageIndex]->begin(), pages_[pageIndex]->end(), INVALID_INDEX);
            }
            (*pages_[pageIndex])[offset] = static_cast<u32>(i);
        }
    }

    // =========================================================================
    // Iteration
    // =========================================================================

    /**
     * @brief Returns iterator to the first entity
     * @return Begin iterator
     */
    Iterator begin() const { return dense_.begin(); }

    /**
     * @brief Returns iterator past the last entity
     * @return End iterator
     */
    Iterator end() const { return dense_.end(); }

    /**
     * @brief Gets the dense entity array
     * @return Const reference to entity vector
     */
    const std::vector<Entity>& entities() const override { return dense_; }


    /**
     * @brief Gets the component array for direct iteration
     * @return Reference to component vector
     *
     * @details Allows iterating components directly without
     *          looking up by entity. Components are stored in
     *          the same order as entities().
     */
    std::vector<T>& components() { return components_; }

    /** @copydoc components() */
    const std::vector<T>& components() const { return components_; }

    /**
     * @brief Gets the dense array index for an entity
     * @param entity The entity
     * @return Index in the dense/component arrays
     *
     * @note Asserts if the entity is not in the set
     */
    usize indexOf(Entity entity) const {
        // Release-safe: a non-member would otherwise return INVALID_INDEX and be
        // used as a dense-array subscript (OOB). Compute the dense index once and
        // verify membership; callers must treat INVALID_INDEX as "not present".
        const u32 di = denseIndexOf(entity);
        ES_VERIFY(di != INVALID_INDEX && dense_[di] == entity, return INVALID_INDEX);
        return di;
    }

private:
    /// Built only when get() is about to abort, so it names the entity asked for.
    static std::string missMessage(Entity entity) {
        return "SparseSet::get on an entity without this component (entity "
               + std::to_string(entity.index()) + ":" + std::to_string(entity.generation())
               + "); use tryGet() when absence is expected";
    }

    /**
     * @brief Looks up the dense array index for an entity
     * @return Dense index, or INVALID_INDEX if page not allocated
     */
    u32 denseIndexOf(Entity entity) const {
        const u32 idx = entity.index();
        const auto pageIndex = idx / SPARSE_PAGE_SIZE;
        const auto offset = idx % SPARSE_PAGE_SIZE;
        if (pageIndex >= pages_.size() || !pages_[pageIndex]) return INVALID_INDEX;
        return (*pages_[pageIndex])[offset];
    }

    // =========================================================================
    // Data Members
    // =========================================================================

    /**
     * @brief Paged sparse array: maps Entity ID -> index in dense array
     * @details Pages are allocated on-demand. Each page holds SPARSE_PAGE_SIZE
     *          entity mappings. pageIndex = entity / SPARSE_PAGE_SIZE,
     *          offset = entity % SPARSE_PAGE_SIZE.
     */
    std::vector<std::unique_ptr<Page>> pages_;

    /**
     * @brief Dense array: stores entities contiguously
     * @details Parallel to components_. Enables O(1) reverse lookup.
     */
    std::vector<Entity> dense_;

    /**
     * @brief Component storage: parallel to dense array
     * @details components_[i] belongs to entity dense_[i].
     */
    std::vector<T> components_;

    /** @brief Change stamps, parallel to components_: changed_[i] is the tick of components_[i]'s last write. */
    std::vector<u32> changed_;

    /** @brief The latest tick any component here was written, added or removed at. */
    u32 last_changed_ = 0;

    /** @brief Pointer-staleness generation; see SparseSetBase::version(). */
    u32 version_ = 0;
};

}  // namespace esengine::ecs
