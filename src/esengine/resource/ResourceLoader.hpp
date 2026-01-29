/**
 * @file    ResourceLoader.hpp
 * @brief   Template interface for resource loaders
 * @details Provides a generic interface for implementing custom resource loaders
 *          that can be registered with the ResourceManager.
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

#include <string>
#include <vector>
#include <functional>

namespace esengine::resource {

// =============================================================================
// Load Request
// =============================================================================

/**
 * @brief Parameters for a resource load request
 */
struct LoadRequest {
    std::string path;                    ///< File path to load
    std::string platform;                ///< Platform variant (optional)
    bool async = false;                  ///< Whether this is an async request
};

// =============================================================================
// Load Result
// =============================================================================

/**
 * @brief Result of a resource loading operation
 * @tparam T The resource type being loaded
 */
template<typename T>
struct LoadResult {
    Unique<T> resource;                  ///< Loaded resource (nullptr on failure)
    std::string errorMessage;            ///< Error message if loading failed
    std::vector<std::string> dependencies;  ///< File dependencies for hot reload

    /** @brief Checks if loading succeeded */
    bool isOk() const { return resource != nullptr; }

    /** @brief Creates a success result */
    static LoadResult ok(Unique<T> res, std::vector<std::string> deps = {}) {
        LoadResult result;
        result.resource = std::move(res);
        result.dependencies = std::move(deps);
        return result;
    }

    /** @brief Creates a failure result */
    static LoadResult err(const std::string& message) {
        LoadResult result;
        result.errorMessage = message;
        return result;
    }
};

// =============================================================================
// ResourceLoader Interface
// =============================================================================

/**
 * @brief Base interface for resource loaders
 *
 * @details Implement this interface to create custom loaders for new resource
 *          types. Register loaders with ResourceManager::registerLoader<T>().
 *
 * @tparam T The resource type this loader creates
 *
 * @code
 * class MaterialLoader : public ResourceLoader<Material> {
 * public:
 *     bool canLoad(const std::string& path) const override {
 *         return path.ends_with(".material");
 *     }
 *
 *     std::vector<std::string> getSupportedExtensions() const override {
 *         return {".material"};
 *     }
 *
 *     LoadResult<Material> load(const LoadRequest& request) override {
 *         // Load implementation...
 *     }
 *
 *     const char* getTypeName() const override { return "Material"; }
 * };
 *
 * // Register with ResourceManager
 * rm.registerLoader<Material>(makeUnique<MaterialLoader>());
 * @endcode
 */
template<typename T>
class ResourceLoader {
public:
    virtual ~ResourceLoader() = default;

    /**
     * @brief Checks if this loader can load the given file
     * @param path File path to check
     * @return True if this loader supports the file format
     */
    virtual bool canLoad(const std::string& path) const = 0;

    /**
     * @brief Gets the file extensions this loader supports
     * @return List of extensions (e.g., {".png", ".jpg"})
     */
    virtual std::vector<std::string> getSupportedExtensions() const = 0;

    /**
     * @brief Loads a resource synchronously
     * @param request Load request parameters
     * @return Load result with resource or error
     */
    virtual LoadResult<T> load(const LoadRequest& request) = 0;

    /**
     * @brief Loads a resource asynchronously (optional override)
     * @param request Load request parameters
     * @return Load result with resource or error
     * @details Default implementation calls load(). Override for true async loading.
     */
    virtual LoadResult<T> loadAsync(const LoadRequest& request) {
        return load(request);
    }

    /**
     * @brief Gets the human-readable type name
     * @return Type name string (e.g., "Shader", "Texture")
     */
    virtual const char* getTypeName() const = 0;
};

// =============================================================================
// Type-Erased Loader Wrapper
// =============================================================================

/**
 * @brief Type-erased base class for loader storage
 */
class ILoaderBase {
public:
    virtual ~ILoaderBase() = default;
    virtual bool canLoad(const std::string& path) const = 0;
    virtual std::vector<std::string> getSupportedExtensions() const = 0;
    virtual const char* getTypeName() const = 0;
};

/**
 * @brief Type-erased wrapper for ResourceLoader<T>
 */
template<typename T>
class LoaderWrapper : public ILoaderBase {
public:
    explicit LoaderWrapper(Unique<ResourceLoader<T>> loader)
        : loader_(std::move(loader)) {}

    bool canLoad(const std::string& path) const override {
        return loader_->canLoad(path);
    }

    std::vector<std::string> getSupportedExtensions() const override {
        return loader_->getSupportedExtensions();
    }

    const char* getTypeName() const override {
        return loader_->getTypeName();
    }

    ResourceLoader<T>* get() { return loader_.get(); }
    const ResourceLoader<T>* get() const { return loader_.get(); }

private:
    Unique<ResourceLoader<T>> loader_;
};

}  // namespace esengine::resource
