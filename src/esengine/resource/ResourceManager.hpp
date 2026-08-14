// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
 *            Licensed under the Apache License, Version 2.0.
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
#include "TextureMetadata.hpp"
#include "../renderer/rhi/Shader.hpp"
#include "../renderer/rhi/Texture.hpp"
#include "../renderer/rhi/Buffer.hpp"
#include "../text/BitmapFont.hpp"

// Standard library
#include <string>
#include <unordered_map>

namespace esengine { class GfxDevice; }

namespace esengine::resource {

enum class ShaderTargetLanguage : u8;  // ShaderParser.hpp

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
    usize textureBytes = 0;       ///< Resident texture bytes (RGBA8 estimate) — VRAM usage
    usize textureBudget = 0;      ///< Texture pool resident-byte budget (0 = eviction off)
    usize textureEvictableCount = 0;  ///< Cached refCount==0 textures awaiting revive/evict
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
     * @param device The graphics device used to create all GPU resources
     *        (shaders, textures, buffers). ResourceManager is the GPU-resource
     *        factory, so it owns the single device reference the resource classes
     *        route through.
     */
    void init(GfxDevice& device);

    /** The device resources are created on, or null before {@link init}.
     *  Read by callers that must ASK the backend what it supports. */
    GfxDevice* device() const { return device_; }

    /**
     * @brief Shuts down and releases all resources
     */
    void shutdown();

    /**
     * @brief Checks if the manager is initialized
     * @return True if init() has been called
     */
    bool isInitialized() const { return initialized_; }

    /**
     * @brief Updates resource manager (processes hot reload, call once per frame)
     */
    void update();

    // =========================================================================
    // Shader Resources
    // =========================================================================

    /**
     * @brief The language embedded pipelines must author their sources in.
     * @details GLSL when the backend compiles it (the GL device); otherwise the
     *          backend's own language (WGSL). Embedded shader creation sites
     *          branch on this to pick the .esshader assembly or its WGSL twin —
     *          the one seam that keeps plugins backend-agnostic.
     */
    GfxShaderLanguage preferredShaderLanguage() const;

    /**
     * @brief preferredShaderLanguage() as a ShaderParser assembly target.
     * @details The other half of the seam: creation sites parse one .esshader
     *          (whose WGSL twin rides the same file) and assemble both stages
     *          for this target — no per-backend branches.
     */
    ShaderTargetLanguage preferredShaderTarget() const;

    /**
     * @brief Creates a shader from source strings
     * @param vertSrc Vertex shader GLSL source
     * @param fragSrc Fragment shader GLSL source
     * @param rewriteLoose Lift loose non-sampler uniforms into a std140
     *        DrawParams block (see renderer/DrawParams.hpp). Pass false for
     *        sources whose uniform blocks are already assembled (ShaderParser
     *        material output).
     * @return Handle to the shader, or invalid handle on failure
     */
    ShaderHandle createShader(const std::string& vertSrc, const std::string& fragSrc,
                              bool rewriteLoose = true,
                              GfxShaderLanguage language = GfxShaderLanguage::GLSL_ES300);
    ShaderHandle createShaderWithBindings(const std::string& vertSrc, const std::string& fragSrc,
                                           std::initializer_list<AttribBinding> bindings,
                                           GfxShaderLanguage language = GfxShaderLanguage::GLSL_ES300);

    /**
     * @brief Loads a shader from file paths (with caching)
     * @param vertPath Path to vertex shader file
     * @param fragPath Path to fragment shader file
     * @return Handle to the shader, or invalid handle on failure
     */
    ShaderHandle loadShader(const std::string& vertPath, const std::string& fragPath);

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

    /**
     * @brief Gets the current reference count for a shader
     * @param handle The shader handle
     * @return Reference count, or 0 if invalid
     */
    u32 getShaderRefCount(ShaderHandle handle) const;

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
                                 TextureFormat format, bool flipY = false);

    /**
     * @brief Creates a block-compressed texture (KTX2 → ETC2/ASTC/BC), uploading
     *        the pre-compressed blocks for mip level 0. Tracked like any texture;
     *        its residency cost is the real (compressed) byte size.
     * @param data All @p mipLevels concatenated (level 0 first, block-aligned).
     * @param mipLevels Mip levels present (1 = base only).
     * @return Handle to the texture, or invalid handle on failure.
     */
    TextureHandle createCompressedTexture(u32 width, u32 height, GfxCompressedFormat format,
                                          ConstSpan<u8> data, u32 mipLevels = 1);

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
     * @brief Gets the current reference count for a texture
     * @param handle The texture handle
     * @return Reference count, or 0 if invalid
     */
    u32 getTextureRefCount(TextureHandle handle) const;

    /**
     * @brief Registers an externally-created GL texture
     * @param glTextureId The OpenGL texture ID
     * @param width Texture width in pixels
     * @param height Texture height in pixels
     * @param bytes Actual GPU size for the eviction budget; 0 = estimate as
     *              RGBA8 (width × height × 4). Compressed uploads (KTX2 →
     *              ASTC/ETC2/S3TC) pass their real block size, 4–8× smaller —
     *              billing them as RGBA8 would waste most of the budget.
     * @return Handle to the registered texture
     */
    TextureHandle registerExternalTexture(u32 glTextureId, u32 width, u32 height, usize bytes = 0);

    /**
     * @brief Registers a texture with a path for cache lookup
     * @param handle The texture handle
     * @param path The path to associate (used by loadTexture cache)
     */
    void registerTextureWithPath(TextureHandle handle, const std::string& path);

    // =========================================================================
    // Device Loss
    // =========================================================================

    /**
     * @brief Points every texture at @p placeholder, keeping all handles valid.
     * @details The GPU objects died with the device; the handles did not. They
     *          are pool indices, and components, materials and fonts all name
     *          textures by them, so re-uploading behind one is invisible.
     *          Sampling the placeholder meanwhile renders pale, not garbage.
     */
    /**
     * @brief Re-compiles every shader behind its existing handle.
     * @details Shaders keep their sources precisely so this is possible: a
     *          material's shaderRef and a plugin's handle stay valid, where
     *          creating NEW shaders would invalidate every one of them.
     * @return How many were rebuilt.
     */
    u32 recreateGpuShaders();

    void invalidateGpuTextures(::esengine::TextureHandle placeholder);

    /**
     * @brief Re-points an existing handle at a freshly uploaded GPU texture.
     * @return False if the handle names no live texture.
     */
    bool retargetExternalTexture(TextureHandle handle, u32 glTextureId, u32 width, u32 height);

    /** @brief Texture handles that were invalidated and not yet re-uploaded. */
    std::vector<TextureHandle> texturesAwaitingReupload() const;

    /**
     * @brief Gets the cached path for a texture
     * @param handle The texture handle
     * @return The path used to load the texture, or empty if not found
     */
    const std::string& getTexturePath(TextureHandle handle) const;

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

    /**
     * @brief Sets the texture pool's resident-byte budget (0 = no eviction).
     *        Over budget, refCount==0 textures are evicted oldest-first.
     */
    void setTextureBudget(usize bytes);

    /**
     * @brief Reuses a cached texture by its build path: returns its handle with an
     *        added reference (reviving an evictable one), or an invalid handle if
     *        none is cached. Lets the runtime dedupe + reuse textures across loads.
     */
    TextureHandle acquireTextureByPath(const std::string& path);

    /**
     * @brief Severs a path's texture-cache identity (hot reload). The next
     *        acquireTextureByPath for it misses, so stale bytes are never
     *        revived; an evictable entry under that path is freed immediately.
     * @param path The path to invalidate
     * @return True if the path was registered
     */
    bool invalidateTexturePath(const std::string& path);

    /**
     * @brief Frees every evictable cached texture now (memory pressure).
     *        Held textures and the budget are untouched.
     * @return Number of textures freed
     */
    usize trimTextureCache();

    // =========================================================================
    // Texture Metadata
    // =========================================================================

    /**
     * @brief Sets metadata for a texture
     * @param handle The texture handle
     * @param metadata The metadata to associate
     */
    void setTextureMetadata(TextureHandle handle, const TextureMetadata& metadata);

    /**
     * @brief Gets metadata for a texture
     * @param handle The texture handle
     * @return Pointer to metadata, or nullptr if not set
     */
    const TextureMetadata* getTextureMetadata(TextureHandle handle) const;

    /**
     * @brief Checks if a texture has metadata
     * @param handle The texture handle
     * @return True if metadata is set
     */
    bool hasTextureMetadata(TextureHandle handle) const;

    /**
     * @brief Removes metadata for a texture
     * @param handle The texture handle
     */
    void removeTextureMetadata(TextureHandle handle);

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
    // Bitmap Font Resources
    // =========================================================================

    BitmapFontHandle loadBitmapFont(const std::string& fntPath);

    BitmapFontHandle createBitmapFont(const std::string& fntContent,
                                       TextureHandle texture,
                                       u32 texWidth, u32 texHeight);

    BitmapFontHandle createLabelAtlasFont(TextureHandle texture,
                                           u32 texWidth, u32 texHeight,
                                           const std::string& chars,
                                           u32 charWidth, u32 charHeight);

    text::BitmapFont* getBitmapFont(BitmapFontHandle handle);
    const text::BitmapFont* getBitmapFont(BitmapFontHandle handle) const;
    void releaseBitmapFont(BitmapFontHandle handle);

    /**
     * @brief Gets the current reference count for a bitmap font
     * @param handle The font handle
     * @return Reference count, or 0 if invalid
     */
    u32 getBitmapFontRefCount(BitmapFontHandle handle) const;

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
    ResourcePool<text::BitmapFont> fonts_;
    /// Handles whose GPU texture died with the device, still showing the
    /// placeholder. Empty means the content is whole again.
    std::vector<TextureHandle> awaitingReupload_;
    std::unordered_map<std::string, TextureHandle> guidToTexture_;
    std::unordered_map<TextureHandle::IdType, TextureMetadata> textureMetadata_;
    LoaderRegistry loaderRegistry_;
    mutable ResourceStats stats_;
    GfxDevice* device_ = nullptr;  ///< GPU device for resource creation (set in init)
    bool initialized_ = false;
};

// =============================================================================
// Template Implementations
// =============================================================================

template<typename T>
VertexBufferHandle ResourceManager::createVertexBuffer(ConstSpan<T> data) {
    auto buffer = VertexBuffer::create(*device_, data);
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
