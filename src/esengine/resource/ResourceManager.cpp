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
#include "ShaderParser.hpp"
#include "../text/BitmapFont.hpp"
#include "../core/Log.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/rhi/Shader.hpp"
#include "../renderer/rhi/Texture.hpp"
#include "../renderer/rhi/Buffer.hpp"

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

GfxShaderLanguage ResourceManager::preferredShaderLanguage() const {
    return (device_ && !device_->supportsShaderLanguage(GfxShaderLanguage::GLSL_ES300))
               ? GfxShaderLanguage::WGSL
               : GfxShaderLanguage::GLSL_ES300;
}

ShaderTargetLanguage ResourceManager::preferredShaderTarget() const {
    return preferredShaderLanguage() == GfxShaderLanguage::WGSL
               ? ShaderTargetLanguage::WGSL
               : ShaderTargetLanguage::GLSL_ES300;
}

ShaderHandle ResourceManager::createShader(const std::string& vertSrc, const std::string& fragSrc,
                                           bool rewriteLoose, GfxShaderLanguage language) {
    if (!device_) return {};

    // Lift loose non-sampler uniforms into a std140 DrawParams block, so this
    // shader's parameters flow through the UBO seam (setUniform writes the CPU
    // shadow; commitParams uploads + binds). ShaderParser-assembled material
    // sources pass rewriteLoose=false: their params already live in
    // MaterialConstants and only sampler uniforms remain loose. The rewriter is
    // a GLSL-source transform — other languages skip it.
    if (rewriteLoose && language == GfxShaderLanguage::GLSL_ES300) {
        DrawParamsRewrite rw = rewriteLooseUniforms(vertSrc, fragSrc);
        if (!rw.layout.empty()) {
            auto shader = Shader::create(*device_, rw.vertexSrc, rw.fragmentSrc);
            if (shader) {
                shader->adoptDrawParams(std::move(rw.layout));
                return shaders_.add(std::move(shader));
            }
            // The unmodified source is the author's ground truth — if the lifted
            // form fails to compile (a rewriter blind spot), fall back to it
            // loudly rather than failing a shader that used to work.
            ES_LOG_WARN("DrawParams rewrite failed to compile; retrying shader with loose uniforms");
        }
    }

    auto shader = Shader::create(*device_, vertSrc, fragSrc, language);
    if (!shader) {
        ES_LOG_ERROR("Failed to create shader from source");
        return ShaderHandle();
    }
    return shaders_.add(std::move(shader));
}

ShaderHandle ResourceManager::createShaderWithBindings(const std::string& vertSrc, const std::string& fragSrc,
                                                        std::initializer_list<AttribBinding> bindings,
                                                        GfxShaderLanguage language) {
    if (!device_) return {};
    auto shader = Shader::createWithBindings(*device_, vertSrc, fragSrc, bindings, language);
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

TextureHandle ResourceManager::createCompressedTexture(u32 width, u32 height,
                                                       GfxCompressedFormat format, ConstSpan<u8> data,
                                                       u32 mipLevels) {
    if (!device_) return {};
    auto texture = Texture::createCompressed(*device_, width, height, format,
                                             std::span<const u8>(data.data(), data.size()), mipLevels);
    if (!texture) {
        ES_LOG_ERROR("Failed to create compressed texture");
        return TextureHandle();
    }
    // Residency cost is the on-GPU compressed size, not the RGBA expansion.
    return textures_.add(std::move(texture), "", data.size());
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
    if (!handle.isValid()) return;
    const bool lastRef = textures_.getRefCount(handle) == 1;
    textures_.release(handle.id());
    // Drop the sidecar metadata + GUID mapping only when the texture is TRULY gone.
    // Under an eviction budget the last release keeps it resident and revivable
    // (findByPath + addRef re-holds the SAME handle), so erasing here would strand
    // a revived texture without its nine-slice metadata / GUID lookup.
    if (lastRef && !textures_.isEvictable(handle)) {
        textureMetadata_.erase(handle.id());
        for (auto it = guidToTexture_.begin(); it != guidToTexture_.end(); ) {
            if (it->second == handle) {
                it = guidToTexture_.erase(it);
            } else {
                ++it;
            }
        }
    }
}

u32 ResourceManager::getTextureRefCount(TextureHandle handle) const {
    return textures_.getRefCount(handle);
}

TextureHandle ResourceManager::registerExternalTexture(u32 glTextureId, u32 width, u32 height, usize bytes) {
    if (!device_) return {};
    auto texture = Texture::createFromExternalId(*device_, glTextureId, width, height, TextureFormat::RGBA8);
    if (!texture) {
        ES_LOG_ERROR("Failed to register external texture (GL ID: {})", glTextureId);
        return TextureHandle();
    }
    if (bytes == 0) {
        bytes = static_cast<usize>(width) * height * 4;
    }
    return textures_.add(std::move(texture), "", bytes);
}

u32 ResourceManager::recreateGpuShaders() {
    u32 rebuilt = 0;
    u32 failed = 0;
    shaders_.forEachAlive([&](ShaderHandle, Shader& shader) {
        if (shader.recompile()) ++rebuilt;
        else ++failed;
    });
    if (failed > 0) ES_LOG_ERROR("Device recovery: {} shader(s) failed to rebuild", failed);
    ES_LOG_INFO("Device recovery: {} shader(s) rebuilt behind their handles", rebuilt);
    return rebuilt;
}

u32 ResourceManager::releaseLostGpuShaders() {
    u32 released = 0;
    shaders_.forEachAlive([&](ShaderHandle, Shader& shader) {
        shader.releaseProgram();
        ++released;
    });
    return released;
}

void ResourceManager::invalidateGpuTextures(::esengine::TextureHandle placeholder) {
    awaitingReupload_.clear();
    textures_.forEachAlive([&](TextureHandle handle, Texture& texture) {
        // Retargeted, never deleted: the GPU object is already gone, and asking
        // a dead device to free its id is at best a no-op. owns=false so the
        // shared placeholder is not freed when one of them is released.
        texture.retarget(placeholder, /*owns=*/false);
        awaitingReupload_.push_back(handle);
    });
    ES_LOG_INFO("Device loss: {} texture(s) now on the placeholder, awaiting re-upload",
                awaitingReupload_.size());
}

bool ResourceManager::retargetExternalTexture(TextureHandle handle, u32 glTextureId,
                                              u32 width, u32 height) {
    if (!device_) return false;
    Texture* texture = textures_.get(handle);
    if (!texture) return false;

    TextureDesc desc;
    desc.width = width;
    desc.height = height;
    desc.format = GfxPixelFormat::RGBA8;
    texture->retarget(device_->importExternalTexture(glTextureId, desc), /*owns=*/false);

    for (usize i = 0; i < awaitingReupload_.size(); ++i) {
        if (awaitingReupload_[i] == handle) {
            awaitingReupload_[i] = awaitingReupload_.back();
            awaitingReupload_.pop_back();
            break;
        }
    }
    return true;
}

bool ResourceManager::adoptTextureContent(TextureHandle target, TextureHandle source) {
    Texture* to = textures_.get(target);
    Texture* from = textures_.get(source);
    if (!to || !from) return false;

    // Ownership moves with the object: the source record is about to be released,
    // and a borrowed GPU texture whose owner is freed is a dangling bind.
    const ::esengine::TextureHandle gpu = from->handle();
    from->retarget(::esengine::TextureHandle::Invalid, /*owns=*/false);
    to->retarget(gpu, /*owns=*/true);

    for (usize i = 0; i < awaitingReupload_.size(); ++i) {
        if (awaitingReupload_[i] == target) {
            awaitingReupload_[i] = awaitingReupload_.back();
            awaitingReupload_.pop_back();
            break;
        }
    }
    return true;
}

std::vector<TextureHandle> ResourceManager::texturesAwaitingReupload() const {
    return awaitingReupload_;
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
    if (!handle.isValid()) return handle;
    // A texture on the placeholder no longer holds this path's content, so a
    // residency hit answers the re-upload with the very thing it replaces — a
    // recovery that confirms itself and draws white. Linear: empty at rest.
    for (TextureHandle awaiting : awaitingReupload_) {
        if (awaiting == handle) return TextureHandle{};
    }
    textures_.addRef(handle);
    return handle;
}

bool ResourceManager::invalidateTexturePath(const std::string& path) {
    return textures_.invalidatePath(path);
}

usize ResourceManager::trimTextureCache() {
    return textures_.trimEvictables();
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
// Mesh Resources
// =============================================================================

MeshHandle ResourceManager::createMesh(ConstSpan<u8> vertexBytes, ConstSpan<u32> indices,
                                       ConstSpan<GfxVertexAttribute> channels, u32 vertexStride,
                                       const glm::vec3& localMin, const glm::vec3& localMax,
                                       ConstSpan<f32> inverseBind) {
    if (!device_ || vertexBytes.empty() || indices.empty() || channels.empty()) return MeshHandle();

    // The mesh describes its own vertices; the per-object transform is the
    // engine's and is appended here, so no caller has to know how a transform
    // reaches the shader — the reason a mesh is drawn without touching its bytes.
    VertexLayoutDesc layout;
    if (channels.size() + MESH_INSTANCE_ATTRIBUTES > MAX_VERTEX_ATTRIBUTES) {
        ES_LOG_ERROR("createMesh: {} channels exceeds the layout budget", channels.size());
        return MeshHandle();
    }
    for (usize i = 0; i < channels.size(); ++i) {
        layout.attributes[i] = channels[i];
        layout.attributes[i].bufferSlot = 0;
    }
    bool hasNormals = false;
    bool skinned = false;
    for (const GfxVertexAttribute& c : channels) {
        if (c.location == static_cast<u32>(MeshChannel::Normal)) hasNormals = true;
        if (c.location == static_cast<u32>(MeshChannel::Joints)) skinned = true;
    }
    skinned = skinned && !inverseBind.empty();

    layout.strides[0] = vertexStride;
    layout.strides[1] = skinned ? MESH_INSTANCE_STRIDE_SKINNED
                       : hasNormals ? MESH_INSTANCE_STRIDE_LIT : MESH_INSTANCE_STRIDE;
    layout.instanceStep[1] = true;
    u32 next = static_cast<u32>(channels.size());
    // Only where the shader will read them: a layout may not declare an attribute
    // its shader does not consume, which WebGPU rejects. A skinned record thus
    // carries neither model nor normal matrix — its bones are world-space.
    if (!skinned) {
        for (u32 row = 0; row < 4; ++row) {
            layout.attributes[next++] = {MESH_INSTANCE_FIRST_LOCATION + row, 4, GfxDataType::Float,
                                         false, row * 16u, 1};
        }
    }
    layout.attributes[next++] = {MESH_INSTANCE_FIRST_LOCATION + 4, 4, GfxDataType::UnsignedByte,
                                 true, skinned ? 0u : 64u, 1};
    if (hasNormals && !skinned) {
        for (u32 row = 0; row < 3; ++row) {
            layout.attributes[next++] = {MESH_INSTANCE_FIRST_LOCATION + 5 + row, 3,
                                         GfxDataType::Float, false, 68 + row * 12u, 1};
        }
    }
    layout.attributeCount = next;

    auto mesh = makeUnique<Mesh>();
    mesh->vertices = createVertexBuffer(vertexBytes);
    mesh->indices = createIndexBuffer(indices);
    if (!mesh->vertices.isValid() || !mesh->indices.isValid()) {
        releaseVertexBuffer(mesh->vertices);
        releaseIndexBuffer(mesh->indices);
        return MeshHandle();
    }

    const VertexBuffer* vb = getVertexBuffer(mesh->vertices);
    const IndexBuffer* ib = getIndexBuffer(mesh->indices);
    mesh->vertexBuffer = vb ? vb->handle() : BufferHandle::Invalid;
    mesh->indexBuffer = ib ? ib->handle() : BufferHandle::Invalid;
    mesh->layout = device_->createVertexLayout(layout);
    mesh->indexCount = static_cast<u32>(indices.size());
    mesh->hasNormals = hasNormals;
    mesh->localMin = localMin;
    mesh->localMax = localMax;
    if (skinned) {
        const usize joints = inverseBind.size() / 16;
        mesh->inverseBind.resize(joints);
        std::memcpy(mesh->inverseBind.data(), inverseBind.data(), joints * sizeof(glm::mat4));
    }
    return meshes_.add(std::move(mesh));
}

Mesh* ResourceManager::getMesh(MeshHandle handle) {
    return meshes_.get(handle);
}

const Mesh* ResourceManager::getMesh(MeshHandle handle) const {
    return meshes_.get(handle);
}

void ResourceManager::releaseMesh(MeshHandle handle) {
    Mesh* mesh = meshes_.get(handle);
    if (!mesh) return;
    // The buffers are the mesh's own, so they go with it; the layout is not, since
    // createVertexLayout caches by description and other meshes share the result.
    releaseVertexBuffer(mesh->vertices);
    releaseIndexBuffer(mesh->indices);
    meshes_.release(handle.id());
}

// =============================================================================
// Environment Resources
// =============================================================================

EnvironmentHandle ResourceManager::createEnvironment(ConstSpan<f32> irradiance,
                                                     TextureHandle specular, f32 faceSize,
                                                     u32 mipCount, f32 maxRange) {
    if (irradiance.size() != 27) {
        ES_LOG_ERROR("createEnvironment: {} coefficients, want 27", irradiance.size());
        return EnvironmentHandle();
    }
    auto environment = std::make_unique<Environment>();
    for (usize i = 0; i < 9; ++i) {
        environment->irradiance[i] = {irradiance[i * 3], irradiance[i * 3 + 1],
                                      irradiance[i * 3 + 2]};
    }
    environment->specular = specular;
    environment->faceSize = faceSize;
    environment->mipCount = mipCount;
    environment->maxRange = maxRange;
    return environments_.add(std::move(environment));
}

Environment* ResourceManager::getEnvironment(EnvironmentHandle handle) {
    return environments_.get(handle);
}

const Environment* ResourceManager::getEnvironment(EnvironmentHandle handle) const {
    return environments_.get(handle);
}

void ResourceManager::releaseEnvironment(EnvironmentHandle handle) {
    environments_.release(handle.id());
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
    stats_.textureBudget = textures_.budget();
    stats_.textureEvictableCount = textures_.evictableCount();
    return stats_;
}

void ResourceManager::resetCacheStats() {
    stats_.cacheHits = 0;
    stats_.cacheMisses = 0;
}

}  // namespace esengine::resource
