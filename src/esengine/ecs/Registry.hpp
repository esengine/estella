#pragma once

#include "../core/Log.hpp"
#include "../core/Types.hpp"
#include "Entity.hpp"
#include "SparseSet.hpp"
#include "View.hpp"
#include <any>
#include <functional>
#include <unordered_map>
#include <queue>

namespace esengine::ecs {

// Registry - The main container for all entities and components
class Registry {
public:
    Registry() = default;
    ~Registry() = default;

    // Non-copyable, movable
    Registry(const Registry&) = delete;
    Registry& operator=(const Registry&) = delete;
    Registry(Registry&&) noexcept = default;
    Registry& operator=(Registry&&) noexcept = default;

    // ========================================
    // Entity Management
    // ========================================

    // Create a new entity
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

    // Create multiple entities
    std::vector<Entity> create(usize count) {
        std::vector<Entity> entities;
        entities.reserve(count);
        for (usize i = 0; i < count; ++i) {
            entities.push_back(create());
        }
        return entities;
    }

    // Destroy an entity
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

    // Check if entity is valid
    bool valid(Entity entity) const {
        return entity < entityValid_.size() && entityValid_[entity];
    }

    // Get number of active entities
    usize entityCount() const {
        usize count = 0;
        for (bool valid : entityValid_) {
            if (valid) ++count;
        }
        return count;
    }

    // ========================================
    // Component Management
    // ========================================

    // Add component to entity (in-place construction)
    template<typename T, typename... Args>
    T& emplace(Entity entity, Args&&... args) {
        ES_ASSERT(valid(entity), "Invalid entity");
        auto& pool = assurePool<T>();
        return pool.emplace(entity, std::forward<Args>(args)...);
    }

    // Add or replace component
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

    // Remove component from entity
    template<typename T>
    void remove(Entity entity) {
        auto* pool = getPool<T>();
        if (pool) {
            pool->remove(entity);
        }
    }

    // Get component (must exist)
    template<typename T>
    T& get(Entity entity) {
        auto* pool = getPool<T>();
        ES_ASSERT(pool != nullptr, "Component pool does not exist");
        return pool->get(entity);
    }

    template<typename T>
    const T& get(Entity entity) const {
        auto* pool = getPool<T>();
        ES_ASSERT(pool != nullptr, "Component pool does not exist");
        return pool->get(entity);
    }

    // Try to get component (may return nullptr)
    template<typename T>
    T* tryGet(Entity entity) {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    template<typename T>
    const T* tryGet(Entity entity) const {
        auto* pool = getPool<T>();
        return pool ? pool->tryGet(entity) : nullptr;
    }

    // Get or add component
    template<typename T, typename... Args>
    T& getOrEmplace(Entity entity, Args&&... args) {
        auto& pool = assurePool<T>();
        if (pool.contains(entity)) {
            return pool.get(entity);
        }
        return pool.emplace(entity, std::forward<Args>(args)...);
    }

    // Check if entity has component
    template<typename T>
    bool has(Entity entity) const {
        auto* pool = getPool<T>();
        return pool && pool->contains(entity);
    }

    // Check if entity has all specified components
    template<typename... Ts>
    bool hasAll(Entity entity) const {
        return (has<Ts>(entity) && ...);
    }

    // Check if entity has any of specified components
    template<typename... Ts>
    bool hasAny(Entity entity) const {
        return (has<Ts>(entity) || ...);
    }

    // ========================================
    // View (Query) System
    // ========================================

    // Get view for iterating entities with specific components
    template<typename... Components>
    View<Components...> view() {
        if constexpr (sizeof...(Components) == 1) {
            return View<Components...>(&assurePool<Components...>());
        } else {
            return View<Components...>(
                std::make_tuple(&assurePool<Components>()...));
        }
    }

    // ========================================
    // Utility
    // ========================================

    // Clear all entities and components
    void clear() {
        for (auto& [typeId, pool] : pools_) {
            pool->clear();
        }
        entityValid_.clear();
        while (!recycled_.empty()) recycled_.pop();
        nextEntity_ = 0;
    }

    // Execute function for each entity with components
    template<typename... Components, typename Func>
    void each(Func&& func) {
        view<Components...>().each(std::forward<Func>(func));
    }

    // Sort components by entity order
    template<typename T, typename Compare>
    void sort(Compare compare) {
        auto* pool = getPool<T>();
        if (!pool) return;

        // Simple selection sort for now
        // Could be optimized with more sophisticated algorithms
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
    // Get or create component pool
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

    // Get existing pool (may return nullptr)
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

    // Entity storage
    std::vector<bool> entityValid_;
    std::queue<Entity> recycled_;
    Entity nextEntity_ = 0;

    // Component pools (type-erased)
    std::unordered_map<TypeId, Unique<SparseSetBase>> pools_;
};

}  // namespace esengine::ecs
