/**
 * @file    ResourceManager.cpp
 * @brief   Central resource management system implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ResourceManager.hpp"
#include "loaders/ShaderLoader.hpp"
#include "../core/Log.hpp"
#include "../platform/PathResolver.hpp"
#include "../renderer/Shader.hpp"
#include "../renderer/Texture.hpp"
#include "../renderer/Buffer.hpp"

namespace esengine::resource {

void ResourceManager::init() {
    if (initialized_) {
        ES_LOG_WARN("ResourceManager already initialized");
        return;
    }

    stats_ = {};
    initialized_ = true;
    ES_LOG_INFO("ResourceManager initialized");
}

void ResourceManager::shutdown() {
    if (!initialized_) {
        return;
    }

    ES_LOG_INFO("ResourceManager shutting down (shaders: {}, textures: {}, vbos: {}, ibos: {})",
                shaders_.size(), textures_.size(), vertexBuffers_.size(), indexBuffers_.size());

    guidToTexture_.clear();
    shaders_.clear();
    textures_.clear();
    vertexBuffers_.clear();
    indexBuffers_.clear();

    initialized_ = false;
    ES_LOG_INFO("ResourceManager shutdown complete");
}

// =============================================================================
// Shader Resources
// =============================================================================

ShaderHandle ResourceManager::createShader(const std::string& vertSrc, const std::string& fragSrc) {
    auto shader = Shader::create(vertSrc, fragSrc);
    if (!shader) {
        ES_LOG_ERROR("Failed to create shader from source");
        return ShaderHandle();
    }
    return shaders_.add(std::move(shader));
}

ShaderHandle ResourceManager::loadShader(const std::string& vertPath, const std::string& fragPath) {
    // Create cache key from paths
    std::string cacheKey = vertPath + ":" + fragPath;

    // Check cache
    auto cached = shaders_.findByPath(cacheKey);
    if (cached.isValid()) {
        shaders_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

    // Load from files
    auto shader = Shader::createFromFile(vertPath, fragPath);
    if (!shader) {
        stats_.cacheMisses++;
        return ShaderHandle();
    }

    stats_.cacheMisses++;
    return shaders_.add(std::move(shader), cacheKey);
}

ShaderHandle ResourceManager::loadShaderFile(const std::string& path, const std::string& platform) {
    auto cached = shaders_.findByPath(path);
    if (cached.isValid()) {
        shaders_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

    ShaderLoader loader;
    auto result = loader.loadFromFile(path, platform);
    if (!result.isOk()) {
        stats_.cacheMisses++;
        return ShaderHandle();
    }

    stats_.cacheMisses++;
    return shaders_.add(std::move(result.resource), path);
}

ShaderHandle ResourceManager::loadEngineShader(const std::string& name, const std::string& platform) {
    std::string cacheKey = "engine:" + name;
    auto cached = shaders_.findByPath(cacheKey);
    if (cached.isValid()) {
        shaders_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

    std::string path = PathResolver::editorPath("src/esengine/data/shaders/" + name + ".esshader");

    ShaderLoader loader;
    auto result = loader.loadFromFile(path, platform);
    if (!result.isOk()) {
        ES_LOG_ERROR("Failed to load engine shader '{}': {}", name, result.errorMessage);
        stats_.cacheMisses++;
        return ShaderHandle();
    }

    stats_.cacheMisses++;
    return shaders_.add(std::move(result.resource), cacheKey);
}

Shader* ResourceManager::getShader(ShaderHandle handle) {
    return shaders_.get(handle);
}

const Shader* ResourceManager::getShader(ShaderHandle handle) const {
    return shaders_.get(handle);
}

void ResourceManager::releaseShader(ShaderHandle handle) {
    if (handle.isValid()) {
        shaders_.release(handle.id());
    }
}

// =============================================================================
// Texture Resources
// =============================================================================

TextureHandle ResourceManager::createTexture(const TextureSpecification& spec) {
    auto texture = Texture::create(spec);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from spec");
        return TextureHandle();
    }
    return textures_.add(std::move(texture));
}

TextureHandle ResourceManager::createTexture(u32 width, u32 height, ConstSpan<u8> pixels,
                                              TextureFormat format) {
    std::vector<u8> pixelVec(pixels.begin(), pixels.end());
    auto texture = Texture::create(width, height, pixelVec, format);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from pixels");
        return TextureHandle();
    }
    return textures_.add(std::move(texture));
}

TextureHandle ResourceManager::loadTexture(const std::string& path) {
    auto cached = textures_.findByPath(path);
    if (cached.isValid()) {
        textures_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

#ifdef ES_PLATFORM_WEB
    ES_LOG_ERROR("loadTexture from file not supported on Web, use createTexture with pixel data");
    stats_.cacheMisses++;
    return TextureHandle();
#else
    auto texture = Texture::createFromFile(path);
    if (!texture) {
        stats_.cacheMisses++;
        return TextureHandle();
    }

    stats_.cacheMisses++;
    return textures_.add(std::move(texture), path);
#endif
}

Texture* ResourceManager::getTexture(TextureHandle handle) {
    return textures_.get(handle);
}

const Texture* ResourceManager::getTexture(TextureHandle handle) const {
    return textures_.get(handle);
}

void ResourceManager::releaseTexture(TextureHandle handle) {
    if (handle.isValid()) {
        textures_.release(handle.id());
    }
}

const std::string& ResourceManager::getTexturePath(TextureHandle handle) const {
    return textures_.getPath(handle);
}

TextureHandle ResourceManager::loadTextureByGUID(const std::string& guid, const std::string& path) {
    auto it = guidToTexture_.find(guid);
    if (it != guidToTexture_.end() && it->second.isValid()) {
        textures_.addRef(it->second);
        stats_.cacheHits++;
        return it->second;
    }

    TextureHandle handle = loadTexture(path);
    if (handle.isValid()) {
        guidToTexture_[guid] = handle;
    }
    return handle;
}

TextureHandle ResourceManager::getTextureByGUID(const std::string& guid) const {
    auto it = guidToTexture_.find(guid);
    if (it != guidToTexture_.end()) {
        return it->second;
    }
    return TextureHandle();
}

void ResourceManager::releaseTextureByGUID(const std::string& guid) {
    auto it = guidToTexture_.find(guid);
    if (it != guidToTexture_.end()) {
        releaseTexture(it->second);
        guidToTexture_.erase(it);
    }
}

// =============================================================================
// Vertex Buffer Resources
// =============================================================================

VertexBufferHandle ResourceManager::createVertexBuffer(u32 sizeBytes) {
    auto buffer = VertexBuffer::create(sizeBytes);
    if (!buffer) {
        ES_LOG_ERROR("Failed to create dynamic vertex buffer");
        return VertexBufferHandle();
    }
    return vertexBuffers_.add(std::move(buffer));
}

VertexBuffer* ResourceManager::getVertexBuffer(VertexBufferHandle handle) {
    return vertexBuffers_.get(handle);
}

const VertexBuffer* ResourceManager::getVertexBuffer(VertexBufferHandle handle) const {
    return vertexBuffers_.get(handle);
}

void ResourceManager::releaseVertexBuffer(VertexBufferHandle handle) {
    if (handle.isValid()) {
        vertexBuffers_.release(handle.id());
    }
}

// =============================================================================
// Index Buffer Resources
// =============================================================================

IndexBufferHandle ResourceManager::createIndexBuffer(ConstSpan<u32> indices) {
    auto buffer = IndexBuffer::create(indices.data(), static_cast<u32>(indices.size()));
    if (!buffer) {
        ES_LOG_ERROR("Failed to create index buffer (u32)");
        return IndexBufferHandle();
    }
    return indexBuffers_.add(std::move(buffer));
}

IndexBufferHandle ResourceManager::createIndexBuffer(ConstSpan<u16> indices) {
    auto buffer = IndexBuffer::create(indices.data(), static_cast<u32>(indices.size()));
    if (!buffer) {
        ES_LOG_ERROR("Failed to create index buffer (u16)");
        return IndexBufferHandle();
    }
    return indexBuffers_.add(std::move(buffer));
}

IndexBuffer* ResourceManager::getIndexBuffer(IndexBufferHandle handle) {
    return indexBuffers_.get(handle);
}

const IndexBuffer* ResourceManager::getIndexBuffer(IndexBufferHandle handle) const {
    return indexBuffers_.get(handle);
}

void ResourceManager::releaseIndexBuffer(IndexBufferHandle handle) {
    if (handle.isValid()) {
        indexBuffers_.release(handle.id());
    }
}

// =============================================================================
// Statistics
// =============================================================================

ResourceStats ResourceManager::getStats() const {
    stats_.shaderCount = shaders_.size();
    stats_.textureCount = textures_.size();
    stats_.vertexBufferCount = vertexBuffers_.size();
    stats_.indexBufferCount = indexBuffers_.size();
    return stats_;
}

void ResourceManager::resetCacheStats() {
    stats_.cacheHits = 0;
    stats_.cacheMisses = 0;
}

}  // namespace esengine::resource
