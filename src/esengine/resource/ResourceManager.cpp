// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ResourceManager.cpp
 * @brief   Central resource management system implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "ResourceManager.hpp"
#include "../text/BitmapFont.hpp"
#include "../core/Log.hpp"
#include "../renderer/GfxDevice.hpp"
#include "../renderer/Shader.hpp"
#include "../renderer/Texture.hpp"
#include "../renderer/Buffer.hpp"

namespace esengine::resource {

void ResourceManager::init(GfxDevice& device) {
    if (initialized_) {
        ES_LOG_WARN("ResourceManager already initialized");
        return;
    }

    device_ = &device;

    stats_ = {};
    initialized_ = true;
}

void ResourceManager::shutdown() {
    if (!initialized_) {
        return;
    }

    ES_LOG_INFO("ResourceManager shutting down (shaders: {}, textures: {}, vbos: {}, ibos: {}, fonts: {})",
                shaders_.size(), textures_.size(), vertexBuffers_.size(), indexBuffers_.size(), fonts_.size());

    guidToTexture_.clear();
    textureMetadata_.clear();
    fonts_.clear();
    shaders_.clear();
    textures_.clear();
    vertexBuffers_.clear();
    indexBuffers_.clear();

    // Drop the device ref so a stray create after shutdown returns an empty
    // handle instead of dereferencing a freed GfxDevice (A10).
    device_ = nullptr;
    initialized_ = false;
    ES_LOG_INFO("ResourceManager shutdown complete");
}

void ResourceManager::update() {
    // Hot reload is editor/native-only; no-op on web.
}

// =============================================================================
// Shader Resources
// =============================================================================

ShaderHandle ResourceManager::createShader(const std::string& vertSrc, const std::string& fragSrc) {
    if (!device_) return {};
    auto shader = Shader::create(*device_, vertSrc, fragSrc);
    if (!shader) {
        ES_LOG_ERROR("Failed to create shader from source");
        return ShaderHandle();
    }
    return shaders_.add(std::move(shader));
}

ShaderHandle ResourceManager::createShaderWithBindings(const std::string& vertSrc, const std::string& fragSrc,
                                                        std::initializer_list<AttribBinding> bindings) {
    if (!device_) return {};
    auto shader = Shader::createWithBindings(*device_, vertSrc, fragSrc, bindings);
    if (!shader) {
        ES_LOG_ERROR("Failed to create shader with bindings from source");
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
    if (!device_) return {};
    auto shader = Shader::createFromFile(*device_, vertPath, fragPath);
    if (!shader) {
        stats_.cacheMisses++;
        return ShaderHandle();
    }

    stats_.cacheMisses++;
    return shaders_.add(std::move(shader), cacheKey);
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

u32 ResourceManager::getShaderRefCount(ShaderHandle handle) const {
    return shaders_.getRefCount(handle);
}

// =============================================================================
// Texture Resources
// =============================================================================

TextureHandle ResourceManager::createTexture(const TextureSpecification& spec) {
    if (!device_) return {};
    auto texture = Texture::create(*device_, spec);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from spec");
        return TextureHandle();
    }
    const usize bytes = static_cast<usize>(texture->getWidth()) * texture->getHeight() * 4;
    return textures_.add(std::move(texture), "", bytes);
}

TextureHandle ResourceManager::createTexture(u32 width, u32 height, ConstSpan<u8> pixels,
                                              TextureFormat format, bool flipY) {
    if (!device_) return {};
    std::vector<u8> pixelVec(pixels.begin(), pixels.end());
    auto texture = Texture::create(*device_, width, height, pixelVec, format, flipY);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from pixels");
        return TextureHandle();
    }
    const usize bytes = static_cast<usize>(width) * height * 4;
    return textures_.add(std::move(texture), "", bytes);
}

TextureHandle ResourceManager::loadTexture(const std::string& path) {
    auto cached = textures_.findByPath(path);
    if (cached.isValid()) {
        textures_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

    // Web decodes images JS-side and uploads via createTexture/registerExternalTexture;
    // there is no C++ file-decode path.
    ES_LOG_ERROR("loadTexture from file not supported on Web, use createTexture with pixel data");
    stats_.cacheMisses++;
    return TextureHandle();
}

Texture* ResourceManager::getTexture(TextureHandle handle) {
    return textures_.get(handle);
}

const Texture* ResourceManager::getTexture(TextureHandle handle) const {
    return textures_.get(handle);
}

void ResourceManager::releaseTexture(TextureHandle handle) {
    if (handle.isValid()) {
        if (textures_.getRefCount(handle) == 1) {
            textureMetadata_.erase(handle.id());
            for (auto it = guidToTexture_.begin(); it != guidToTexture_.end(); ) {
                if (it->second == handle) {
                    it = guidToTexture_.erase(it);
                } else {
                    ++it;
                }
            }
        }
        textures_.release(handle.id());
    }
}

u32 ResourceManager::getTextureRefCount(TextureHandle handle) const {
    return textures_.getRefCount(handle);
}

TextureHandle ResourceManager::registerExternalTexture(u32 glTextureId, u32 width, u32 height) {
    if (!device_) return {};
    auto texture = Texture::createFromExternalId(*device_, glTextureId, width, height, TextureFormat::RGBA8);
    if (!texture) {
        ES_LOG_ERROR("Failed to register external texture (GL ID: {})", glTextureId);
        return TextureHandle();
    }
    const usize bytes = static_cast<usize>(width) * height * 4;
    return textures_.add(std::move(texture), "", bytes);
}

void ResourceManager::registerTextureWithPath(TextureHandle handle, const std::string& path) {
    if (handle.isValid() && !path.empty()) {
        textures_.setPath(handle, path);
    }
}

const std::string& ResourceManager::getTexturePath(TextureHandle handle) const {
    return textures_.getPath(handle);
}

void ResourceManager::setTextureBudget(usize bytes) {
    textures_.setBudget(bytes);
}

TextureHandle ResourceManager::acquireTextureByPath(const std::string& path) {
    auto handle = textures_.findByPath(path);
    if (handle.isValid()) textures_.addRef(handle);
    return handle;
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
// Texture Metadata
// =============================================================================

void ResourceManager::setTextureMetadata(TextureHandle handle, const TextureMetadata& metadata) {
    if (handle.isValid()) {
        textureMetadata_[handle.id()] = metadata;
    }
}

const TextureMetadata* ResourceManager::getTextureMetadata(TextureHandle handle) const {
    if (!handle.isValid()) return nullptr;
    auto it = textureMetadata_.find(handle.id());
    if (it != textureMetadata_.end()) {
        return &it->second;
    }
    return nullptr;
}

bool ResourceManager::hasTextureMetadata(TextureHandle handle) const {
    if (!handle.isValid()) return false;
    return textureMetadata_.find(handle.id()) != textureMetadata_.end();
}

void ResourceManager::removeTextureMetadata(TextureHandle handle) {
    if (handle.isValid()) {
        textureMetadata_.erase(handle.id());
    }
}

// =============================================================================
// Vertex Buffer Resources
// =============================================================================

VertexBufferHandle ResourceManager::createVertexBuffer(u32 sizeBytes) {
    if (!device_) return {};
    auto buffer = VertexBuffer::create(*device_, sizeBytes);
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
    if (!device_) return {};
    auto buffer = IndexBuffer::create(*device_, indices.data(), static_cast<u32>(indices.size()));
    if (!buffer) {
        ES_LOG_ERROR("Failed to create index buffer (u32)");
        return IndexBufferHandle();
    }
    return indexBuffers_.add(std::move(buffer));
}

IndexBufferHandle ResourceManager::createIndexBuffer(ConstSpan<u16> indices) {
    if (!device_) return {};
    auto buffer = IndexBuffer::create(*device_, indices.data(), static_cast<u32>(indices.size()));
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
// Bitmap Font Resources
// =============================================================================

BitmapFontHandle ResourceManager::loadBitmapFont(const std::string& fntPath) {
    auto cached = fonts_.findByPath(fntPath);
    if (cached.isValid()) {
        fonts_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

    // Web has no filesystem font-decode path; fonts come via createBitmapFont
    // with content + texture already supplied from JS.
    ES_LOG_ERROR("loadBitmapFont from file not supported on Web");
    stats_.cacheMisses++;
    return BitmapFontHandle();
}

BitmapFontHandle ResourceManager::createBitmapFont(const std::string& fntContent,
                                                     TextureHandle texture,
                                                     u32 texWidth, u32 texHeight) {
    auto font = makeUnique<text::BitmapFont>();
    if (!font->loadFromFntText(fntContent, texture, texWidth, texHeight)) {
        return BitmapFontHandle();
    }
    return fonts_.add(std::move(font));
}

BitmapFontHandle ResourceManager::createLabelAtlasFont(TextureHandle texture,
                                                         u32 texWidth, u32 texHeight,
                                                         const std::string& chars,
                                                         u32 charWidth, u32 charHeight) {
    auto font = makeUnique<text::BitmapFont>();
    font->createLabelAtlas(texture, texWidth, texHeight, chars, charWidth, charHeight);
    return fonts_.add(std::move(font));
}

text::BitmapFont* ResourceManager::getBitmapFont(BitmapFontHandle handle) {
    return fonts_.get(handle);
}

const text::BitmapFont* ResourceManager::getBitmapFont(BitmapFontHandle handle) const {
    return fonts_.get(handle);
}

void ResourceManager::releaseBitmapFont(BitmapFontHandle handle) {
    if (handle.isValid()) {
        fonts_.release(handle.id());
    }
}

u32 ResourceManager::getBitmapFontRefCount(BitmapFontHandle handle) const {
    return fonts_.getRefCount(handle);
}

// =============================================================================
// Statistics
// =============================================================================

ResourceStats ResourceManager::getStats() const {
    stats_.shaderCount = shaders_.size();
    stats_.textureCount = textures_.size();
    stats_.vertexBufferCount = vertexBuffers_.size();
    stats_.indexBufferCount = indexBuffers_.size();
    stats_.textureBytes = textures_.residentBytes();
    return stats_;
}

void ResourceManager::resetCacheStats() {
    stats_.cacheHits = 0;
    stats_.cacheMisses = 0;
}

}  // namespace esengine::resource
