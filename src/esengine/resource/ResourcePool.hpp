/**
 * @file    ResourcePool.hpp
 * @brief   Type-erased resource pool with reference counting
 * @details Manages collections of GPU resources with handle-based access,
 *          reference counting, and optional path-based caching.
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

// Project includes
#include "../core/Types.hpp"
#include "Handle.hpp"

// Standard library
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::resource {

// =============================================================================
// ResourcePoolBase
// =============================================================================

/**
 * @brief Abstract base class for resource pools
 *
 * @details Provides a type-erased interface for managing resource pools,
 *          allowing ResourceManager to handle different resource types
 *          uniformly.
 */
class ResourcePoolBase {
public:
    virtual ~ResourcePoolBase() = default;

    /**
     * @brief Releases a resource by ID
     * @param id The resource identifier
     */
    virtual void release(u32 id) = 0;

    /**
     * @brief Gets the number of active resources
     * @return Count of non-freed resources
     */
    virtual usize size() const = 0;

    /**
     * @brief Releases all resources
     */
    virtual void clear() = 0;
};

// =============================================================================
// ResourcePool Template
// =============================================================================

/**
 * @brief Typed resource pool with reference counting
 *
 * @details Stores resources in a dense array with a free list for recycling
 *          slots. Supports optional path-based caching for deduplication.
 *
 * @tparam T The resource type to manage (must be movable)
 *
 * @code
 * ResourcePool<Shader> shaders;
 * auto handle = shaders.add(Shader::create(...), "shaders/color.glsl");
 * Shader* ptr = shaders.get(handle);
 * shaders.release(handle.id());
 * @endcode
 */
template<typename T>
class ResourcePool : public ResourcePoolBase {
public:
    /**
     * @brief Entry storing a resource with metadata
     */
    struct Entry {
        Unique<T> resource;    ///< The owned resource
        u32 refCount = 0;      ///< Reference count (0 = freed)
        std::string path;      ///< Optional path for caching
    };

    ResourcePool() = default;
    ~ResourcePool() override = default;

    // Non-copyable, movable
    ResourcePool(const ResourcePool&) = delete;
    ResourcePool& operator=(const ResourcePool&) = delete;
    ResourcePool(ResourcePool&&) = default;
    ResourcePool& operator=(ResourcePool&&) = default;

    /**
     * @brief Adds a resource to the pool
     * @param resource The resource to add (takes ownership)
     * @param path Optional path for cache lookup
     * @return Handle to the added resource
     */
    Handle<T> add(Unique<T> resource, const std::string& path = "") {
        u32 id;
        if (!freeList_.empty()) {
            id = freeList_.back();
            freeList_.pop_back();
            entries_[id] = {std::move(resource), 1, path};
        } else {
            id = static_cast<u32>(entries_.size());
            entries_.push_back({std::move(resource), 1, path});
        }
        if (!path.empty()) {
            pathToId_[path] = id;
        }
        return Handle<T>(id);
    }

    /**
     * @brief Gets a resource by handle
     * @param handle The resource handle
     * @return Pointer to the resource, or nullptr if invalid
     */
    T* get(Handle<T> handle) {
        if (!handle.isValid() || handle.id() >= entries_.size()) {
            return nullptr;
        }
        auto& entry = entries_[handle.id()];
        return entry.refCount > 0 ? entry.resource.get() : nullptr;
    }

    /**
     * @brief Gets a resource by handle (const)
     * @param handle The resource handle
     * @return Const pointer to the resource, or nullptr if invalid
     */
    const T* get(Handle<T> handle) const {
        if (!handle.isValid() || handle.id() >= entries_.size()) {
            return nullptr;
        }
        const auto& entry = entries_[handle.id()];
        return entry.refCount > 0 ? entry.resource.get() : nullptr;
    }

    /**
     * @brief Finds a resource by its cached path
     * @param path The path to look up
     * @return Handle to the resource, or invalid handle if not found
     */
    Handle<T> findByPath(const std::string& path) const {
        auto it = pathToId_.find(path);
        return it != pathToId_.end() ? Handle<T>(it->second) : Handle<T>();
    }

    /**
     * @brief Increments the reference count for a resource
     * @param handle The resource handle
     */
    void addRef(Handle<T> handle) {
        if (handle.isValid() && handle.id() < entries_.size()) {
            auto& entry = entries_[handle.id()];
            if (entry.refCount > 0) {
                entry.refCount++;
            }
        }
    }

    /**
     * @brief Decrements the reference count and frees if zero
     * @param id The resource identifier
     */
    void release(u32 id) override {
        if (id < entries_.size() && entries_[id].refCount > 0) {
            if (--entries_[id].refCount == 0) {
                if (!entries_[id].path.empty()) {
                    pathToId_.erase(entries_[id].path);
                }
                entries_[id].resource.reset();
                entries_[id].path.clear();
                freeList_.push_back(id);
            }
        }
    }

    /**
     * @brief Gets the number of active resources
     * @return Count of non-freed resources
     */
    usize size() const override {
        return entries_.size() - freeList_.size();
    }

    /**
     * @brief Releases all resources
     */
    void clear() override {
        entries_.clear();
        freeList_.clear();
        pathToId_.clear();
    }

    /**
     * @brief Gets the current reference count for a resource
     * @param handle The resource handle
     * @return Reference count, or 0 if invalid
     */
    u32 getRefCount(Handle<T> handle) const {
        if (!handle.isValid() || handle.id() >= entries_.size()) {
            return 0;
        }
        return entries_[handle.id()].refCount;
    }

private:
    std::vector<Entry> entries_;
    std::vector<u32> freeList_;
    std::unordered_map<std::string, u32> pathToId_;
};

}  // namespace esengine::resource
