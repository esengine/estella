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

#include "../core/Half.hpp"
#include "ResourceManager.hpp"
#include "ShaderParser.hpp"
#include "../text/BitmapFont.hpp"
#include "../core/Log.hpp"
#include "../renderer/rhi/GfxDevice.hpp"
#include "../renderer/rhi/Shader.hpp"
#include "../renderer/rhi/Texture.hpp"
#include "../renderer/rhi/Buffer.hpp"

#include <algorithm>
#include <cstring>
#include <vector>

namespace esengine::resource {

namespace {

bool meshOwed(const Mesh& mesh, const std::vector<GfxOwedContent>& owed) {
    for (const GfxOwedContent& entry : owed) {
        if (entry.kind == GfxOwedContent::Kind::Buffer
            && (entry.id == static_cast<u32>(mesh.vertexBuffer) || entry.id == static_cast<u32>(mesh.indexBuffer))) {
            return true;
        }
        if (entry.kind == GfxOwedContent::Kind::Texture && entry.id == static_cast<u32>(mesh.morphTexture)) {
            return true;
        }
    }
    return false;
}

}  // namespace

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

    // Through createEx for the LOG: the device already answers why it refused, and a
    // caller that drops it leaves "failed to create" as the only thing anybody sees.
    auto outcome = Shader::createEx(*device_, vertSrc, fragSrc, {}, language);
    if (!outcome.shader) {
        ES_LOG_ERROR("Failed to create shader from source: {}",
                     outcome.log.empty() ? "no reason given by the device" : outcome.log.c_str());
        return ShaderHandle();
    }
    return shaders_.add(std::move(outcome.shader));
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

GfxContent toGfxContent(ResourceContent content) {
    switch (content) {
    case ResourceContent::Transient: return GfxContent::transient();
    case ResourceContent::Retained:  return GfxContent::retained();
    default:                         return GfxContent::sourced(static_cast<u32>(content), 0);
    }
}

TextureHandle ResourceManager::createTexture(ResourceContent content, const TextureSpecification& spec) {
    if (!device_) return {};
    auto texture = Texture::create(*device_, toGfxContent(content), spec);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from spec");
        return TextureHandle();
    }
    const usize bytes = static_cast<usize>(texture->getWidth()) * texture->getHeight() * 4;
    return textures_.add(std::move(texture), "", bytes);
}

TextureHandle ResourceManager::createTexture(ResourceContent content, u32 width, u32 height,
                                              ConstSpan<u8> pixels, TextureFormat format, bool flipY) {
    if (!device_) return {};
    auto texture = Texture::create(*device_, toGfxContent(content), width, height,
                                   std::span<const u8>(pixels.data(), pixels.size()), format, flipY);
    if (!texture) {
        ES_LOG_ERROR("Failed to create texture from pixels");
        return TextureHandle();
    }
    const usize bytes = static_cast<usize>(width) * height * 4;
    return textures_.add(std::move(texture), "", bytes);
}

TextureHandle ResourceManager::createCompressedTexture(ResourceContent content, u32 width, u32 height,
                                                       GfxCompressedFormat format, ConstSpan<u8> data,
                                                       u32 mipLevels) {
    if (!device_) return {};
    auto texture = Texture::createCompressed(*device_, toGfxContent(content), width, height, format,
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

TextureHandle ResourceManager::registerExternalTexture(ResourceContent content, u32 glTextureId,
                                                       u32 width, u32 height, usize bytes) {
    if (!device_) return {};
    auto texture = Texture::createFromExternalId(*device_, toGfxContent(content), glTextureId,
                                                 width, height, TextureFormat::RGBA8);
    if (!texture || texture->handle() == ::esengine::TextureHandle::Invalid) {
        ES_LOG_ERROR("Failed to register external texture (GL ID: {})", glTextureId);
        return TextureHandle();
    }
    if (bytes == 0) {
        bytes = static_cast<usize>(width) * height * 4;
    }
    return textures_.add(std::move(texture), "", bytes);
}

TextureHandle ResourceManager::wrapDeviceTexture(::esengine::TextureHandle texture, u32 width, u32 height) {
    if (!device_) return {};
    auto wrapper = Texture::borrow(*device_, texture, width, height);
    if (!wrapper) return {};
    // The owner pays for the memory; a borrow costs the budget nothing.
    return textures_.add(std::move(wrapper), "", 0);
}

bool ResourceManager::adoptTextureContent(TextureHandle target, TextureHandle source) {
    Texture* to = textures_.get(target);
    Texture* from = textures_.get(source);
    return to && from && to->adoptContent(*from);
}

std::vector<ResourceManager::OwedTexture> ResourceManager::texturesAwaitingReupload() const {
    std::vector<OwedTexture> out;
    if (!device_) return out;
    const std::vector<GfxOwedContent> owed = device_->owedContent();
    if (owed.empty()) return out;
    textures_.forEachAlive([&](TextureHandle handle, const Texture& texture) {
        for (const GfxOwedContent& entry : owed) {
            if (entry.kind == GfxOwedContent::Kind::Texture && entry.id == texture.getId()) {
                out.push_back({handle, static_cast<ResourceContent>(entry.provider)});
                break;
            }
        }
    });
    return out;
}

void ResourceManager::forgoTextureContent(TextureHandle handle) {
    const Texture* texture = textures_.get(handle);
    if (!device_ || !texture) return;
    for (const GfxOwedContent& entry : device_->owedContent()) {
        if (entry.kind == GfxOwedContent::Kind::Texture && entry.id == texture->getId()) {
            device_->forgoContent(entry);
            return;
        }
    }
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
    if (!handle.isValid()) {
        ++stats_.cacheMisses;
        return handle;
    }
    // A texture still owed its content does not hold this path's pixels, so a
    // residency hit would answer the re-upload with the very thing it replaces —
    // a recovery that confirms itself and draws blank. Empty at rest.
    const Texture* texture = textures_.get(handle);
    for (const GfxOwedContent& entry : device_ ? device_->owedContent() : std::vector<GfxOwedContent>{}) {
        if (texture && entry.kind == GfxOwedContent::Kind::Texture && entry.id == texture->getId()) {
            ++stats_.cacheMisses;
            return TextureHandle{};
        }
    }
    // The cache decision a shipped build makes: it decodes in the host and
    // registers an id, so this is the one place a texture request avoids an
    // upload. loadTexture, which also counts, is a path only BitmapFont takes.
    ++stats_.cacheHits;
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

VertexBufferHandle ResourceManager::createVertexBuffer(GfxContent content, u32 sizeBytes) {
    if (!device_) return {};
    auto buffer = VertexBuffer::create(*device_, content, sizeBytes);
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

namespace {

}  // namespace

bool ResourceManager::realizeMesh(Mesh& mesh, ConstSpan<u8> vertexBytes, ConstSpan<u32> indices,
                                 ConstSpan<GfxVertexAttribute> channels, u32 vertexStride,
                                 const glm::vec3& localMin, const glm::vec3& localMax,
                                 ConstSpan<f32> inverseBind, const MeshMorphSource& morph) {
    if (!device_ || vertexBytes.empty() || indices.empty() || channels.empty()) return false;

    // Every mesh shader reads a colour, and a layout without one is a pipeline WebGPU
    // refuses (WebGL2 reads black). A producer that wrote none meant white, so the
    // channel is added here, where every mesh reaches the device.
    std::vector<u8> coloredBytes;
    std::vector<GfxVertexAttribute> coloredChannels;
    const bool hasColor = std::any_of(channels.begin(), channels.end(), [](const GfxVertexAttribute& c) {
        return c.location == static_cast<u32>(MeshChannel::Color);
    });
    if (!hasColor && vertexStride > 0) {
        const usize count = vertexBytes.size() / vertexStride;
        const u32 colorOffset = (vertexStride + 3u) & ~3u;
        const u32 stride = colorOffset + 4u;
        coloredBytes.assign(count * stride, 0);
        for (usize v = 0; v < count; ++v) {
            std::memcpy(&coloredBytes[v * stride], &vertexBytes[v * vertexStride], vertexStride);
            std::memset(&coloredBytes[v * stride + colorOffset], 0xFF, 4);
        }
        coloredChannels.assign(channels.begin(), channels.end());
        GfxVertexAttribute color;
        color.location = static_cast<u32>(MeshChannel::Color);
        color.components = 4;
        color.type = GfxDataType::UnsignedByte;
        color.normalized = true;
        color.offset = colorOffset;
        coloredChannels.push_back(color);
        vertexBytes = ConstSpan<u8>(coloredBytes);
        channels = ConstSpan<GfxVertexAttribute>(coloredChannels);
        vertexStride = stride;
    }

    // The mesh describes its own vertices and nothing else: the per-object
    // transform reaches the shader through the frame's record texture, which is
    // what leaves every slot above the mesh channels free.
    VertexLayoutDesc layout;
    // A channel no shader reads stays out of the layout (meshShaderReads): it
    // would spend an attribute slot and a fetch per vertex. The stride is
    // unchanged, so the bytes remain for whoever starts reading them.
    u32 bound = 0;
    for (const GfxVertexAttribute& c : channels) {
        if (!meshShaderReads(static_cast<MeshChannel>(c.location))) continue;
        if (bound >= MAX_VERTEX_ATTRIBUTES) {
            ES_LOG_ERROR("realizeMesh: {} bound channels exceeds the layout budget", bound + 1);
            return false;
        }
        layout.attributes[bound] = c;
        layout.attributes[bound].bufferSlot = 0;
        ++bound;
    }
    bool hasNormals = false;
    bool skinned = false;
    bool lightmapUV = false;
    for (const GfxVertexAttribute& c : channels) {
        if (c.location == static_cast<u32>(MeshChannel::Normal)) hasNormals = true;
        if (c.location == static_cast<u32>(MeshChannel::Joints)) skinned = true;
        if (c.location == static_cast<u32>(MeshChannel::TexCoord1)) lightmapUV = true;
    }
    skinned = skinned && !inverseBind.empty();
    // Bones move a character and a bake cannot hold one still, so a skinned mesh
    // reads no atlas however many UV sets it carries — and its record stays the
    // tint alone.
    const bool lightmapped = lightmapUV && !skinned;

    layout.strides[0] = vertexStride;
    layout.attributeCount = bound;

    // The old records go only once the new ones stand: a rematerialization that
    // fails half-way must leave the mesh as it found it, not stripped of the
    // realization it still had.
    const VertexBufferHandle previousVertices = mesh.vertices;
    const IndexBufferHandle previousIndices = mesh.indices;

    // A replayable mesh is refilled by its source; one built in this process has
    // no other copy, so the device keeps it.
    const GfxContent content = mesh.recovery == MeshRecovery::SourceReplayable
        ? toGfxContent(ResourceContent::Mesh)
        : GfxContent::retained();
    const VertexBufferHandle vertices = createVertexBuffer(content, vertexBytes);
    const IndexBufferHandle indices_handle = createIndexBuffer(content, indices);
    const VertexBuffer* vb = getVertexBuffer(vertices);
    const IndexBuffer* ib = getIndexBuffer(indices_handle);
    const VertexLayoutHandle layoutHandle = device_->createVertexLayout(layout);
    // A pool record is not a GPU object. An allocation the device refused still
    // lands in the pool, so its handle reads as valid while naming nothing — the
    // shape in which a failure becomes a mesh that silently draws no triangles.
    if (!vb || !ib || vb->handle() == BufferHandle::Invalid
        || ib->handle() == BufferHandle::Invalid || layoutHandle == VertexLayoutHandle::Invalid) {
        releaseVertexBuffer(vertices);
        releaseIndexBuffer(indices_handle);
        return false;
    }

    releaseVertexBuffer(previousVertices);
    releaseIndexBuffer(previousIndices);

    mesh.vertices = vertices;
    mesh.indices = indices_handle;
    mesh.vertexBuffer = vb->handle();
    mesh.indexBuffer = ib->handle();
    mesh.layout = layoutHandle;
    mesh.indexCount = static_cast<u32>(indices.size());
    mesh.hasNormals = hasNormals;
    mesh.hasLightmapUV = lightmapped;
    mesh.localMin = localMin;
    mesh.localMax = localMax;
    mesh.inverseBind.clear();
    if (skinned) {
        const usize joints = inverseBind.size() / 16;
        mesh.inverseBind.resize(joints);
        std::memcpy(mesh.inverseBind.data(), inverseBind.data(), joints * sizeof(glm::mat4));
    }
    mesh.vertexCount = vertexStride > 0 ? static_cast<u32>(vertexBytes.size()) / vertexStride : 0;

    // The shapes, last: geometry that draws is worth having even when the deltas
    // behind it are refused, and the refusal leaves a mesh in its authored shape
    // rather than no mesh at all.
    const esengine::TextureHandle previousMorph = mesh.morphTexture;
    mesh.morphTexture = esengine::TextureHandle::Invalid;
    mesh.morphTargetCount = 0;
    mesh.morphHasNormals = false;
    if (morph.targetCount > 0 && !morph.deltas.empty()) {
        mesh.morphTexture = createMorphTexture(content, morph, mesh.vertexCount);
        if (mesh.morphTexture != esengine::TextureHandle::Invalid) {
            mesh.morphTargetCount = morph.targetCount;
            mesh.morphHasNormals = morph.hasNormals;
        }
    }
    if (previousMorph != esengine::TextureHandle::Invalid) device_->deleteTexture(previousMorph);
    return true;
}

/**
 * @brief One mesh's deltas as a texture the vertex stage reads.
 *
 * @details A row per MORPH_TEXTURE_WIDTH texels rather than per target: a target
 *          of ten thousand vertices would ask for a texture wider than any
 *          device guarantees. Half precision because a delta is an offset off a
 *          coordinate the vertex already carries at full precision.
 */
esengine::TextureHandle ResourceManager::createMorphTexture(GfxContent content, const MeshMorphSource& morph,
                                                            u32 vertexCount) {
    if (!device_ || vertexCount == 0) return esengine::TextureHandle::Invalid;
    const u32 perVertex = morph.hasNormals ? 2u : 1u;
    const u32 components = morph.hasNormals ? 6u : 3u;
    const u64 texels = static_cast<u64>(morph.targetCount) * vertexCount * perVertex;
    if (morph.deltas.size() < static_cast<u64>(morph.targetCount) * vertexCount * components) {
        ES_LOG_WARN("mesh morph: {} deltas describe fewer than {} targets over {} vertices;"
                    " drawing the authored shape",
                    morph.deltas.size(), morph.targetCount, vertexCount);
        return esengine::TextureHandle::Invalid;
    }
    if (texels > MORPH_MAX_TEXELS) {
        ES_LOG_WARN("mesh morph: {} targets over {} vertices needs {} texels and the largest"
                    " texture here holds {}; drawing the authored shape",
                    morph.targetCount, vertexCount, texels, MORPH_MAX_TEXELS);
        return esengine::TextureHandle::Invalid;
    }

    const u32 height = static_cast<u32>((texels + MORPH_TEXTURE_WIDTH - 1) / MORPH_TEXTURE_WIDTH);
    std::vector<u16> pixels(static_cast<usize>(MORPH_TEXTURE_WIDTH) * height * 4, 0);
    for (u32 t = 0; t < morph.targetCount; ++t) {
        for (u32 v = 0; v < vertexCount; ++v) {
            const usize src = (static_cast<usize>(t) * vertexCount + v) * components;
            const usize dst = (static_cast<usize>(t) * vertexCount + v) * perVertex * 4;
            for (u32 c = 0; c < 3; ++c) pixels[dst + c] = packHalf(morph.deltas[src + c]);
            if (!morph.hasNormals) continue;
            for (u32 c = 0; c < 3; ++c) pixels[dst + 4 + c] = packHalf(morph.deltas[src + 3 + c]);
        }
    }

    TextureDesc desc;
    desc.width = MORPH_TEXTURE_WIDTH;
    desc.height = height;
    desc.format = GfxPixelFormat::RGBA16F;
    // Fetched by texel index, never filtered: a value between two deltas belongs
    // to no vertex, and asking for one is how a half-texel offset gets invented.
    desc.minFilter = TextureFilter::Nearest;
    desc.magFilter = TextureFilter::Nearest;
    desc.wrapS = TextureWrap::ClampToEdge;
    desc.wrapT = TextureWrap::ClampToEdge;
    desc.mipmaps = false;
    return device_->createTexture(desc, content, pixels.data());
}

MeshHandle ResourceManager::createMesh(ConstSpan<u8> vertexBytes, ConstSpan<u32> indices,
                                       ConstSpan<GfxVertexAttribute> channels, u32 vertexStride,
                                       const glm::vec3& localMin, const glm::vec3& localMax,
                                       MeshRecovery recovery, ConstSpan<f32> inverseBind,
                                       const MeshMorphSource& morph) {
    auto mesh = makeUnique<Mesh>();
    mesh->recovery = recovery;
    if (!realizeMesh(*mesh, vertexBytes, indices, channels, vertexStride,
                     localMin, localMax, inverseBind, morph)) {
        return MeshHandle();
    }
    return meshes_.add(std::move(mesh));
}

bool ResourceManager::rematerializeMesh(MeshHandle target, ConstSpan<u8> vertexBytes,
                                        ConstSpan<u32> indices,
                                        ConstSpan<GfxVertexAttribute> channels, u32 vertexStride,
                                        const glm::vec3& localMin, const glm::vec3& localMax,
                                        ConstSpan<f32> inverseBind, const MeshMorphSource& morph) {
    Mesh* mesh = meshes_.get(target);
    if (!mesh) {
        ES_LOG_ERROR("rematerializeMesh: handle {} names no live mesh", target.id());
        return false;
    }
    // A producer's answer is given once, at mint. Recovery replaces geometry; it
    // never gets to decide that geometry is recoverable.
    if (mesh->recovery != MeshRecovery::SourceReplayable) {
        ES_LOG_ERROR("rematerializeMesh: mesh {} is host-only and has no source to replay",
                     target.id());
        return false;
    }
    if (!realizeMesh(*mesh, vertexBytes, indices, channels, vertexStride,
                     localMin, localMax, inverseBind, morph)) {
        ES_LOG_ERROR("rematerializeMesh: mesh {} could not be rebuilt; it stays owed",
                     target.id());
        return false;
    }
    return true;
}

Mesh* ResourceManager::getMesh(MeshHandle handle) {
    return meshes_.get(handle);
}

const Mesh* ResourceManager::getMesh(MeshHandle handle) const {
    return meshes_.get(handle);
}

std::vector<ResourceManager::MeshRealization> ResourceManager::meshRealizations() {
    std::vector<MeshRealization> out;
    const std::vector<GfxOwedContent> owed = device_ ? device_->owedContent() : std::vector<GfxOwedContent>{};
    meshes_.forEachAlive([&](MeshHandle handle, Mesh& mesh) {
        out.push_back({handle.id(), mesh.hasRealization() && !meshOwed(mesh, owed)});
    });
    return out;
}

std::vector<MeshHandle> ResourceManager::meshesAwaitingRematerialization() const {
    std::vector<MeshHandle> out;
    if (!device_) return out;
    const std::vector<GfxOwedContent> owed = device_->owedContent();
    if (owed.empty()) return out;
    meshes_.forEachAlive([&](MeshHandle handle, const Mesh& mesh) {
        if (meshOwed(mesh, owed)) out.push_back(handle);
    });
    return out;
}

void ResourceManager::releaseMesh(MeshHandle handle) {
    Mesh* mesh = meshes_.get(handle);
    if (!mesh) return;
    // The buffers are the mesh's own, so they go with it; the layout is not, since
    // createVertexLayout caches by description and other meshes share the result.
    releaseVertexBuffer(mesh->vertices);
    releaseIndexBuffer(mesh->indices);
    // The delta texture IS the mesh's own — nothing shares it, unlike the layout.
    if (mesh->morphTexture != esengine::TextureHandle::Invalid && device_) {
        device_->deleteTexture(mesh->morphTexture);
    }
    meshes_.release(handle.id());
}

// =============================================================================
// Environment Resources
// =============================================================================

EnvironmentHandle ResourceManager::createEnvironment(ConstSpan<f32> irradiance,
                                                     TextureHandle specular, f32 faceSize,
                                                     u32 mipCount, f32 maxRange, u32 columns) {
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
    environment->columns = std::max(columns, 1u);
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

ProbeVolumeHandle ResourceManager::createProbeVolume(const glm::ivec3& resolution,
                                                     ConstSpan<f32> irradiance) {
    auto volume = std::make_unique<ProbeVolume>();
    volume->resolution = resolution;
    const usize want = static_cast<usize>(volume->probeCount()) * 27;
    if (want == 0 || irradiance.size() != want) {
        ES_LOG_ERROR("createProbeVolume: {}x{}x{} probes want {} coefficients, got {}",
                     resolution.x, resolution.y, resolution.z, want, irradiance.size());
        return ProbeVolumeHandle();
    }
    volume->irradiance.resize(want / 3);
    for (usize i = 0; i < volume->irradiance.size(); ++i) {
        volume->irradiance[i] = {irradiance[i * 3], irradiance[i * 3 + 1], irradiance[i * 3 + 2]};
    }
    return probeVolumes_.add(std::move(volume));
}

ProbeVolume* ResourceManager::getProbeVolume(ProbeVolumeHandle handle) {
    return probeVolumes_.get(handle);
}

const ProbeVolume* ResourceManager::getProbeVolume(ProbeVolumeHandle handle) const {
    return probeVolumes_.get(handle);
}

void ResourceManager::releaseProbeVolume(ProbeVolumeHandle handle) {
    probeVolumes_.release(handle.id());
}

// =============================================================================
// Index Buffer Resources
// =============================================================================

IndexBufferHandle ResourceManager::createIndexBuffer(GfxContent content, ConstSpan<u32> indices) {
    if (!device_) return {};
    auto buffer = IndexBuffer::create(*device_, content, indices.data(), static_cast<u32>(indices.size()));
    if (!buffer) {
        ES_LOG_ERROR("Failed to create index buffer (u32)");
        return IndexBufferHandle();
    }
    return indexBuffers_.add(std::move(buffer));
}

IndexBufferHandle ResourceManager::createIndexBuffer(GfxContent content, ConstSpan<u16> indices) {
    if (!device_) return {};
    auto buffer = IndexBuffer::create(*device_, content, indices.data(), static_cast<u32>(indices.size()));
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
    stats_.retainedBytes = device_ ? device_->retainedBytes() : 0;
    return stats_;
}

void ResourceManager::resetCacheStats() {
    stats_.cacheHits = 0;
    stats_.cacheMisses = 0;
}

}  // namespace esengine::resource
