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
 * @details The sparse set uses two arrays:
 *          - **Sparse array**: Maps entity IDs to dense array indices
 *          - **Dense array**: Stores entities and components contiguously
 *
 *          This provides:
 *          - O(1) insertion, deletion, and lookup
 *          - Cache-friendly iteration over components
 *          - Stable component pointers during iteration
 *
 *          The "swap and pop" deletion strategy maintains density
 *          without gaps, at the cost of unstable ordering.
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
     */
    bool contains(Entity entity) const override {
        return entity < sparse_.size() &&
               sparse_[entity] < dense_.size() &&
               dense_[sparse_[entity]] == entity;
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
        return components_[sparse_[entity]];
    }

    /** @copydoc get() */
    const T& get(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return components_[sparse_[entity]];
    }

    /**
     * @brief Tries to get a component (returns nullptr if not found)
     * @param entity The entity
     * @return Pointer to the component, or nullptr
     */
    T* tryGet(Entity entity) {
        if (!contains(entity)) return nullptr;
        return &components_[sparse_[entity]];
    }

    /** @copydoc tryGet() */
    const T* tryGet(Entity entity) const {
        if (!contains(entity)) return nullptr;
        return &components_[sparse_[entity]];
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
     * @details O(1) amortized complexity. May resize the sparse array.
     */
    template<typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        ES_ASSERT(!contains(entity), "Entity already has component");

        // Ensure sparse array is large enough
        if (entity >= sparse_.size()) {
            sparse_.resize(entity + 1, INVALID_ENTITY);
        }

        // Add to dense arrays
        sparse_[entity] = static_cast<Entity>(dense_.size());
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

        // Swap with last element (swap and pop)
        const auto last = dense_.back();
        const auto index = sparse_[entity];

        // Move last element to removed position
        dense_[index] = last;
        components_[index] = std::move(components_.back());
        sparse_[last] = index;

        // Pop last element
        dense_.pop_back();
        components_.pop_back();
        sparse_[entity] = INVALID_ENTITY;
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
        sparse_.clear();
        dense_.clear();
        components_.clear();
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
        ES_ASSERT(contains(entity), "Entity not in set");
        return sparse_[entity];
    }

private:
    // =========================================================================
    // Data Members
    // =========================================================================

    /**
     * @brief Sparse array: maps Entity ID -> index in dense array
     * @details Indexed directly by entity ID. Contains INVALID_ENTITY
     *          for entities not in the set.
     */
    std::vector<Entity> sparse_;

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
