/**
 * @file    SchemaComponent.hpp
 * @brief   Schema-based component storage with direct memory access
 * @details Provides zero-copy component access from TypeScript by storing
 *          component data in WASM linear memory with a defined layout.
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

#include <cstring>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::ecs {

// =============================================================================
// SchemaComponentPool
// =============================================================================

/**
 * @brief Component pool with fixed-stride memory layout for direct JS access
 *
 * @details Stores component data in a contiguous memory block that can be
 *          directly accessed from TypeScript via WASM HEAP. Each component
 *          occupies exactly `stride` bytes.
 *
 *          Memory layout:
 *          ┌────────────┬────────────┬────────────┬─────┐
 *          │ Component0 │ Component1 │ Component2 │ ... │
 *          └────────────┴────────────┴────────────┴─────┘
 *          │<- stride ->│
 */
class SchemaComponentPool {
public:
    explicit SchemaComponentPool(u32 stride, u32 initialCapacity = 64)
        : stride_(stride) {
        data_.reserve(initialCapacity * stride);
    }

    ~SchemaComponentPool() = default;

    SchemaComponentPool(const SchemaComponentPool&) = delete;
    SchemaComponentPool& operator=(const SchemaComponentPool&) = delete;
    SchemaComponentPool(SchemaComponentPool&&) noexcept = default;
    SchemaComponentPool& operator=(SchemaComponentPool&&) noexcept = default;

    // =========================================================================
    // Component Operations
    // =========================================================================

    /**
     * @brief Adds a component to an entity
     * @param entity The entity to add component to
     * @return Byte offset of the component data in the pool
     */
    u32 add(Entity entity) {
        if (contains(entity)) {
            return getOffset(entity);
        }

        if (entity >= sparse_.size()) {
            sparse_.resize(entity + 1, INVALID_ENTITY);
        }

        u32 index = static_cast<u32>(dense_.size());
        sparse_[entity] = index;
        dense_.push_back(entity);

        // Allocate space for component data (zero-initialized)
        usize oldSize = data_.size();
        data_.resize(oldSize + stride_, 0);

        return static_cast<u32>(oldSize);
    }

    /**
     * @brief Gets the byte offset of an entity's component data
     * @param entity The entity
     * @return Byte offset in the data buffer
     */
    u32 getOffset(Entity entity) const {
        ES_ASSERT(contains(entity), "Entity does not have component");
        return sparse_[entity] * stride_;
    }

    /**
     * @brief Checks if entity has this component
     */
    bool contains(Entity entity) const {
        return entity < sparse_.size() &&
               sparse_[entity] < dense_.size() &&
               dense_[sparse_[entity]] == entity;
    }

    /**
     * @brief Removes component from entity
     */
    void remove(Entity entity) {
        if (!contains(entity)) return;

        u32 index = sparse_[entity];
        Entity lastEntity = dense_.back();
        u32 lastIndex = static_cast<u32>(dense_.size() - 1);

        // Swap data
        if (index != lastIndex) {
            u8* dstPtr = data_.data() + index * stride_;
            u8* srcPtr = data_.data() + lastIndex * stride_;
            std::memcpy(dstPtr, srcPtr, stride_);

            dense_[index] = lastEntity;
            sparse_[lastEntity] = index;
        }

        dense_.pop_back();
        data_.resize(data_.size() - stride_);
        sparse_[entity] = INVALID_ENTITY;
    }

    // =========================================================================
    // Memory Access
    // =========================================================================

    /** @brief Gets base pointer for direct memory access from JS */
    uintptr_t basePtr() const {
        return reinterpret_cast<uintptr_t>(data_.data());
    }

    /** @brief Gets the stride (bytes per component) */
    u32 stride() const { return stride_; }

    /** @brief Gets number of components */
    usize size() const { return dense_.size(); }

    /** @brief Gets entity at dense index */
    Entity entityAt(usize index) const { return dense_[index]; }

    /** @brief Gets all entities */
    const std::vector<Entity>& entities() const { return dense_; }

    /** @brief Clears all components */
    void clear() {
        sparse_.clear();
        dense_.clear();
        data_.clear();
    }

    /**
     * @brief Gets raw pointer to component data (for C++ access)
     * @param entity The entity
     * @return Pointer to component data
     */
    u8* getData(Entity entity) {
        return data_.data() + getOffset(entity);
    }

    const u8* getData(Entity entity) const {
        return data_.data() + getOffset(entity);
    }

private:
    u32 stride_;                    ///< Bytes per component
    std::vector<u8> data_;          ///< Contiguous component data
    std::vector<u32> sparse_;       ///< Entity -> dense index
    std::vector<Entity> dense_;     ///< Dense entity array
};

// =============================================================================
// SchemaRegistry
// =============================================================================

/**
 * @brief Registry for schema-based component pools
 */
class SchemaRegistry {
public:
    SchemaRegistry() = default;
    ~SchemaRegistry() = default;

    // =========================================================================
    // Pool Management
    // =========================================================================

    /**
     * @brief Registers a new component type
     * @param name Component type name
     * @param stride Bytes per component
     * @return Pool ID for fast access
     */
    u32 registerPool(const std::string& name, u32 stride) {
        auto it = nameToId_.find(name);
        if (it != nameToId_.end()) {
            return it->second;
        }

        u32 id = static_cast<u32>(pools_.size());
        pools_.push_back(makeUnique<SchemaComponentPool>(stride));
        nameToId_[name] = id;
        idToName_[id] = name;
        return id;
    }

    /** @brief Gets pool ID by name */
    u32 getPoolId(const std::string& name) const {
        auto it = nameToId_.find(name);
        return it != nameToId_.end() ? it->second : UINT32_MAX;
    }

    /** @brief Gets pool by ID */
    SchemaComponentPool* getPool(u32 id) {
        return id < pools_.size() ? pools_[id].get() : nullptr;
    }

    const SchemaComponentPool* getPool(u32 id) const {
        return id < pools_.size() ? pools_[id].get() : nullptr;
    }

    // =========================================================================
    // Component Operations
    // =========================================================================

    /**
     * @brief Adds component to entity
     * @return Byte offset in pool's data buffer
     */
    u32 addComponent(u32 poolId, Entity entity) {
        ES_ASSERT(poolId < pools_.size(), "Invalid pool ID");
        return pools_[poolId]->add(entity);
    }

    bool hasComponent(u32 poolId, Entity entity) const {
        if (poolId >= pools_.size()) return false;
        return pools_[poolId]->contains(entity);
    }

    u32 getComponentOffset(u32 poolId, Entity entity) const {
        ES_ASSERT(poolId < pools_.size(), "Invalid pool ID");
        return pools_[poolId]->getOffset(entity);
    }

    void removeComponent(u32 poolId, Entity entity) {
        if (poolId < pools_.size()) {
            pools_[poolId]->remove(entity);
        }
    }

    /** @brief Gets base pointer for a pool */
    uintptr_t getPoolBasePtr(u32 poolId) const {
        if (poolId >= pools_.size()) return 0;
        return pools_[poolId]->basePtr();
    }

    /** @brief Gets stride for a pool */
    u32 getPoolStride(u32 poolId) const {
        if (poolId >= pools_.size()) return 0;
        return pools_[poolId]->stride();
    }

    /** @brief Gets entities with component */
    const std::vector<Entity>& getEntities(u32 poolId) const {
        static const std::vector<Entity> empty;
        if (poolId >= pools_.size()) return empty;
        return pools_[poolId]->entities();
    }

    // =========================================================================
    // Entity Cleanup
    // =========================================================================

    /** @brief Removes all components from an entity */
    void removeAll(Entity entity) {
        for (auto& pool : pools_) {
            pool->remove(entity);
        }
    }

    /** @brief Clears all pools */
    void clear() {
        for (auto& pool : pools_) {
            pool->clear();
        }
    }

    usize poolCount() const { return pools_.size(); }

private:
    std::vector<Unique<SchemaComponentPool>> pools_;
    std::unordered_map<std::string, u32> nameToId_;
    std::unordered_map<u32, std::string> idToName_;
};

}  // namespace esengine::ecs
