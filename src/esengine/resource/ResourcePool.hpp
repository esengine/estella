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
        u32 generation = 0;    ///< Reuse counter for stale handle detection
    };

    ResourcePool() {
        entries_.push_back({nullptr, 0, "", 0});
    }
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
        u32 index;
        u32 gen;
        if (!freeList_.empty()) {
            index = freeList_.back();
            freeList_.pop_back();
            gen = entries_[index].generation;
            entries_[index] = {std::move(resource), 1, path, gen};
        } else {
            index = static_cast<u32>(entries_.size());
            gen = 0;
            entries_.push_back({std::move(resource), 1, path, 0});
        }
        auto handle = Handle<T>::fromParts(index, gen);
        if (!path.empty()) {
            pathToId_[path] = handle.id();
        }
        return handle;
    }

    /**
     * @brief Gets a resource by handle
     * @param handle The resource handle
     * @return Pointer to the resource, or nullptr if invalid
     */
    T* get(Handle<T> handle) {
        if (!handle.isValid()) return nullptr;
        u32 idx = handle.index();
        if (idx >= entries_.size()) return nullptr;
        auto& entry = entries_[idx];
        if (entry.refCount == 0 || entry.generation != handle.generation()) {
            return nullptr;
        }
        return entry.resource.get();
    }

    /**
     * @brief Gets a resource by handle (const)
     * @param handle The resource handle
     * @return Const pointer to the resource, or nullptr if invalid
     */
    const T* get(Handle<T> handle) const {
        if (!handle.isValid()) return nullptr;
        u32 idx = handle.index();
        if (idx >= entries_.size()) return nullptr;
        const auto& entry = entries_[idx];
        if (entry.refCount == 0 || entry.generation != handle.generation()) {
            return nullptr;
        }
        return entry.resource.get();
    }

    /**
     * @brief Finds a resource by its cached path
     * @param path The path to look up
     * @return Handle to the resource, or invalid handle if not found
     */
    Handle<T> findByPath(const std::string& path) const {
        auto it = pathToId_.find(path);
        if (it == pathToId_.end()) return Handle<T>();
        auto handle = Handle<T>(it->second);
        u32 idx = handle.index();
        if (idx < entries_.size() && entries_[idx].generation == handle.generation()) {
            return handle;
        }
        return Handle<T>();
    }

    /**
     * @brief Associates a path with an existing resource
     * @param handle The resource handle
     * @param path The path to associate
     */
    void setPath(Handle<T> handle, const std::string& path) {
        if (!handle.isValid()) return;
        u32 idx = handle.index();
        if (idx >= entries_.size()) return;
        auto& entry = entries_[idx];
        if (entry.refCount > 0 && entry.generation == handle.generation() && !path.empty()) {
            if (!entry.path.empty()) {
                pathToId_.erase(entry.path);
            }
            entry.path = path;
            pathToId_[path] = handle.id();
        }
    }

    /**
     * @brief Increments the reference count for a resource
     * @param handle The resource handle
     */
    void addRef(Handle<T> handle) {
        if (!handle.isValid()) return;
        u32 idx = handle.index();
        if (idx < entries_.size()) {
            auto& entry = entries_[idx];
            if (entry.refCount > 0 && entry.generation == handle.generation()) {
                entry.refCount++;
            }
        }
    }

    /**
     * @brief Decrements the reference count and frees if zero
     * @param id The resource identifier
     */
    void release(u32 id) override {
        u32 index = Handle<T>::extractIndex(id);
        u32 gen = Handle<T>::extractGeneration(id);
        if (index >= entries_.size()) return;
        auto& entry = entries_[index];
        if (entry.refCount == 0 || entry.generation != gen) return;
        if (--entry.refCount == 0) {
            if (!entry.path.empty()) {
                pathToId_.erase(entry.path);
            }
            entry.resource.reset();
            entry.path.clear();
            entry.generation = (entry.generation + 1) & Handle<T>::GEN_MASK;
            freeList_.push_back(index);
        }
    }

    /**
     * @brief Gets the number of active resources
     * @return Count of non-freed resources
     */
    usize size() const override {
        return entries_.size() - freeList_.size() - 1;
    }

    /**
     * @brief Releases all resources
     */
    void clear() override {
        entries_.clear();
        freeList_.clear();
        pathToId_.clear();
        entries_.push_back({nullptr, 0, "", 0});
    }

    /**
     * @brief Gets the current reference count for a resource
     * @param handle The resource handle
     * @return Reference count, or 0 if invalid
     */
    u32 getRefCount(Handle<T> handle) const {
        if (!handle.isValid()) return 0;
        u32 idx = handle.index();
        if (idx >= entries_.size()) return 0;
        const auto& entry = entries_[idx];
        if (entry.generation != handle.generation()) return 0;
        return entry.refCount;
    }

    /**
     * @brief Gets the cached path for a resource
     * @param handle The resource handle
     * @return The path, or empty string if not found
     */
    const std::string& getPath(Handle<T> handle) const {
        static const std::string empty;
        if (!handle.isValid()) return empty;
        u32 idx = handle.index();
        if (idx >= entries_.size()) return empty;
        const auto& entry = entries_[idx];
        if (entry.generation != handle.generation()) return empty;
        return entry.path;
    }

private:
    std::vector<Entry> entries_;
    std::vector<u32> freeList_;
    std::unordered_map<std::string, u32> pathToId_;
};

}  // namespace esengine::resource
