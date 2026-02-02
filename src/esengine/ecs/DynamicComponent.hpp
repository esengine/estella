/**
 * @file    DynamicComponent.hpp
 * @brief   Dynamic component storage for script-defined components
 * @details Provides type-erased component storage that allows TypeScript
 *          to define and use custom components without C++ compile-time types.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../core/Types.hpp"
#include "Entity.hpp"
#include "SparseSet.hpp"

#include <any>
#include <string>
#include <unordered_map>
#include <vector>

#ifdef ES_PLATFORM_WEB
#include <emscripten/val.h>
#endif

namespace esengine::ecs {

// =============================================================================
// DynamicValue
// =============================================================================

#ifdef ES_PLATFORM_WEB
using DynamicValue = emscripten::val;
#else
using DynamicValue = std::any;
#endif

// =============================================================================
// DynamicComponentPool
// =============================================================================

/**
 * @brief Storage for a single dynamic component type
 *
 * @details Uses SparseSet-like storage to efficiently store script-defined
 *          component data. On Web platform, stores emscripten::val directly
 *          to minimize JS/C++ boundary crossing overhead.
 */
class DynamicComponentPool {
public:
    DynamicComponentPool() = default;
    ~DynamicComponentPool() = default;

    DynamicComponentPool(const DynamicComponentPool&) = delete;
    DynamicComponentPool& operator=(const DynamicComponentPool&) = delete;
    DynamicComponentPool(DynamicComponentPool&&) noexcept = default;
    DynamicComponentPool& operator=(DynamicComponentPool&&) noexcept = default;

    // =========================================================================
    // Lookup Operations
    // =========================================================================

    /** @brief Checks if entity has this component */
    bool contains(Entity entity) const {
        return entity < sparse_.size() &&
               sparse_[entity] < dense_.size() &&
               dense_[sparse_[entity]] == entity;
    }

    /** @brief Gets component data (must exist) */
    DynamicValue& get(Entity entity) {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return values_[sparse_[entity]];
    }

    /** @brief Gets component data (const) */
    const DynamicValue& get(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return values_[sparse_[entity]];
    }

    /** @brief Tries to get component data (returns nullptr if not found) */
    DynamicValue* tryGet(Entity entity) {
        if (!contains(entity)) return nullptr;
        return &values_[sparse_[entity]];
    }

    // =========================================================================
    // Modification Operations
    // =========================================================================

    /** @brief Adds component data to entity */
    void emplace(Entity entity, DynamicValue value) {
        ES_ASSERT(!contains(entity), "Entity already has component");

        if (entity >= sparse_.size()) {
            sparse_.resize(entity + 1, INVALID_ENTITY);
        }

        sparse_[entity] = static_cast<Entity>(dense_.size());
        dense_.push_back(entity);
        values_.push_back(std::move(value));
    }

    /** @brief Adds or replaces component data */
    void emplaceOrReplace(Entity entity, DynamicValue value) {
        if (contains(entity)) {
            values_[sparse_[entity]] = std::move(value);
        } else {
            emplace(entity, std::move(value));
        }
    }

    /** @brief Removes component from entity */
    void remove(Entity entity) {
        if (!contains(entity)) return;

        const auto last = dense_.back();
        const auto index = sparse_[entity];

        dense_[index] = last;
        values_[index] = std::move(values_.back());
        sparse_[last] = index;

        dense_.pop_back();
        values_.pop_back();
        sparse_[entity] = INVALID_ENTITY;
    }

    // =========================================================================
    // Container Operations
    // =========================================================================

    usize size() const { return dense_.size(); }
    bool empty() const { return dense_.empty(); }

    void clear() {
        sparse_.clear();
        dense_.clear();
        values_.clear();
    }

    const std::vector<Entity>& entities() const { return dense_; }

private:
    std::vector<Entity> sparse_;
    std::vector<Entity> dense_;
    std::vector<DynamicValue> values_;
};

// =============================================================================
// DynamicComponentRegistry
// =============================================================================

/**
 * @brief Manages all dynamic component pools
 *
 * @details Provides a central registry for script-defined components,
 *          allowing TypeScript to create and manage components by name
 *          without requiring C++ type definitions.
 */
class DynamicComponentRegistry {
public:
    DynamicComponentRegistry() = default;
    ~DynamicComponentRegistry() = default;

    // =========================================================================
    // Component Type Registration
    // =========================================================================

    /**
     * @brief Registers a new dynamic component type
     * @param name Unique name for the component type
     * @return Component type ID for fast lookup
     */
    u32 registerComponent(const std::string& name) {
        auto it = nameToId_.find(name);
        if (it != nameToId_.end()) {
            return it->second;
        }

        u32 id = static_cast<u32>(pools_.size());
        pools_.emplace_back();
        nameToId_[name] = id;
        idToName_[id] = name;
        return id;
    }

    /** @brief Gets component ID by name (returns UINT32_MAX if not found) */
    u32 getComponentId(const std::string& name) const {
        auto it = nameToId_.find(name);
        return it != nameToId_.end() ? it->second : UINT32_MAX;
    }

    /** @brief Gets component name by ID */
    const std::string& getComponentName(u32 id) const {
        static const std::string empty;
        auto it = idToName_.find(id);
        return it != idToName_.end() ? it->second : empty;
    }

    /** @brief Checks if component type is registered */
    bool isRegistered(const std::string& name) const {
        return nameToId_.find(name) != nameToId_.end();
    }

    // =========================================================================
    // Component Operations (by ID)
    // =========================================================================

    bool has(Entity entity, u32 componentId) const {
        if (componentId >= pools_.size()) return false;
        return pools_[componentId].contains(entity);
    }

    DynamicValue& get(Entity entity, u32 componentId) {
        ES_ASSERT(componentId < pools_.size(), "Invalid component ID");
        return pools_[componentId].get(entity);
    }

    const DynamicValue& get(Entity entity, u32 componentId) const {
        ES_ASSERT(componentId < pools_.size(), "Invalid component ID");
        return pools_[componentId].get(entity);
    }

    void add(Entity entity, u32 componentId, DynamicValue value) {
        ES_ASSERT(componentId < pools_.size(), "Invalid component ID");
        pools_[componentId].emplaceOrReplace(entity, std::move(value));
    }

    void remove(Entity entity, u32 componentId) {
        if (componentId < pools_.size()) {
            pools_[componentId].remove(entity);
        }
    }

    // =========================================================================
    // Component Operations (by name)
    // =========================================================================

    bool hasByName(Entity entity, const std::string& name) const {
        u32 id = getComponentId(name);
        return id != UINT32_MAX && has(entity, id);
    }

    DynamicValue* getByName(Entity entity, const std::string& name) {
        u32 id = getComponentId(name);
        if (id == UINT32_MAX) return nullptr;
        return pools_[id].tryGet(entity);
    }

    void addByName(Entity entity, const std::string& name, DynamicValue value) {
        u32 id = registerComponent(name);
        pools_[id].emplaceOrReplace(entity, std::move(value));
    }

    void removeByName(Entity entity, const std::string& name) {
        u32 id = getComponentId(name);
        if (id != UINT32_MAX) {
            pools_[id].remove(entity);
        }
    }

    // =========================================================================
    // Entity Operations
    // =========================================================================

    /** @brief Removes all dynamic components from entity */
    void removeAll(Entity entity) {
        for (auto& pool : pools_) {
            pool.remove(entity);
        }
    }

    // =========================================================================
    // Query Operations
    // =========================================================================

    /** @brief Gets all entities with a specific dynamic component */
    const std::vector<Entity>& entitiesWith(u32 componentId) const {
        static const std::vector<Entity> empty;
        if (componentId >= pools_.size()) return empty;
        return pools_[componentId].entities();
    }

    /** @brief Gets pool for direct access */
    DynamicComponentPool* getPool(u32 componentId) {
        if (componentId >= pools_.size()) return nullptr;
        return &pools_[componentId];
    }

    const DynamicComponentPool* getPool(u32 componentId) const {
        if (componentId >= pools_.size()) return nullptr;
        return &pools_[componentId];
    }

    // =========================================================================
    // Utility
    // =========================================================================

    void clear() {
        for (auto& pool : pools_) {
            pool.clear();
        }
    }

    usize componentTypeCount() const { return pools_.size(); }

private:
    std::vector<DynamicComponentPool> pools_;
    std::unordered_map<std::string, u32> nameToId_;
    std::unordered_map<u32, std::string> idToName_;
};

}  // namespace esengine::ecs
