/**
 * @file    Registry.hpp
 * @brief   Central ECS registry for entity and component management
 * @details The Registry is the core container for the ECS system. It manages
 *          entity creation/destruction, component storage, and provides
 *          query functionality through Views.
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
#include "../core/Log.hpp"
#include "../core/Types.hpp"
#include "Entity.hpp"
#include "SparseSet.hpp"
#include "View.hpp"

// Standard library
#include <any>
#include <functional>
#include <queue>
#include <unordered_map>

namespace esengine::ecs {

// =============================================================================
// Registry Class
// =============================================================================

/**
 * @brief Central container for all entities and components
 *
 * @details The Registry provides:
 * - Entity lifecycle management (create, destroy, recycle)
 * - Component storage with O(1) access via SparseSet pools
 * - View-based queries for iterating entities with specific components
 *
 * @code
 * Registry registry;
 *
 * // Create entities and add components
 * Entity player = registry.create();
 * registry.emplace<Position>(player, 0.0f, 0.0f);
 * registry.emplace<Velocity>(player, 1.0f, 0.0f);
 *
 * // Query and iterate
 * for (auto [entity, pos, vel] : registry.view<Position, Velocity>().each()) {
 *     pos.x += vel.x * deltaTime;
 * }
 * @endcode
 */
class Registry {
public:
    Registry() = default;
    ~Registry() = default;

    // Non-copyable, movable
    Registry(const Registry&) = delete;
    Registry& operator=(const Registry&) = delete;
    Registry(Registry&&) noexcept = default;
    Registry& operator=(Registry&&) noexcept = default;

    // =========================================================================
    // Entity Management
    // =========================================================================

    /**
     * @brief Creates a new entity
     * @return A valid entity ID
     *
     * @details Recycles previously destroyed entities when available.
     *          New entities are allocated sequentially when no recycled
     *          entities exist.
     */
    Entity create() {
        Entity entity;
        if (!recycled_.empty()) {
            entity = recycled_.front();
            recycled_.pop();
        } else {
            entity = nextEntity_++;
        }

        if (entity >= entityValid_.size()) {
            entityValid_.resize(entity + 1, false);
        }
        entityValid_[entity] = true;

        ES_LOG_TRACE("Created entity {}", entity);
        return entity;
    }

    /**
     * @brief Creates multiple entities at once
     * @param count Number of entities to create
     * @return Vector containing all created entity IDs
     */
    std::vector<Entity> create(usize count) {
        std::vector<Entity> entities;
        entities.reserve(count);
        for (usize i = 0; i < count; ++i) {
            entities.push_back(create());
        }
        return entities;
    }

    /**
     * @brief Destroys an entity and removes all its components
     * @param entity The entity to destroy
     *
     * @details The entity ID is recycled for future use.
     *          All components attached to the entity are removed.
     */
    void destroy(Entity entity) {
        if (!valid(entity)) return;

        // Remove all components from this entity
        for (auto& [typeId, pool] : pools_) {
            pool->remove(entity);
        }

        entityValid_[entity] = false;
        recycled_.push(entity);

        ES_LOG_TRACE("Destroyed entity {}", entity);
    }

    /**
     * @brief Checks if an entity is currently valid
     * @param entity The entity to check
     * @return True if the entity exists and is not destroyed
     */
    bool valid(Entity entity) const {
        return entity < entityValid_.size() && entityValid_[entity];
    }

    /**
     * @brief Gets the number of active (non-destroyed) entities
     * @return Count of valid entities
     */
    usize entityCount() const {
        usize count = 0;
        for (bool valid : entityValid_) {
            if (valid) ++count;
        }
        return count;
    }

    // =========================================================================
    // Component Management
    // =========================================================================

    /**
     * @brief Adds a component to an entity with in-place construction
     * @tparam T The component type
     * @tparam Args Constructor argument types
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the newly created component
     *
     * @note Asserts if entity is invalid or already has the component
     */
    template<typename T, typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        ES_ASSERT(valid(entity), "Invalid entity");
        auto& pool = assurePool<T>();
        return pool.emplace(entity, std::forward<Args>(args)...);
    }

    /**
     * @brief Adds or replaces a component on an entity
     * @tparam T The component type
     * @tparam Args Constructor argument types
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor
     * @return Reference to the component
     *
     * @details If the entity already has the component, it is replaced.
     */
    template<typename T, typename... Args>
    T& emplaceOrReplace(Entity entity, Args&&... args) {
        ES_ASSERT(valid(entity), "Invalid entity");
        auto& pool = assurePool<T>();

        if (pool.contains(entity)) {
            pool.get(entity) = T(std::forward<Args>(args)...);
            return pool.get(entity);
        }
        return pool.emplace(entity, std::forward<Args>(args)...);
    }

    /**
     * @brief Removes a component from an entity
     * @tparam T The component type to remove
     * @param entity The target entity
     *
     * @details No-op if the entity doesn't have the component.
     */
    template<typename T>
    void remove(Entity entity) {
        auto* pool = getPool<T>();
        if (pool) {
            pool->remove(entity);
        }
    }

    /**
     * @brief Gets a component from an entity (must exist)
     * @tparam T The component type
     * @param entity The target entity
     * @return Reference to the component
     *
     * @note Asserts if the entity doesn't have the component
     */
    template<typename T>
    T& get(Entity entity) {
        auto* pool = getPool<T>();
        ES_ASSERT(pool != nullptr, "Component pool does not exist");
        return pool->get(entity);
    }

    /** @copydoc get() */
    template<typename T>
    const T& get(Entity entity) const {
        auto* pool = getPool<T>();
        ES_ASSERT(pool != nullptr, "Component pool does not exist");
        return pool->get(entity);
    }

    /**
     * @brief Tries to get a component from an entity
     * @tparam T The component type
     * @param entity The target entity
     * @return Pointer to the component, or nullptr if not found
     */
    template<typename T>
    T* tryGet(Entity entity) {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    /** @copydoc tryGet() */
    template<typename T>
    const T* tryGet(Entity entity) const {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    /**
     * @brief Gets an existing component or creates a new one
     * @tparam T The component type
     * @tparam Args Constructor argument types (for new component)
     * @param entity The target entity
     * @param args Arguments forwarded to T's constructor if creating
     * @return Reference to the component
     */
    template<typename T, typename... Args>
    T& getOrEmplace(Entity entity, Args&&... args) {
        auto& pool = assurePool<T>();
        if (pool.contains(entity)) {
            return pool.get(entity);
        }
        return pool.emplace(entity, std::forward<Args>(args)...);
    }

    /**
     * @brief Checks if an entity has a specific component
     * @tparam T The component type to check
     * @param entity The entity to check
     * @return True if the entity has the component
     */
    template<typename T>
    bool has(Entity entity) const {
        auto* pool = getPool<T>();
        return pool && pool->contains(entity);
    }

    /**
     * @brief Checks if an entity has all specified components
     * @tparam Ts The component types to check
     * @param entity The entity to check
     * @return True if the entity has all components
     */
    template<typename... Ts>
    bool hasAll(Entity entity) const {
        return (has<Ts>(entity) && ...);
    }

    /**
     * @brief Checks if an entity has any of the specified components
     * @tparam Ts The component types to check
     * @param entity The entity to check
     * @return True if the entity has at least one component
     */
    template<typename... Ts>
    bool hasAny(Entity entity) const {
        return (has<Ts>(entity) || ...);
    }

    // =========================================================================
    // View Query System
    // =========================================================================

    /**
     * @brief Creates a view for iterating entities with specific components
     * @tparam Components The component types to query
     * @return A View for iterating matching entities
     *
     * @code
     * // Single component view
     * for (auto entity : registry.view<Position>()) {
     *     auto& pos = registry.get<Position>(entity);
     * }
     *
     * // Multi-component view with structured bindings
     * for (auto [entity, pos, vel] : registry.view<Position, Velocity>().each()) {
     *     pos.x += vel.x * dt;
     * }
     * @endcode
     */
    template<typename... Components>
    View<Components...> view() {
        if constexpr (sizeof...(Components) == 1) {
            return View<Components...>(&assurePool<Components...>());
        } else {
            return View<Components...>(
                std::make_tuple(&assurePool<Components>()...));
        }
    }

    // =========================================================================
    // Utility
    // =========================================================================

    /**
     * @brief Clears all entities and components
     * @details Resets the registry to its initial empty state.
     */
    void clear() {
        for (auto& [typeId, pool] : pools_) {
            pool->clear();
        }
        entityValid_.clear();
        while (!recycled_.empty()) recycled_.pop();
        nextEntity_ = 0;
    }

    /**
     * @brief Executes a function for each entity with specified components
     * @tparam Components The required component types
     * @tparam Func The callback type
     * @param func Callback receiving (Entity, Component&...)
     *
     * @code
     * registry.each<Position, Velocity>([](Entity e, Position& p, Velocity& v) {
     *     p.x += v.x;
     * });
     * @endcode
     */
    template<typename... Components, typename Func>
    void each(Func&& func) {
        view<Components...>().each(std::forward<Func>(func));
    }

    /**
     * @brief Sorts components by a comparison function
     * @tparam T The component type to sort
     * @tparam Compare The comparison function type
     * @param compare Comparison function returning true if first < second
     *
     * @details Sorts the component pool so iteration order matches
     *          the comparison result.
     */
    template<typename T, typename Compare>
    void sort(Compare compare) {
        auto* pool = getPool<T>();
        if (!pool) return;

        // Selection sort
        auto& entities = const_cast<std::vector<Entity>&>(pool->entities());
        auto& components = pool->components();

        for (usize i = 0; i < entities.size(); ++i) {
            usize minIdx = i;
            for (usize j = i + 1; j < entities.size(); ++j) {
                if (compare(components[j], components[minIdx])) {
                    minIdx = j;
                }
            }
            if (minIdx != i) {
                std::swap(entities[i], entities[minIdx]);
                std::swap(components[i], components[minIdx]);
            }
        }
    }

private:
    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * @brief Gets or creates a component pool for type T
     * @tparam T The component type
     * @return Reference to the SparseSet for type T
     */
    template<typename T>
    SparseSet<T>& assurePool() {
        TypeId typeId = getTypeId<T>();
        auto it = pools_.find(typeId);
        if (it == pools_.end()) {
            auto pool = makeUnique<SparseSet<T>>();
            auto& ref = *pool;
            pools_[typeId] = std::move(pool);
            return ref;
        }
        return *static_cast<SparseSet<T>*>(it->second.get());
    }

    /**
     * @brief Gets an existing component pool (may return nullptr)
     * @tparam T The component type
     * @return Pointer to the SparseSet, or nullptr if not found
     */
    template<typename T>
    SparseSet<T>* getPool() {
        TypeId typeId = getTypeId<T>();
        auto it = pools_.find(typeId);
        if (it == pools_.end()) return nullptr;
        return static_cast<SparseSet<T>*>(it->second.get());
    }

    template<typename T>
    const SparseSet<T>* getPool() const {
        TypeId typeId = getTypeId<T>();
        auto it = pools_.find(typeId);
        if (it == pools_.end()) return nullptr;
        return static_cast<const SparseSet<T>*>(it->second.get());
    }

    // =========================================================================
    // Data Members
    // =========================================================================

    /** @brief Validity flags for each entity ID */
    std::vector<bool> entityValid_;
    /** @brief Queue of recycled entity IDs */
    std::queue<Entity> recycled_;
    /** @brief Next entity ID to allocate */
    Entity nextEntity_ = 0;

    /** @brief Type-erased component pools indexed by TypeId */
    std::unordered_map<TypeId, Unique<SparseSetBase>> pools_;
};

}  // namespace esengine::ecs
