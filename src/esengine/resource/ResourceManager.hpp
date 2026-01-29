/**
 * @file    ResourceManager.hpp
 * @brief   Central resource management system
 * @details Provides unified interface for creating, loading, caching, and
 *          releasing GPU resources with automatic deduplication.
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
#include "ResourcePool.hpp"
#include "LoaderRegistry.hpp"
#include "../renderer/Shader.hpp"
#include "../renderer/Texture.hpp"
#include "../renderer/Buffer.hpp"

// Standard library
#include <string>
#include <unordered_map>

namespace esengine::resource {

// =============================================================================
// Resource Manager Statistics
// =============================================================================

/**
 * @brief Statistics about resource usage
 */
struct ResourceStats {
    usize shaderCount = 0;        ///< Number of active shaders
    usize textureCount = 0;       ///< Number of active textures
    usize vertexBufferCount = 0;  ///< Number of active vertex buffers
    usize indexBufferCount = 0;   ///< Number of active index buffers
    usize cacheHits = 0;          ///< Number of cache hits since reset
    usize cacheMisses = 0;        ///< Number of cache misses since reset
};

// =============================================================================
// ResourceManager Class
// =============================================================================

/**
 * @brief Central manager for GPU resources
 *
 * @details Manages the lifecycle of shaders, textures, and buffers.
 *          Provides handle-based access with reference counting and
 *          path-based caching for deduplication.
 *
 * @code
 * ResourceManager rm;
 * rm.init();
 *
 * auto shader = rm.createShader(vertSrc, fragSrc);
 * auto texture = rm.loadTexture("assets/player.png");
 *
 * Shader* shaderPtr = rm.getShader(shader);
 * Texture* texturePtr = rm.getTexture(texture);
 *
 * rm.releaseShader(shader);
 * rm.releaseTexture(texture);
 *
 * rm.shutdown();
 * @endcode
 */
class ResourceManager {
public:
    ResourceManager() = default;
    ~ResourceManager() = default;

    // Non-copyable, movable
    ResourceManager(const ResourceManager&) = delete;
    ResourceManager& operator=(const ResourceManager&) = delete;
    ResourceManager(ResourceManager&&) = default;
    ResourceManager& operator=(ResourceManager&&) = default;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /**
     * @brief Initializes the resource manager
     */
    void init();

    /**
     * @brief Shuts down and releases all resources
     */
    void shutdown();

    /**
     * @brief Checks if the manager is initialized
     * @return True if init() has been called
     */
    bool isInitialized() const { return initialized_; }

    // =========================================================================
    // Shader Resources
    // =========================================================================

    /**
     * @brief Creates a shader from source strings
     * @param vertSrc Vertex shader GLSL source
     * @param fragSrc Fragment shader GLSL source
     * @return Handle to the shader, or invalid handle on failure
     */
    ShaderHandle createShader(const std::string& vertSrc, const std::string& fragSrc);

    /**
     * @brief Loads a shader from file paths (with caching)
     * @param vertPath Path to vertex shader file
     * @param fragPath Path to fragment shader file
     * @return Handle to the shader, or invalid handle on failure
     */
    ShaderHandle loadShader(const std::string& vertPath, const std::string& fragPath);

    /**
     * @brief Loads a shader from .esshader file (with caching)
     * @param path Path to the .esshader file
     * @param platform Platform variant (empty for auto-detect)
     * @return Handle to the shader, or invalid handle on failure
     */
    ShaderHandle loadShaderFile(const std::string& path, const std::string& platform = "");

    /**
     * @brief Gets a shader by handle
     * @param handle The shader handle
     * @return Pointer to the shader, or nullptr if invalid
     */
    Shader* getShader(ShaderHandle handle);

    /**
     * @brief Gets a shader by handle (const)
     * @param handle The shader handle
     * @return Const pointer to the shader, or nullptr if invalid
     */
    const Shader* getShader(ShaderHandle handle) const;

    /**
     * @brief Releases a shader (decrements ref count)
     * @param handle The shader handle
     */
    void releaseShader(ShaderHandle handle);

    // =========================================================================
    // Texture Resources
    // =========================================================================

    /**
     * @brief Creates a texture from specification
     * @param spec Texture creation parameters
     * @return Handle to the texture, or invalid handle on failure
     */
    TextureHandle createTexture(const TextureSpecification& spec);

    /**
     * @brief Creates a texture from pixel data
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param pixels Pixel data
     * @param format Pixel format (default RGBA8)
     * @return Handle to the texture, or invalid handle on failure
     */
    TextureHandle createTexture(u32 width, u32 height, ConstSpan<u8> pixels,
                                 TextureFormat format);

    /**
     * @brief Loads a texture from file (with caching)
     * @param path Path to the image file
     * @return Handle to the texture, or invalid handle on failure
     */
    TextureHandle loadTexture(const std::string& path);

    /**
     * @brief Gets a texture by handle
     * @param handle The texture handle
     * @return Pointer to the texture, or nullptr if invalid
     */
    Texture* getTexture(TextureHandle handle);

    /**
     * @brief Gets a texture by handle (const)
     * @param handle The texture handle
     * @return Const pointer to the texture, or nullptr if invalid
     */
    const Texture* getTexture(TextureHandle handle) const;

    /**
     * @brief Releases a texture (decrements ref count)
     * @param handle The texture handle
     */
    void releaseTexture(TextureHandle handle);

    /**
     * @brief Loads a texture by GUID (with caching)
     * @param guid Asset GUID from AssetDatabase
     * @param path File path to load if not cached
     * @return Handle to the texture, or invalid handle on failure
     */
    TextureHandle loadTextureByGUID(const std::string& guid, const std::string& path);

    /**
     * @brief Gets a texture handle by GUID if already loaded
     * @param guid Asset GUID
     * @return Handle to the texture, or invalid handle if not loaded
     */
    TextureHandle getTextureByGUID(const std::string& guid) const;

    /**
     * @brief Releases a texture by GUID
     * @param guid Asset GUID
     */
    void releaseTextureByGUID(const std::string& guid);

    // =========================================================================
    // Vertex Buffer Resources
    // =========================================================================

    /**
     * @brief Creates a vertex buffer from typed data
     * @tparam T Vertex type
     * @param data Span of vertex data
     * @return Handle to the buffer, or invalid handle on failure
     */
    template<typename T>
    VertexBufferHandle createVertexBuffer(ConstSpan<T> data);

    /**
     * @brief Creates a dynamic vertex buffer
     * @param sizeBytes Buffer size in bytes
     * @return Handle to the buffer, or invalid handle on failure
     */
    VertexBufferHandle createVertexBuffer(u32 sizeBytes);

    /**
     * @brief Gets a vertex buffer by handle
     * @param handle The buffer handle
     * @return Pointer to the buffer, or nullptr if invalid
     */
    VertexBuffer* getVertexBuffer(VertexBufferHandle handle);

    /**
     * @brief Gets a vertex buffer by handle (const)
     * @param handle The buffer handle
     * @return Const pointer to the buffer, or nullptr if invalid
     */
    const VertexBuffer* getVertexBuffer(VertexBufferHandle handle) const;

    /**
     * @brief Releases a vertex buffer (decrements ref count)
     * @param handle The buffer handle
     */
    void releaseVertexBuffer(VertexBufferHandle handle);

    // =========================================================================
    // Index Buffer Resources
    // =========================================================================

    /**
     * @brief Creates an index buffer from 32-bit indices
     * @param indices Span of index data
     * @return Handle to the buffer, or invalid handle on failure
     */
    IndexBufferHandle createIndexBuffer(ConstSpan<u32> indices);

    /**
     * @brief Creates an index buffer from 16-bit indices
     * @param indices Span of index data
     * @return Handle to the buffer, or invalid handle on failure
     */
    IndexBufferHandle createIndexBuffer(ConstSpan<u16> indices);

    /**
     * @brief Gets an index buffer by handle
     * @param handle The buffer handle
     * @return Pointer to the buffer, or nullptr if invalid
     */
    IndexBuffer* getIndexBuffer(IndexBufferHandle handle);

    /**
     * @brief Gets an index buffer by handle (const)
     * @param handle The buffer handle
     * @return Const pointer to the buffer, or nullptr if invalid
     */
    const IndexBuffer* getIndexBuffer(IndexBufferHandle handle) const;

    /**
     * @brief Releases an index buffer (decrements ref count)
     * @param handle The buffer handle
     */
    void releaseIndexBuffer(IndexBufferHandle handle);

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * @brief Gets current resource statistics
     * @return Resource counts and cache statistics
     */
    ResourceStats getStats() const;

    /**
     * @brief Resets cache hit/miss counters
     */
    void resetCacheStats();

    // =========================================================================
    // Loader Registration
    // =========================================================================

    /**
     * @brief Registers a custom resource loader
     * @tparam T Resource type the loader produces
     * @param loader The loader instance
     */
    template<typename T>
    void registerLoader(Unique<ResourceLoader<T>> loader);

    /**
     * @brief Gets a registered loader for a resource type
     * @tparam T Resource type
     * @return Pointer to the loader, or nullptr if not registered
     */
    template<typename T>
    ResourceLoader<T>* getLoader();

    /**
     * @brief Checks if a loader is registered for a type
     * @tparam T Resource type
     * @return True if a loader is registered
     */
    template<typename T>
    bool hasLoader() const;

    /**
     * @brief Gets the loader registry for advanced usage
     * @return Reference to the loader registry
     */
    LoaderRegistry& getLoaderRegistry() { return loaderRegistry_; }

private:
    ResourcePool<Shader> shaders_;
    ResourcePool<Texture> textures_;
    ResourcePool<VertexBuffer> vertexBuffers_;
    ResourcePool<IndexBuffer> indexBuffers_;
    std::unordered_map<std::string, TextureHandle> guidToTexture_;
    LoaderRegistry loaderRegistry_;
    mutable ResourceStats stats_;
    bool initialized_ = false;
};

// =============================================================================
// Template Implementations
// =============================================================================

template<typename T>
VertexBufferHandle ResourceManager::createVertexBuffer(ConstSpan<T> data) {
    auto buffer = VertexBuffer::create(data);
    if (!buffer) return VertexBufferHandle();
    return vertexBuffers_.add(std::move(buffer));
}

template<typename T>
void ResourceManager::registerLoader(Unique<ResourceLoader<T>> loader) {
    loaderRegistry_.registerLoader<T>(std::move(loader));
}

template<typename T>
ResourceLoader<T>* ResourceManager::getLoader() {
    return loaderRegistry_.getLoader<T>();
}

template<typename T>
bool ResourceManager::hasLoader() const {
    return loaderRegistry_.hasLoader<T>();
}

}  // namespace esengine::resource
