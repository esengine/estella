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
#include "ComponentMask.hpp"
#include "Entity.hpp"
#include "SchemaComponent.hpp"
#include "SparseSet.hpp"
#include "View.hpp"

// Standard library
#include <any>
#include <functional>
#include <queue>

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
        u32 index;
        while (!recycled_.empty()) {
            index = recycled_.front();
            recycled_.pop();
            if (index < entityValid_.size() && entityValid_[index]) {
                continue;
            }
            return activateIndex(index);
        }
        index = next_index_++;
        return activateIndex(index);
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
     * @brief Restores an entity at a specific index
     * @param index The entity index to restore
     * @return The newly created Entity, or INVALID_ENTITY if index is already alive
     */
    Entity restore(u32 index) {
        if (index < entityValid_.size() && entityValid_[index]) {
            return INVALID_ENTITY;
        }

        if (index >= next_index_) {
            next_index_ = index + 1;
        }

        return activateIndex(index);
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

        const u32 idx = entity.index();

        for (auto& entry : on_destroy_entries_) {
            entry.callback(entity);
        }

        component_masks_[idx].forEachSet([&](u32 bit) {
            if (bit < pools_.size() && pools_[bit]) {
                pools_[bit]->remove(entity);
            }
        });

        schemaRegistry_.removeAll(entity);

        component_masks_[idx].reset();
        entityValid_[idx] = false;
        --entity_count_;
        recycled_.push(idx);

        ES_LOG_TRACE("Destroyed entity raw={} (index={})", entity.raw, idx);
    }

    using DestroyCallback = std::function<void(Entity)>;

    u32 onDestroy(DestroyCallback callback) {
        u32 id = next_callback_id_++;
        on_destroy_entries_.push_back({id, std::move(callback)});
        return id;
    }

    void removeOnDestroy(u32 callbackId) {
        for (usize i = 0; i < on_destroy_entries_.size(); ++i) {
            if (on_destroy_entries_[i].id == callbackId) {
                auto pos = static_cast<std::ptrdiff_t>(i);
                on_destroy_entries_.erase(on_destroy_entries_.begin() + pos);
                return;
            }
        }
    }

    /**
     * @brief Checks if an entity is currently valid
     * @param entity The entity to check
     * @return True if the entity exists and generation matches
     */
    bool valid(Entity entity) const {
        const u32 idx = entity.index();
        return idx < entityValid_.size() &&
               entityValid_[idx] &&
               generations_[idx] == entity.generation();
    }

    /** @brief Gets the packed u64 handle (for legacy/FFI compatibility) */
    u64 entityHandle(Entity entity) const {
        return makeEntityHandle(entity.index(), entity.generation());
    }

    usize entityCount() const {
        return entity_count_;
    }

    /**
     * @brief Executes a function for each valid entity
     * @tparam Func The callback type
     * @param func Callback receiving Entity
     */
    template<typename Func>
    void forEachEntity(Func&& func) const {
        for (u32 i = 0; i < entityValid_.size(); ++i) {
            if (entityValid_[i]) {
                func(Entity::make(i, generations_[i]));
            }
        }
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
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(getTypeId<T>());
        return result;
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
            auto& comp = pool.get(entity);
            comp = T(std::forward<Args>(args)...);
            return comp;
        }
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(getTypeId<T>());
        return result;
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
            const u32 idx = entity.index();
            if (idx < component_masks_.size()) {
                component_masks_[idx].clear(getTypeId<T>());
            }
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
        auto& result = pool.emplace(entity, std::forward<Args>(args)...);
        component_masks_[entity.index()].set(getTypeId<T>());
        return result;
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
        for (auto& pool : pools_) {
            if (pool) {
                pool->clear();
            }
        }
        entityValid_.clear();
        generations_.clear();
        component_masks_.clear();
        while (!recycled_.empty()) recycled_.pop();
        next_index_ = 0;
        entity_count_ = 0;
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

        auto& entities = pool->entities();
        auto& components = pool->components();
        usize n = entities.size();
        if (n <= 1) return;

        std::vector<usize> perm(n);
        for (usize i = 0; i < n; ++i) perm[i] = i;

        std::sort(perm.begin(), perm.end(), [&](usize a, usize b) {
            return compare(components[a], components[b]);
        });

        for (usize i = 0; i < n; ++i) {
            if (perm[i] == i) continue;

            usize j = i;
            Entity tmpEntity = std::move(entities[i]);
            T tmpComponent = std::move(components[i]);

            while (perm[j] != i) {
                usize src = perm[j];
                entities[j] = std::move(entities[src]);
                components[j] = std::move(components[src]);
                perm[j] = j;
                j = src;
            }

            entities[j] = std::move(tmpEntity);
            components[j] = std::move(tmpComponent);
            perm[j] = j;
        }
        pool->rebuildSparse();
    }

    // =========================================================================
    // Schema Component Management (Script-defined, direct memory access)
    // =========================================================================

    /** @brief Registers a schema component pool */
    u32 registerSchemaPool(const std::string& name, u32 stride) {
        return schemaRegistry_.registerPool(name, stride);
    }

    /** @brief Gets schema pool ID by name */
    u32 getSchemaPoolId(const std::string& name) const {
        return schemaRegistry_.getPoolId(name);
    }

    /** @brief Adds schema component to entity, returns byte offset */
    u32 addSchemaComponent(u32 poolId, Entity entity) {
        ES_ASSERT(valid(entity), "Invalid entity");
        return schemaRegistry_.addComponent(poolId, entity);
    }

    /** @brief Checks if entity has schema component */
    bool hasSchemaComponent(u32 poolId, Entity entity) const {
        return schemaRegistry_.hasComponent(poolId, entity);
    }

    /** @brief Gets byte offset of entity's schema component */
    u32 getSchemaComponentOffset(u32 poolId, Entity entity) const {
        return schemaRegistry_.getComponentOffset(poolId, entity);
    }

    /** @brief Removes schema component from entity */
    void removeSchemaComponent(u32 poolId, Entity entity) {
        schemaRegistry_.removeComponent(poolId, entity);
    }

    /** @brief Gets base pointer for schema pool (for JS direct access) */
    uintptr_t getSchemaPoolBasePtr(u32 poolId) const {
        return schemaRegistry_.getPoolBasePtr(poolId);
    }

    /** @brief Gets stride for schema pool */
    u32 getSchemaPoolStride(u32 poolId) const {
        return schemaRegistry_.getPoolStride(poolId);
    }

    /** @brief Gets schema pool version (detects reallocation) */
    u32 getSchemaPoolVersion(u32 poolId) const {
        return schemaRegistry_.getPoolVersion(poolId);
    }

    /** @brief Gets entities with schema component */
    const std::vector<Entity>& getSchemaEntities(u32 poolId) const {
        return schemaRegistry_.getEntities(poolId);
    }

    /** @brief Gets the schema registry */
    SchemaRegistry& schemaRegistry() { return schemaRegistry_; }
    const SchemaRegistry& schemaRegistry() const { return schemaRegistry_; }

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
        if (typeId >= pools_.size()) {
            pools_.resize(typeId + 1);
        }
        if (!pools_[typeId]) {
            pools_[typeId] = makeUnique<SparseSet<T>>();
        }
        return *static_cast<SparseSet<T>*>(pools_[typeId].get());
    }

    /**
     * @brief Gets an existing component pool (may return nullptr)
     * @tparam T The component type
     * @return Pointer to the SparseSet, or nullptr if not found
     */
    template<typename T>
    SparseSet<T>* getPool() {
        TypeId typeId = getTypeId<T>();
        if (typeId >= pools_.size() || !pools_[typeId]) return nullptr;
        return static_cast<SparseSet<T>*>(pools_[typeId].get());
    }

    template<typename T>
    const SparseSet<T>* getPool() const {
        TypeId typeId = getTypeId<T>();
        if (typeId >= pools_.size() || !pools_[typeId]) return nullptr;
        return static_cast<const SparseSet<T>*>(pools_[typeId].get());
    }

    /**
     * @brief Activates an entity index: resizes arrays, bumps generation, returns packed Entity
     */
    Entity activateIndex(u32 index) {
        ES_ASSERT(index <= Entity::INDEX_MASK, "Entity index overflow (20-bit limit exceeded)");
        if (index >= entityValid_.size()) {
            entityValid_.resize(index + 1, false);
            generations_.resize(index + 1, 0);
            component_masks_.resize(index + 1);
        }
        entityValid_[index] = true;
        generations_[index] = (generations_[index] + 1) & Entity::GEN_MASK;
        if (generations_[index] == 0) generations_[index] = 1;
        component_masks_[index].reset();
        ++entity_count_;
        return Entity::make(index, generations_[index]);
    }

    // =========================================================================
    // Data Members
    // =========================================================================

    std::vector<u8> entityValid_;
    std::vector<u32> generations_;
    std::vector<ComponentMask> component_masks_;
    std::queue<u32> recycled_;      ///< Recycled entity indices
    u32 next_index_ = 0;            ///< Next fresh entity index
    usize entity_count_ = 0;

    /** @brief Type-erased component pools indexed by TypeId */
    std::vector<Unique<SparseSetBase>> pools_;

    /** @brief Schema component registry for script-defined components */
    SchemaRegistry schemaRegistry_;

    struct DestroyEntry {
        u32 id;
        DestroyCallback callback;
    };

    std::vector<DestroyEntry> on_destroy_entries_;
    u32 next_callback_id_ = 0;
};

}  // namespace esengine::ecs
