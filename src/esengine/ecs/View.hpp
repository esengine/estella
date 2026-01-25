/**
 * @file    View.hpp
 * @brief   ECS View for querying entities with specific components
 * @details Provides efficient iteration over entities that have a specific
 *          set of components. Views are the primary way to query the ECS.
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
#include "SparseSet.hpp"

// Standard library
#include <tuple>

namespace esengine::ecs {

// Forward declaration
class Registry;

// =============================================================================
// ViewIterator
// =============================================================================

/**
 * @brief Iterator for multi-component views
 *
 * @tparam Components The component types required
 *
 * @details Iterates over entities from the smallest pool while filtering
 *          for entities that have all required components. Automatically
 *          skips entities that don't match the full component set.
 */
template<typename... Components>
class ViewIterator {
public:
    /** @brief Tuple type holding pointers to all component pools */
    using PoolsTuple = std::tuple<SparseSet<Components>*...>;

    /**
     * @brief Constructs an iterator
     * @param entities Pointer to the entity array being iterated
     * @param index Current position in the entity array
     * @param pools Tuple of component pool pointers
     */
    ViewIterator(const std::vector<Entity>* entities, usize index, PoolsTuple pools)
        : entities_(entities), index_(index), pools_(pools) {
        // Skip to first valid entity
        if (entities_ && index_ < entities_->size()) {
            skipInvalid();
        }
    }

    /**
     * @brief Dereferences to get the current entity
     * @return The current entity ID
     */
    Entity operator*() const {
        return (*entities_)[index_];
    }

    /**
     * @brief Advances to the next matching entity
     * @return Reference to this iterator
     */
    ViewIterator& operator++() {
        ++index_;
        skipInvalid();
        return *this;
    }

    /**
     * @brief Inequality comparison
     * @param other Iterator to compare with
     * @return True if iterators are at different positions
     */
    bool operator!=(const ViewIterator& other) const {
        return index_ != other.index_;
    }

    /**
     * @brief Equality comparison
     * @param other Iterator to compare with
     * @return True if iterators are at the same position
     */
    bool operator==(const ViewIterator& other) const {
        return index_ == other.index_;
    }

private:
    /**
     * @brief Skips entities that don't have all required components
     *
     * @details Advances index_ until we find an entity that has
     *          all components in the view, or we reach the end.
     */
    void skipInvalid() {
        while (index_ < entities_->size()) {
            Entity entity = (*entities_)[index_];
            if (allHave(entity)) {
                break;
            }
            ++index_;
        }
    }

    /**
     * @brief Checks if an entity has all required components
     * @param entity The entity to check
     * @return True if entity has all components
     */
    bool allHave(Entity entity) const {
        return allHaveImpl(entity, std::index_sequence_for<Components...>{});
    }

    /**
     * @brief Implementation helper using index sequence
     * @tparam Is Index sequence for component types
     * @param entity The entity to check
     * @return True if entity has all components
     */
    template<usize... Is>
    bool allHaveImpl(Entity entity, std::index_sequence<Is...>) const {
        return (std::get<Is>(pools_)->contains(entity) && ...);
    }

    const std::vector<Entity>* entities_;
    usize index_;
    PoolsTuple pools_;
};

// =============================================================================
// View (Multi-Component)
// =============================================================================

/**
 * @brief View for iterating entities with multiple required components
 *
 * @tparam Components The component types that entities must have
 *
 * @details Provides iteration over all entities that have ALL of the
 *          specified component types. Optimizes by iterating over the
 *          smallest pool and filtering by other components.
 *
 * @code
 * // Iterate entities with Position AND Velocity
 * auto view = registry.view<Position, Velocity>();
 *
 * // Range-based for loop
 * for (Entity e : view) {
 *     auto& pos = view.get<Position>(e);
 *     auto& vel = view.get<Velocity>(e);
 *     pos.x += vel.x * dt;
 * }
 *
 * // Each with callback
 * view.each([&](Entity e, Position& p, Velocity& v) {
 *     p.x += v.x * dt;
 * });
 * @endcode
 */
template<typename... Components>
class View {
public:
    /** @brief Iterator type */
    using Iterator = ViewIterator<Components...>;
    /** @brief Tuple type for pool pointers */
    using PoolsTuple = std::tuple<SparseSet<Components>*...>;

    /**
     * @brief Constructs a view from component pools
     * @param pools Tuple of pointers to component pools
     */
    View(PoolsTuple pools) : pools_(pools) {
        // Find the smallest pool to iterate over
        findSmallestPool();
    }

    /**
     * @brief Returns iterator to the first matching entity
     * @return Begin iterator
     */
    Iterator begin() const {
        if (!smallest_) return end();
        return Iterator(&smallest_->entities(), 0, pools_);
    }

    /**
     * @brief Returns iterator past the last entity
     * @return End iterator
     */
    Iterator end() const {
        if (!smallest_) return Iterator(nullptr, 0, pools_);
        return Iterator(&smallest_->entities(), smallest_->size(), pools_);
    }

    // =========================================================================
    // Component Access
    // =========================================================================

    /**
     * @brief Gets a specific component from an entity
     * @tparam T The component type to get
     * @param entity The entity (must be valid in view)
     * @return Reference to the component
     */
    template<typename T>
    T& get(Entity entity) {
        return std::get<SparseSet<T>*>(pools_)->get(entity);
    }

    /** @copydoc get() */
    template<typename T>
    const T& get(Entity entity) const {
        return std::get<SparseSet<T>*>(pools_)->get(entity);
    }

    /**
     * @brief Gets all components for an entity as a tuple
     * @param entity The entity
     * @return Tuple of component references
     */
    std::tuple<Components&...> getAll(Entity entity) {
        return std::tuple<Components&...>(
            std::get<SparseSet<Components>*>(pools_)->get(entity)...);
    }

    // =========================================================================
    // View Properties
    // =========================================================================

    /**
     * @brief Checks if the view is empty
     * @return True if no entities match
     */
    bool empty() const {
        return !smallest_ || smallest_->empty();
    }

    /**
     * @brief Gets the estimated number of matching entities
     * @return Upper bound on entity count (actual may be lower)
     *
     * @details Returns the size of the smallest pool. Actual matches
     *          may be fewer due to filtering by other components.
     */
    usize sizeHint() const {
        return smallest_ ? smallest_->size() : 0;
    }

    // =========================================================================
    // Functional Iteration
    // =========================================================================

    /**
     * @brief Executes a function for each matching entity
     * @tparam Func Callback type
     * @param func The callback to invoke
     *
     * @details The callback can have one of these signatures:
     *          - `void(Entity, Component&...)` - entity and all components
     *          - `void(Component&...)` - components only
     *          - `void(Entity)` - entity only
     *
     * @code
     * // With entity and components
     * view.each([](Entity e, Position& p, Velocity& v) { ... });
     *
     * // Components only
     * view.each([](Position& p, Velocity& v) { ... });
     *
     * // Entity only
     * view.each([](Entity e) { ... });
     * @endcode
     */
    template<typename Func>
    void each(Func&& func) {
        for (auto entity : *this) {
            if constexpr (std::is_invocable_v<Func, Entity, Components&...>) {
                func(entity, get<Components>(entity)...);
            } else if constexpr (std::is_invocable_v<Func, Components&...>) {
                func(get<Components>(entity)...);
            } else {
                func(entity);
            }
        }
    }

private:
    /**
     * @brief Finds the smallest component pool
     *
     * @details The view iterates over the smallest pool for efficiency,
     *          as it minimizes the number of entities to filter.
     */
    void findSmallestPool() {
        smallest_ = nullptr;
        usize minSize = std::numeric_limits<usize>::max();

        findSmallestImpl(minSize, std::index_sequence_for<Components...>{});
    }

    template<usize... Is>
    void findSmallestImpl(usize& minSize, std::index_sequence<Is...>) {
        ((checkPool<Is>(minSize)), ...);
    }

    template<usize I>
    void checkPool(usize& minSize) {
        auto* pool = std::get<I>(pools_);
        if (pool && pool->size() < minSize) {
            minSize = pool->size();
            smallest_ = static_cast<SparseSetBase*>(pool);
        }
    }

    /** @brief Tuple of component pool pointers */
    PoolsTuple pools_;
    /** @brief Pointer to the smallest pool (for iteration) */
    SparseSetBase* smallest_ = nullptr;
};

// =============================================================================
// View<T> Specialization (Single Component)
// =============================================================================

/**
 * @brief Optimized view for single-component queries
 *
 * @tparam T The single component type
 *
 * @details When querying for only one component type, no filtering is
 *          needed. This specialization directly iterates the component
 *          pool for maximum efficiency.
 *
 * @code
 * // Iterate all entities with Position
 * for (Entity e : registry.view<Position>()) {
 *     auto& pos = registry.get<Position>(e);
 * }
 *
 * // Direct component iteration (most efficient)
 * registry.view<Position>().each([](Entity e, Position& p) {
 *     p.x += 1.0f;
 * });
 * @endcode
 */
template<typename T>
class View<T> {
public:
    /** @brief Iterator type (directly iterates pool) */
    using Iterator = typename std::vector<Entity>::const_iterator;

    /**
     * @brief Constructs a single-component view
     * @param pool Pointer to the component pool
     */
    explicit View(SparseSet<T>* pool) : pool_(pool) {}

    /**
     * @brief Returns iterator to the first entity
     * @return Begin iterator
     */
    Iterator begin() const { return pool_ ? pool_->begin() : Iterator{}; }

    /**
     * @brief Returns iterator past the last entity
     * @return End iterator
     */
    Iterator end() const { return pool_ ? pool_->end() : Iterator{}; }

    /**
     * @brief Gets the component for an entity
     * @param entity The entity
     * @return Reference to the component
     */
    T& get(Entity entity) { return pool_->get(entity); }

    /** @copydoc get() */
    const T& get(Entity entity) const { return pool_->get(entity); }

    /**
     * @brief Checks if the view is empty
     * @return True if no entities have this component
     */
    bool empty() const { return !pool_ || pool_->empty(); }

    /**
     * @brief Gets the exact number of entities in the view
     * @return Entity count
     */
    usize size() const { return pool_ ? pool_->size() : 0; }

    /**
     * @brief Executes a function for each entity
     * @tparam Func Callback type
     * @param func The callback to invoke
     *
     * @details Optimized direct iteration without any filtering.
     *          Callback signatures:
     *          - `void(Entity, T&)` - entity and component
     *          - `void(T&)` - component only
     *          - `void(Entity)` - entity only
     */
    template<typename Func>
    void each(Func&& func) {
        if (!pool_) return;

        const auto& entities = pool_->entities();
        auto& components = pool_->components();

        for (usize i = 0; i < entities.size(); ++i) {
            if constexpr (std::is_invocable_v<Func, Entity, T&>) {
                func(entities[i], components[i]);
            } else if constexpr (std::is_invocable_v<Func, T&>) {
                func(components[i]);
            } else {
                func(entities[i]);
            }
        }
    }

private:
    /** @brief Pointer to the component pool */
    SparseSet<T>* pool_;
};

}  // namespace esengine::ecs
