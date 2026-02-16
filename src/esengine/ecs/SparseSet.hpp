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
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

// Project includes
#include "../core/Types.hpp"
#include "Entity.hpp"

// Standard library
#include <algorithm>
#include <memory>
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
};

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

    /** @brief Page type: array of entity indices */
    using Page = std::array<Entity, SPARSE_PAGE_SIZE>;

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
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;

        if (pageIndex >= pages_.size() || !pages_[pageIndex]) {
            return false;
        }

        const Entity denseIndex = (*pages_[pageIndex])[offset];
        return denseIndex < dense_.size() && dense_[denseIndex] == entity;
    }

    /**
     * @brief Gets the component for an entity (must exist)
     * @param entity The entity
     * @return Reference to the component
     *
     * @note Asserts if the entity doesn't have a component
     */
    T& get(Entity entity) {
        ES_ASSERT(contains(entity), "Entity does not have component");
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        return components_[(*pages_[pageIndex])[offset]];
    }

    /** @copydoc get() */
    const T& get(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity does not have component");
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        return components_[(*pages_[pageIndex])[offset]];
    }

    /**
     * @brief Tries to get a component (returns nullptr if not found)
     * @param entity The entity
     * @return Pointer to the component, or nullptr
     */
    T* tryGet(Entity entity) {
        if (!contains(entity)) return nullptr;
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        return &components_[(*pages_[pageIndex])[offset]];
    }

    /** @copydoc tryGet() */
    const T* tryGet(Entity entity) const {
        if (!contains(entity)) return nullptr;
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        return &components_[(*pages_[pageIndex])[offset]];
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
        ES_ASSERT(!contains(entity), "Entity already has component");

        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;

        if (pageIndex >= pages_.size()) {
            pages_.resize(pageIndex + 1);
        }

        if (!pages_[pageIndex]) {
            pages_[pageIndex] = std::make_unique<Page>();
            std::fill(pages_[pageIndex]->begin(), pages_[pageIndex]->end(), INVALID_ENTITY);
        }

        (*pages_[pageIndex])[offset] = static_cast<Entity>(dense_.size());
        dense_.push_back(entity);
        components_.emplace_back(std::forward<Args>(args)...);

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

        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        const auto last = dense_.back();
        const auto index = (*pages_[pageIndex])[offset];

        dense_[index] = last;
        components_[index] = std::move(components_.back());

        const auto lastPageIndex = last / SPARSE_PAGE_SIZE;
        const auto lastOffset = last % SPARSE_PAGE_SIZE;
        (*pages_[lastPageIndex])[lastOffset] = index;

        dense_.pop_back();
        components_.pop_back();
        (*pages_[pageIndex])[offset] = INVALID_ENTITY;
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
        pages_.clear();
        dense_.clear();
        components_.clear();
    }

    void rebuildSparse() {
        pages_.clear();
        for (usize i = 0; i < dense_.size(); ++i) {
            const Entity entity = dense_[i];
            const auto pageIndex = entity / SPARSE_PAGE_SIZE;
            const auto offset = entity % SPARSE_PAGE_SIZE;
            if (pageIndex >= pages_.size()) {
                pages_.resize(pageIndex + 1);
            }
            if (!pages_[pageIndex]) {
                pages_[pageIndex] = std::make_unique<Page>();
                std::fill(pages_[pageIndex]->begin(), pages_[pageIndex]->end(), INVALID_ENTITY);
            }
            (*pages_[pageIndex])[offset] = static_cast<Entity>(i);
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
     * @brief Gets the dense entity array (non-const)
     * @return Reference to entity vector
     *
     * @details Allows direct modification of entity order (e.g., for sorting).
     *          Use with caution - must maintain correspondence with components().
     */
    std::vector<Entity>& entities() { return dense_; }

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
        ES_ASSERT(contains(entity), "Entity not in set");
        const auto pageIndex = entity / SPARSE_PAGE_SIZE;
        const auto offset = entity % SPARSE_PAGE_SIZE;
        return (*pages_[pageIndex])[offset];
    }

private:
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
};

}  // namespace esengine::ecs
