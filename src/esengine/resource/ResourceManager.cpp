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
#include "../text/BitmapFont.hpp"
#ifndef ES_PLATFORM_WEB
#include "loaders/ShaderLoader.hpp"
#include <json.hpp>
#include <fstream>
#include <stb_image.h>
#endif
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

#ifndef ES_PLATFORM_WEB
    stbi_set_flip_vertically_on_load(true);
    hotReloadManager_.init(true);
#endif

    stats_ = {};
    initialized_ = true;
}

void ResourceManager::shutdown() {
    if (!initialized_) {
        return;
    }

    ES_LOG_INFO("ResourceManager shutting down (shaders: {}, textures: {}, vbos: {}, ibos: {}, fonts: {})",
                shaders_.size(), textures_.size(), vertexBuffers_.size(), indexBuffers_.size(), fonts_.size());

#ifndef ES_PLATFORM_WEB
    hotReloadManager_.shutdown();
    shaderPaths_.clear();
#endif

    guidToTexture_.clear();
    textureMetadata_.clear();
    fonts_.clear();
    shaders_.clear();
    textures_.clear();
    vertexBuffers_.clear();
    indexBuffers_.clear();

    initialized_ = false;
    ES_LOG_INFO("ResourceManager shutdown complete");
}

void ResourceManager::update() {
#ifndef ES_PLATFORM_WEB
    if (initialized_) {
        hotReloadManager_.update();
    }
#endif
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

#ifndef ES_PLATFORM_WEB
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
    auto handle = shaders_.add(std::move(result.resource), path);

#ifndef ES_PLATFORM_WEB
    if (handle.isValid()) {
        shaderPaths_[handle.id()] = path;
        hotReloadManager_.watch<Shader>(handle, path, [this, handle](const std::string& p) {
            reloadShader(handle, p);
        });
    }
#endif

    return handle;
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
#endif

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
    auto texture = Texture::create(spec);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from spec");
        return TextureHandle();
    }
    return textures_.add(std::move(texture));
}

TextureHandle ResourceManager::createTexture(u32 width, u32 height, ConstSpan<u8> pixels,
                                              TextureFormat format, bool flipY) {
    std::vector<u8> pixelVec(pixels.begin(), pixels.end());
    auto texture = Texture::create(width, height, pixelVec, format, flipY);
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
    auto handle = textures_.add(std::move(texture), path);

    // Load .meta file if exists
    std::string metaPath = path + ".meta";
    std::ifstream metaFile(metaPath);
    if (metaFile.is_open()) {
        std::string content((std::istreambuf_iterator<char>(metaFile)),
                            std::istreambuf_iterator<char>());
        auto j = nlohmann::json::parse(content, nullptr, false);
        if (!j.is_discarded() && j.contains("sliceBorder")) {
            TextureMetadata metadata;
            auto& sb = j["sliceBorder"];
            metadata.sliceBorder.left = sb.value("left", 0.0f);
            metadata.sliceBorder.right = sb.value("right", 0.0f);
            metadata.sliceBorder.top = sb.value("top", 0.0f);
            metadata.sliceBorder.bottom = sb.value("bottom", 0.0f);
            setTextureMetadata(handle, metadata);
        }
    }

    return handle;
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

u32 ResourceManager::getTextureRefCount(TextureHandle handle) const {
    return textures_.getRefCount(handle);
}

TextureHandle ResourceManager::registerExternalTexture(u32 glTextureId, u32 width, u32 height) {
    auto texture = Texture::createFromExternalId(glTextureId, width, height, TextureFormat::RGBA8);
    if (!texture) {
        ES_LOG_ERROR("Failed to register external texture (GL ID: {})", glTextureId);
        return TextureHandle();
    }
    return textures_.add(std::move(texture));
}

void ResourceManager::registerTextureWithPath(TextureHandle handle, const std::string& path) {
    if (handle.isValid() && !path.empty()) {
        textures_.setPath(handle, path);
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
// Bitmap Font Resources
// =============================================================================

BitmapFontHandle ResourceManager::loadBitmapFont(const std::string& fntPath) {
    auto cached = fonts_.findByPath(fntPath);
    if (cached.isValid()) {
        fonts_.addRef(cached);
        stats_.cacheHits++;
        return cached;
    }

#ifdef ES_PLATFORM_WEB
    ES_LOG_ERROR("loadBitmapFont from file not supported on Web");
    stats_.cacheMisses++;
    return BitmapFontHandle();
#else
    std::ifstream fntFile(fntPath);
    if (!fntFile.is_open()) {
        ES_LOG_ERROR("Failed to open BMFont file: {}", fntPath);
        stats_.cacheMisses++;
        return BitmapFontHandle();
    }

    std::string content((std::istreambuf_iterator<char>(fntFile)),
                         std::istreambuf_iterator<char>());

    auto font = makeUnique<text::BitmapFont>();
    std::string basePath;
    auto lastSlash = fntPath.find_last_of("/\\");
    if (lastSlash != std::string::npos) {
        basePath = fntPath.substr(0, lastSlash);
    }

    if (!font->loadFromFntText(content, basePath, *this)) {
        stats_.cacheMisses++;
        return BitmapFontHandle();
    }

    stats_.cacheMisses++;
    return fonts_.add(std::move(font), fntPath);
#endif
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
    return stats_;
}

void ResourceManager::resetCacheStats() {
    stats_.cacheHits = 0;
    stats_.cacheMisses = 0;
}

#ifndef ES_PLATFORM_WEB
void ResourceManager::reloadShader(ShaderHandle handle, const std::string& path) {
    if (!handle.isValid()) {
        return;
    }

    auto it = shaderPaths_.find(handle.id());
    if (it == shaderPaths_.end()) {
        ES_LOG_ERROR("HotReload: Shader path not found for handle {}", handle.id());
        return;
    }

    ES_LOG_INFO("HotReload: Reloading shader '{}'", path);

    ShaderLoader loader;
    auto result = loader.loadFromFile(path, "");

    ReloadEvent<Shader> event;
    event.handle = handle;
    event.path = path;

    if (!result.isOk()) {
        ES_LOG_ERROR("HotReload: Failed to reload shader '{}': {}", path, result.errorMessage);
        event.success = false;
        event.errorMessage = result.errorMessage;
        hotReloadManager_.onShaderReloaded.publish(event);
        return;
    }

    Shader* oldShader = shaders_.get(handle);
    if (!oldShader) {
        ES_LOG_ERROR("HotReload: Shader handle {} is no longer valid", handle.id());
        event.success = false;
        event.errorMessage = "Shader handle no longer valid";
        hotReloadManager_.onShaderReloaded.publish(event);
        return;
    }

    *oldShader = std::move(*result.resource);

    ES_LOG_INFO("HotReload: Successfully reloaded shader '{}'", path);
    event.success = true;
    hotReloadManager_.onShaderReloaded.publish(event);
}
#endif

}  // namespace esengine::resource
