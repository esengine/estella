/**
 * @file    LoaderRegistry.hpp
 * @brief   Registry for resource loaders
 * @details Manages registration and lookup of resource loaders by type.
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
#include "ResourceLoader.hpp"

#include <unordered_map>

namespace esengine::resource {

// =============================================================================
// LoaderRegistry Class
// =============================================================================

/**
 * @brief Registry for managing resource loaders
 *
 * @details Stores loaders by resource type and provides lookup functionality.
 *          Use with ResourceManager for a complete resource loading system.
 *
 * @code
 * LoaderRegistry registry;
 * registry.registerLoader<Shader>(makeUnique<ShaderFileLoader>());
 * registry.registerLoader<Texture>(makeUnique<TextureFileLoader>());
 *
 * auto* loader = registry.getLoader<Shader>();
 * if (loader && loader->canLoad("my.esshader")) {
 *     auto result = loader->load({"my.esshader"});
 * }
 * @endcode
 */
class LoaderRegistry {
public:
    LoaderRegistry() = default;
    ~LoaderRegistry() = default;

    LoaderRegistry(const LoaderRegistry&) = delete;
    LoaderRegistry& operator=(const LoaderRegistry&) = delete;
    LoaderRegistry(LoaderRegistry&&) = default;
    LoaderRegistry& operator=(LoaderRegistry&&) = default;

    /**
     * @brief Registers a loader for a resource type
     * @tparam T Resource type
     * @param loader The loader instance to register
     */
    template<typename T>
    void registerLoader(Unique<ResourceLoader<T>> loader) {
        auto wrapper = makeUnique<LoaderWrapper<T>>(std::move(loader));
        loaders_[getTypeId<T>()] = std::move(wrapper);
    }

    /**
     * @brief Gets the loader for a resource type
     * @tparam T Resource type
     * @return Pointer to the loader, or nullptr if not registered
     */
    template<typename T>
    ResourceLoader<T>* getLoader() {
        auto it = loaders_.find(getTypeId<T>());
        if (it == loaders_.end()) {
            return nullptr;
        }
        auto* wrapper = static_cast<LoaderWrapper<T>*>(it->second.get());
        return wrapper->get();
    }

    /**
     * @brief Gets the loader for a resource type (const)
     * @tparam T Resource type
     * @return Const pointer to the loader, or nullptr if not registered
     */
    template<typename T>
    const ResourceLoader<T>* getLoader() const {
        auto it = loaders_.find(getTypeId<T>());
        if (it == loaders_.end()) {
            return nullptr;
        }
        auto* wrapper = static_cast<const LoaderWrapper<T>*>(it->second.get());
        return wrapper->get();
    }

    /**
     * @brief Checks if a loader is registered for a type
     * @tparam T Resource type
     * @return True if a loader is registered
     */
    template<typename T>
    bool hasLoader() const {
        return loaders_.find(getTypeId<T>()) != loaders_.end();
    }

    /**
     * @brief Removes a loader for a type
     * @tparam T Resource type
     */
    template<typename T>
    void removeLoader() {
        loaders_.erase(getTypeId<T>());
    }

    /**
     * @brief Clears all registered loaders
     */
    void clear() {
        loaders_.clear();
    }

    /**
     * @brief Gets the number of registered loaders
     * @return Number of loaders
     */
    usize size() const {
        return loaders_.size();
    }

private:
    std::unordered_map<TypeId, Unique<ILoaderBase>> loaders_;
};

}  // namespace esengine::resource
