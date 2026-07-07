// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUDevice.cpp
 * @brief   WebGPU backend (REARCH_WGSL Phase 2): resources + the live render
 *          path — surface, pass encoding with depth-stencil attachments, lazy
 *          per-DS-shape pipelines, texture/sampler bind groups, draws, and the
 *          internal clear-triangle emulations.
 */
#include "WebGPUDevice.hpp"
#include "WebGPUMappings.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cstring>

namespace esengine {

using namespace webgpu;

namespace {
WGPUStringView sv(const char* text) {
    WGPUStringView view{};
    view.data = text;
    view.length = text ? std::strlen(text) : 0;
    return view;
}

bool isDepthFormat(WGPUTextureFormat format) {
    return format == WGPUTextureFormat_Depth24Plus ||
           format == WGPUTextureFormat_Depth24PlusStencil8;
}

u32 dsVariantOf(WGPUTextureFormat format) {
    if (format == WGPUTextureFormat_Undefined) return WebGPUDevice::kDsNone;
    return hasStencilPlanes(format) ? WebGPUDevice::kDsDepthStencil : WebGPUDevice::kDsDepthOnly;
}

u8 packSamplerKey(TextureFilter minFilter, TextureFilter magFilter,
                  TextureWrap wrapS, TextureWrap wrapT) {
    return static_cast<u8>((minFilter == TextureFilter::Nearest ? 1u : 0u) |
                           (magFilter == TextureFilter::Nearest ? 2u : 0u) |
                           (static_cast<u32>(wrapS) << 2) |
                           (static_cast<u32>(wrapT) << 4));
}
}  // namespace

WebGPUDevice::WebGPUDevice(WGPUDevice device) : device_(device) {
    if (device_) {
        queue_ = wgpuDeviceGetQueue(device_);
        instance_ = wgpuCreateInstance(nullptr);
    }
}

WebGPUDevice::~WebGPUDevice() {
    shutdown();
}

void WebGPUDevice::init() {}

void WebGPUDevice::shutdown() {
    for (auto& [id, rec] : buffers_) {
        if (rec.buffer) wgpuBufferRelease(rec.buffer);
    }
    buffers_.clear();
    for (auto& [id, rec] : textures_) {
        if (rec.view) wgpuTextureViewRelease(rec.view);
        if (rec.texture) wgpuTextureRelease(rec.texture);
    }
    textures_.clear();
    for (auto& [id, rec] : programs_) {
        if (rec.vertex) wgpuShaderModuleRelease(rec.vertex);
        if (rec.fragment) wgpuShaderModuleRelease(rec.fragment);
    }
    programs_.clear();
    layouts_.clear();
    for (auto& [id, rec] : pipelines_) {
        for (WGPURenderPipeline variant : rec.variants) {
            if (variant) wgpuRenderPipelineRelease(variant);
        }
    }
    pipelines_.clear();
    if (bind_group_) { wgpuBindGroupRelease(bind_group_); bind_group_ = nullptr; }
    if (texture_group_) { wgpuBindGroupRelease(texture_group_); texture_group_ = nullptr; }
    if (clear_bind_group_) { wgpuBindGroupRelease(clear_bind_group_); clear_bind_group_ = nullptr; }
    for (auto& [key, pipeline] : clear_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    clear_pipelines_.clear();
    if (clear_layout_) { wgpuPipelineLayoutRelease(clear_layout_); clear_layout_ = nullptr; }
    if (clear_bgl_) { wgpuBindGroupLayoutRelease(clear_bgl_); clear_bgl_ = nullptr; }
    framebuffers_.clear();
    for (auto& [key, sampler] : samplers_) {
        if (sampler) wgpuSamplerRelease(sampler);
    }
    samplers_.clear();
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    if (surface_) { wgpuSurfaceRelease(surface_); surface_ = nullptr; }
    if (instance_) { wgpuInstanceRelease(instance_); instance_ = nullptr; }
}

// =============================================================================
// Surface (bring-up: a canvas is the Default framebuffer)
// =============================================================================

bool WebGPUDevice::configureSurface(const char* selector, u32 width, u32 height) {
    if (!device_ || !instance_) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface: no device/instance");
        return false;
    }

    WGPUEmscriptenSurfaceSourceCanvasHTMLSelector canvas{};
    canvas.chain.sType = WGPUSType_EmscriptenSurfaceSourceCanvasHTMLSelector;
    canvas.selector = sv(selector);

    WGPUSurfaceDescriptor sd{};
    sd.nextInChain = &canvas.chain;
    surface_ = wgpuInstanceCreateSurface(instance_, &sd);
    if (!surface_) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface: surface creation failed for '{}'", selector);
        return false;
    }

    // The canvas swapchain prefers BGRA on most platforms; RGBA8 is universally
    // valid for emscripten surfaces and keeps readback simple during bring-up.
    surface_format_ = WGPUTextureFormat_RGBA8Unorm;
    WGPUSurfaceConfiguration cfg{};
    cfg.device = device_;
    cfg.format = surface_format_;
    cfg.usage = WGPUTextureUsage_RenderAttachment;
    cfg.width = width;
    cfg.height = height;
    cfg.alphaMode = WGPUCompositeAlphaMode_Opaque;
    cfg.presentMode = WGPUPresentMode_Fifo;
    wgpuSurfaceConfigure(surface_, &cfg);
    surface_width_ = width;
    surface_height_ = height;

    // The default target's companion depth-stencil planes — the WebGL canvas has
    // them implicitly, and engine stencil masks / depth-tested draws target the
    // backbuffer expecting both.
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    WGPUTextureDescriptor dd{};
    dd.dimension = WGPUTextureDimension_2D;
    dd.format = WGPUTextureFormat_Depth24PlusStencil8;
    dd.size = WGPUExtent3D{width, height, 1};
    dd.mipLevelCount = 1;
    dd.sampleCount = 1;
    dd.usage = WGPUTextureUsage_RenderAttachment;
    surface_depth_texture_ = wgpuDeviceCreateTexture(device_, &dd);
    if (surface_depth_texture_) {
        surface_depth_view_ = wgpuTextureCreateView(surface_depth_texture_, nullptr);
    }
    return surface_depth_view_ != nullptr;
}

void WebGPUDevice::stubOnce(const char* what) {
    for (const auto& logged : stub_logged_) {
        if (logged == what) return;
    }
    stub_logged_.emplace_back(what);
    ES_LOG_WARN("WebGPUDevice: {} not implemented yet (REARCH_WGSL Phase 2 slice 2)", what);
}

// =============================================================================
// Dynamic state (recorded in slice 2's pass encoder)
// =============================================================================

void WebGPUDevice::setViewport(i32 x, i32 y, u32 w, u32 h) {
    if (pass_) {
        wgpuRenderPassEncoderSetViewport(pass_, static_cast<f32>(x), static_cast<f32>(y),
                                         static_cast<f32>(w), static_cast<f32>(h), 0.0f, 1.0f);
    }
}

void WebGPUDevice::clearStencil(i32 value) {
    // Mid-pass stencil reset (mask rebuild) — the one clear that cannot restart
    // the pass. Emulated with a stencil-write triangle under whatever scissor is
    // currently active, matching GL's glClear-honors-scissor semantics.
    if (!pass_) {
        ES_LOG_WARN("WebGPUDevice::clearStencil: no active pass");
        return;
    }
    if (!hasStencilPlanes(pass_ds_format_)) {
        ES_LOG_WARN("WebGPUDevice::clearStencil: pass target has no stencil planes");
        return;
    }
    drawInternalClear(false, false, true, nullptr, value, nullptr);
}

void WebGPUDevice::setScissorTest(bool enabled) {
    // WebGPU's scissor is always on; "disabled" = the full target rectangle.
    if (pass_ && !enabled) {
        wgpuRenderPassEncoderSetScissorRect(pass_, 0, 0, pass_width_, pass_height_);
    }
}

void WebGPUDevice::setScissor(i32 x, i32 y, i32 w, i32 h) {
    if (pass_ && w > 0 && h > 0) {
        wgpuRenderPassEncoderSetScissorRect(pass_, static_cast<u32>(x), static_cast<u32>(y),
                                            static_cast<u32>(w), static_cast<u32>(h));
    }
}

// =============================================================================
// Buffers
// =============================================================================

BufferHandle WebGPUDevice::createBuffer(const BufferDesc& desc, const void* initialData) {
    if (!device_) {
        ES_LOG_ERROR("WebGPUDevice::createBuffer: no device");
        return BufferHandle::Invalid;
    }

    WGPUBufferDescriptor bd{};
    bd.usage = toWGPUBufferUsage(desc.usage);
    // WriteBuffer requires 4-byte multiples; keep the GL-side size contract by
    // rounding the allocation, never the caller's data.
    bd.size = (desc.size + 3u) & ~3u;

    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device_, &bd);
    if (!buffer) {
        ES_LOG_ERROR("WebGPUDevice::createBuffer: creation failed ({} bytes)", desc.size);
        return BufferHandle::Invalid;
    }

    const u32 id = next_id_++;
    buffers_[id] = BufferRec{buffer, desc.size, desc.usage};

    if (initialData && desc.size > 0) {
        wgpuQueueWriteBuffer(queue_, buffer, 0, initialData, (desc.size + 3u) & ~3u);
    }
    return BufferHandle{id};
}

void WebGPUDevice::deleteBuffer(BufferHandle buffer) {
    auto it = buffers_.find(static_cast<u32>(buffer));
    if (it == buffers_.end()) return;
    if (it->second.buffer) wgpuBufferRelease(it->second.buffer);
    buffers_.erase(it);
}

void WebGPUDevice::updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes) {
    auto it = buffers_.find(static_cast<u32>(buffer));
    if (it == buffers_.end() || !data || sizeBytes == 0) return;
    if (offsetBytes + sizeBytes > it->second.size) {
        ES_LOG_ERROR("WebGPUDevice::updateBuffer: range {}+{} exceeds buffer size {}",
                     offsetBytes, sizeBytes, it->second.size);
        return;
    }
    wgpuQueueWriteBuffer(queue_, it->second.buffer, offsetBytes, data, sizeBytes);
}

void WebGPUDevice::resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data) {
    auto it = buffers_.find(static_cast<u32>(buffer));
    if (it == buffers_.end()) return;

    // The RHI contract: the handle stays stable across growth. WebGPU buffers are
    // fixed-size, so re-create the WGPUBuffer behind the same id.
    if (it->second.buffer) wgpuBufferRelease(it->second.buffer);

    WGPUBufferDescriptor bd{};
    bd.usage = toWGPUBufferUsage(it->second.usage);
    bd.size = (sizeBytes + 3u) & ~3u;
    it->second.buffer = wgpuDeviceCreateBuffer(device_, &bd);
    it->second.size = sizeBytes;

    if (data && sizeBytes > 0 && it->second.buffer) {
        wgpuQueueWriteBuffer(queue_, it->second.buffer, 0, data, (sizeBytes + 3u) & ~3u);
    }
}

void WebGPUDevice::setUniformBuffer(u32 slot, BufferHandle buffer) {
    if (slot >= kUniformSlots) return;
    const u32 id = static_cast<u32>(buffer);
    if (uniform_slots_[slot] != id) {
        uniform_slots_[slot] = id;
        bind_group_dirty_ = true;
    }
}

// =============================================================================
// Vertex layouts (descriptors retained; pipelines consume them at build time)
// =============================================================================

VertexLayoutHandle WebGPUDevice::createVertexLayout(const VertexLayoutDesc& desc) {
    // Validate every attribute has a WebGPU spelling up front — a mismatch is an
    // engine bug, not a runtime condition.
    for (u32 i = 0; i < desc.attributeCount; ++i) {
        const auto& a = desc.attributes[i];
        if (toWGPUVertexFormat(a.components, a.type, a.normalized) == kInvalidVertexFormat) {
            ES_LOG_ERROR("WebGPUDevice::createVertexLayout: attribute {} ({} x type {}) has no WGPU format",
                         i, a.components, static_cast<u32>(a.type));
            return VertexLayoutHandle::Invalid;
        }
    }
    const u32 id = next_id_++;
    layouts_[id] = desc;
    return VertexLayoutHandle{id};
}

void WebGPUDevice::deleteVertexLayout(VertexLayoutHandle layout) {
    layouts_.erase(static_cast<u32>(layout));
}

void WebGPUDevice::setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) {
    auto it = buffers_.find(static_cast<u32>(buffer));
    if (!pass_ || it == buffers_.end()) return;
    wgpuRenderPassEncoderSetVertexBuffer(pass_, slot, it->second.buffer, offsetBytes,
                                         it->second.size - offsetBytes);
}

void WebGPUDevice::setIndexBuffer(BufferHandle buffer) {
    // The RHI carries the index TYPE on the draw, not the bind - record the
    // buffer and bind it at draw time with the draw's format.
    bound_index_buffer_ = static_cast<u32>(buffer);
}

const VertexLayoutDesc* WebGPUDevice::layoutDesc(VertexLayoutHandle handle) const {
    auto it = layouts_.find(static_cast<u32>(handle));
    return it != layouts_.end() ? &it->second : nullptr;
}

const PipelineDesc* WebGPUDevice::pipelineDesc(PipelineHandle handle) const {
    auto it = pipelines_.find(static_cast<u32>(handle));
    return it != pipelines_.end() ? &it->second.desc : nullptr;
}

// =============================================================================
// Textures
// =============================================================================

TextureHandle WebGPUDevice::createTexture(const TextureDesc& desc, const void* pixels) {
    if (!device_) {
        ES_LOG_ERROR("WebGPUDevice::createTexture: no device");
        return TextureHandle::Invalid;
    }

    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.format = toWGPUTextureFormat(desc.format);
    td.size = WGPUExtent3D{desc.width, desc.height, 1};
    td.mipLevelCount = 1;
    td.sampleCount = 1;
    // Depth-stencil textures are attachment-only: writeTexture cannot fill them
    // and the engine never samples its depth attachments.
    td.usage = isDepthFormat(td.format)
                   ? WGPUTextureUsage_RenderAttachment
                   : (WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst |
                      WGPUTextureUsage_RenderAttachment);

    WGPUTexture texture = wgpuDeviceCreateTexture(device_, &td);
    if (!texture) {
        ES_LOG_ERROR("WebGPUDevice::createTexture: creation failed ({}x{})", desc.width, desc.height);
        return TextureHandle::Invalid;
    }

    const u32 id = next_id_++;
    textures_[id] = TextureRec{texture, wgpuTextureCreateView(texture, nullptr),
                               desc.width, desc.height, td.format,
                               packSamplerKey(desc.minFilter, desc.magFilter,
                                              desc.wrapS, desc.wrapT)};

    if (pixels && !isDepthFormat(td.format)) {
        updateTexture(TextureHandle{id}, 0, 0, desc.width, desc.height, pixels, false);
    }
    return TextureHandle{id};
}

TextureHandle WebGPUDevice::createCompressedTexture(const TextureDesc&, GfxCompressedFormat,
                                                    const void*, u32) {
    stubOnce("createCompressedTexture");
    return TextureHandle::Invalid;
}

TextureHandle WebGPUDevice::importExternalTexture(u32, const TextureDesc&) {
    // GL-id import has no WebGPU meaning; external surfaces arrive as WGPUTexture
    // in a later slice (canvas/video import path).
    stubOnce("importExternalTexture");
    return TextureHandle::Invalid;
}

void WebGPUDevice::deleteTexture(TextureHandle texture) {
    auto it = textures_.find(static_cast<u32>(texture));
    if (it == textures_.end()) return;
    if (it->second.view) wgpuTextureViewRelease(it->second.view);
    if (it->second.texture) wgpuTextureRelease(it->second.texture);
    textures_.erase(it);
}

void WebGPUDevice::updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                                 const void* pixels, bool flipY) {
    auto it = textures_.find(static_cast<u32>(texture));
    if (it == textures_.end() || !pixels || !queue_) return;
    if (isDepthFormat(it->second.format)) {
        ES_LOG_ERROR("WebGPUDevice::updateTexture: depth-stencil textures are attachment-only");
        return;
    }
    if (flipY) {
        // The GL backend flips via UNPACK_FLIP_Y_WEBGL; WebGPU has no upload flip.
        // Slice 2 decides the single flip point (CPU pre-flip at the loader).
        stubOnce("updateTexture(flipY)");
    }

    WGPUTexelCopyTextureInfo dst{};
    dst.texture = it->second.texture;
    dst.origin = WGPUOrigin3D{static_cast<u32>(x), static_cast<u32>(y), 0};

    WGPUTexelCopyBufferLayout layout{};
    layout.bytesPerRow = width * 4;  // RGBA8 — the engine's only uncompressed upload format
    layout.rowsPerImage = height;

    WGPUExtent3D extent{width, height, 1};
    wgpuQueueWriteTexture(queue_, &dst, pixels,
                          static_cast<usize>(width) * height * 4, &layout, &extent);
}

void WebGPUDevice::setTextureParams(TextureHandle texture, TextureFilter minFilter,
                                    TextureFilter magFilter, TextureWrap wrapS, TextureWrap wrapT) {
    // GL's texture-object sampler state, de-combined: the texture record carries
    // its params key and the bind group pairs it with a cached sampler object.
    auto it = textures_.find(static_cast<u32>(texture));
    if (it == textures_.end()) return;
    const u8 key = packSamplerKey(minFilter, magFilter, wrapS, wrapT);
    if (it->second.samplerKey == key) return;
    it->second.samplerKey = key;
    for (u32 slot = 0; slot < kTextureSlots; ++slot) {
        if (texture_slots_[slot] == it->first) {
            bind_group_dirty_ = true;
            break;
        }
    }
}

void WebGPUDevice::generateMipmaps(TextureHandle) { stubOnce("generateMipmaps"); }

void WebGPUDevice::bindTexture(u32 slot, TextureHandle texture) {
    if (slot >= kTextureSlots) return;
    const u32 id = static_cast<u32>(texture);
    if (texture_slots_[slot] != id) {
        texture_slots_[slot] = id;
        bind_group_dirty_ = true;
    }
    if (id != 0) any_texture_bound_ = true;
}

bool WebGPUDevice::supportsCompressedFormat(GfxCompressedFormat format) {
    // Real capability negotiation (adapter features) arrives with the adapter
    // plumbing; ETC2 is core on WebGPU-with-compat targets we care about.
    return toWGPUCompressedFormat(format) != WGPUTextureFormat_Undefined;
}

// =============================================================================
// Programs (WGSL shader modules)
// =============================================================================

ShaderHandle WebGPUDevice::createProgram(const GfxShaderSource& source,
                                         const GfxAttribBinding*, u32,
                                         std::string* outLog, GfxShaderStage* outFailedStage) {
    if (source.language != GfxShaderLanguage::WGSL) {
        if (outLog) *outLog = "WebGPUDevice compiles WGSL only";
        if (outFailedStage) *outFailedStage = GfxShaderStage::Vertex;
        ES_LOG_ERROR("WebGPUDevice::createProgram: unsupported shader language");
        return ShaderHandle::Invalid;
    }
    if (!device_) {
        if (outLog) *outLog = "no WGPUDevice";
        ES_LOG_ERROR("WebGPUDevice::createProgram: no device");
        return ShaderHandle::Invalid;
    }

    auto makeModule = [&](const char* code) -> WGPUShaderModule {
        WGPUShaderSourceWGSL wgsl{};
        wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
        wgsl.code = sv(code);
        WGPUShaderModuleDescriptor md{};
        md.nextInChain = &wgsl.chain;
        return wgpuDeviceCreateShaderModule(device_, &md);
    };

    ProgramRec rec{};
    rec.vertex = makeModule(source.vertexSrc);
    rec.fragment = makeModule(source.fragmentSrc);
    // Group 1 is the texture set by engine convention; a program that never
    // spells it must never have the group bound (auto layouts omit it).
    rec.usesTextureGroup = (source.fragmentSrc && std::strstr(source.fragmentSrc, "@group(1)")) ||
                           (source.vertexSrc && std::strstr(source.vertexSrc, "@group(1)"));
    if (!rec.vertex || !rec.fragment) {
        if (rec.vertex) wgpuShaderModuleRelease(rec.vertex);
        if (rec.fragment) wgpuShaderModuleRelease(rec.fragment);
        if (outLog) *outLog = "shader module creation failed";
        if (outFailedStage) *outFailedStage = rec.vertex ? GfxShaderStage::Fragment : GfxShaderStage::Vertex;
        return ShaderHandle::Invalid;
    }

    const u32 id = next_id_++;
    programs_[id] = rec;
    return ShaderHandle{id};
}

void WebGPUDevice::deleteProgram(ShaderHandle program) {
    auto it = programs_.find(static_cast<u32>(program));
    if (it == programs_.end()) return;
    if (it->second.vertex) wgpuShaderModuleRelease(it->second.vertex);
    if (it->second.fragment) wgpuShaderModuleRelease(it->second.fragment);
    programs_.erase(it);
}

void WebGPUDevice::useProgram(ShaderHandle) { /* programs bind via pipelines */ }

// Loose uniforms do not exist on WebGPU: all uniform data rides the UBO bindings
// (0-4) and samplers ride bind groups. The engine reaches these only for sampler
// seeding on GLSL-shaped programs, which a WGSL pipeline never has.
i32 WebGPUDevice::getUniformLocation(ShaderHandle, const char*) { return -1; }
i32 WebGPUDevice::getAttribLocation(ShaderHandle, const char*) { return -1; }
void WebGPUDevice::setUniform1i(i32, i32) {}
void WebGPUDevice::setUniform1f(i32, f32) {}
void WebGPUDevice::setUniform2f(i32, f32, f32) {}
void WebGPUDevice::setUniform3f(i32, f32, f32, f32) {}
void WebGPUDevice::setUniform4f(i32, f32, f32, f32, f32) {}
void WebGPUDevice::setUniformMat3(i32, const f32*) {}
void WebGPUDevice::setUniformMat4(i32, const f32*) {}
std::vector<GfxUniformInfo> WebGPUDevice::getActiveUniforms(ShaderHandle) { return {}; }

u32 WebGPUDevice::getUniformBlockIndex(ShaderHandle, const char*) {
    // Blocks bind by @group/@binding in WGSL; Shader::compile skips GL-style
    // block wiring when this reports "absent".
    return GFX_INVALID_UNIFORM_BLOCK;
}
void WebGPUDevice::uniformBlockBinding(ShaderHandle, u32, u32) {}

// =============================================================================
// Pipelines (descriptors retained; WGPURenderPipeline built lazily per pass
// depth-stencil shape — WebGPU validates that coupling, GL never had it)
// =============================================================================

PipelineHandle WebGPUDevice::createPipeline(const PipelineDesc& desc) {
    // Dedup on the descriptor like GLDevice's pipeline cache.
    for (const auto& [id, rec] : pipelines_) {
        if (rec.desc == desc) return static_cast<PipelineHandle>(id);
    }
    const u32 id = next_id_++;
    pipelines_[id] = PipelineRec{desc, {}};
    return static_cast<PipelineHandle>(id);
}

WGPURenderPipeline WebGPUDevice::ensurePipeline(u32 id) {
    auto it = pipelines_.find(id);
    if (it == pipelines_.end() || !device_) return nullptr;
    const u32 variant = dsVariantOf(pass_ds_format_);
    if (it->second.variants[variant]) return it->second.variants[variant];

    const PipelineDesc& desc = it->second.desc;
    auto progIt = programs_.find(static_cast<u32>(desc.program));
    auto layoutIt = layouts_.find(static_cast<u32>(desc.vertexLayout));
    if (progIt == programs_.end() || layoutIt == layouts_.end()) {
        ES_LOG_ERROR("WebGPUDevice::ensurePipeline: missing program or layout");
        return nullptr;
    }
    const VertexLayoutDesc& vl = layoutIt->second;

    // RHI layout (attributes across up to 2 slots) -> per-slot WGPU buffer layouts.
    WGPUVertexAttribute attrs[MAX_VERTEX_ATTRIBUTES] = {};
    WGPUVertexBufferLayout slots[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 attrCursor = 0;
    u32 slotCount = 0;
    for (u32 slot = 0; slot < MAX_VERTEX_BUFFER_SLOTS; ++slot) {
        const u32 first = attrCursor;
        for (u32 i = 0; i < vl.attributeCount; ++i) {
            const auto& a = vl.attributes[i];
            if (a.bufferSlot != slot) continue;
            attrs[attrCursor].format = toWGPUVertexFormat(a.components, a.type, a.normalized);
            attrs[attrCursor].offset = a.offset;
            attrs[attrCursor].shaderLocation = a.location;
            ++attrCursor;
        }
        if (attrCursor == first) continue;
        slots[slotCount].stepMode = vl.instanceStep[slot] ? WGPUVertexStepMode_Instance
                                                          : WGPUVertexStepMode_Vertex;
        slots[slotCount].arrayStride = vl.strides[slot];
        slots[slotCount].attributeCount = attrCursor - first;
        slots[slotCount].attributes = &attrs[first];
        ++slotCount;
    }

    const BlendStateWGPU blend = toWGPUBlend(desc.blend);
    WGPUBlendState blendState{};
    blendState.color = blend.color;
    blendState.alpha = blend.alpha;

    WGPUColorTargetState target{};
    target.format = surface_format_;
    target.blend = desc.blendEnabled ? &blendState : nullptr;
    target.writeMask = (desc.stencil == GfxStencilMode::Write) ? WGPUColorWriteMask_None
                                                               : WGPUColorWriteMask_All;

    WGPUFragmentState fragment{};
    fragment.module = progIt->second.fragment;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;

    WGPURenderPipelineDescriptor pd{};
    pd.vertex.module = progIt->second.vertex;
    pd.vertex.entryPoint = sv("vs_main");
    pd.vertex.bufferCount = slotCount;
    pd.vertex.buffers = slots;
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = toWGPUCullMode(desc.cullEnabled, desc.cullFront);
    pd.multisample.count = 1;
    pd.multisample.mask = 0xFFFFFFFFu;
    pd.fragment = &fragment;
    WGPUDepthStencilState ds{};
    if (variant != kDsNone) {
        ds = toWGPUDepthStencil(desc, pass_ds_format_);
        pd.depthStencil = &ds;
    } else if (desc.depthTest || desc.stencil != GfxStencilMode::Off) {
        ES_LOG_WARN("WebGPUDevice::ensurePipeline: depth/stencil requested but the "
                    "pass target has no depth-stencil attachment");
    }

    it->second.variants[variant] = wgpuDeviceCreateRenderPipeline(device_, &pd);
    if (!it->second.variants[variant]) {
        ES_LOG_ERROR("WebGPUDevice::ensurePipeline: creation failed");
    }
    return it->second.variants[variant];
}

void WebGPUDevice::setPipeline(PipelineHandle pipeline) {
    const u32 id = static_cast<u32>(pipeline);
    current_pipeline_ = id;
    if (!pass_) return;
    if (WGPURenderPipeline p = ensurePipeline(id)) {
        wgpuRenderPassEncoderSetPipeline(pass_, p);
        bind_group_dirty_ = true;  // group layout may differ across pipelines
    }
}

void WebGPUDevice::setStencilReference(i32 reference) {
    stencil_ref_ = reference;
    if (pass_) wgpuRenderPassEncoderSetStencilReference(pass_, static_cast<u32>(reference));
}

void WebGPUDevice::invalidatePipelineCache() {}

WGPUSampler WebGPUDevice::samplerFor(u8 key) {
    auto it = samplers_.find(key);
    if (it != samplers_.end()) return it->second;
    if (!device_) return nullptr;

    WGPUSamplerDescriptor sd{};
    sd.minFilter = (key & 1u) ? WGPUFilterMode_Nearest : WGPUFilterMode_Linear;
    sd.magFilter = (key & 2u) ? WGPUFilterMode_Nearest : WGPUFilterMode_Linear;
    sd.addressModeU = toWGPUAddressMode(static_cast<TextureWrap>((key >> 2) & 3u));
    sd.addressModeV = toWGPUAddressMode(static_cast<TextureWrap>((key >> 4) & 3u));
    sd.addressModeW = WGPUAddressMode_ClampToEdge;
    // Every texture is single-mip today (generateMipmaps pending), so the mip
    // filter never engages; Nearest mirrors GL's non-mipmapped min filters.
    sd.mipmapFilter = WGPUMipmapFilterMode_Nearest;
    sd.lodMinClamp = 0.0f;
    sd.lodMaxClamp = 32.0f;
    sd.maxAnisotropy = 1;
    WGPUSampler sampler = wgpuDeviceCreateSampler(device_, &sd);
    samplers_[key] = sampler;
    return sampler;
}

// =============================================================================
// Internal clear family — the two clears WebGPU load-ops cannot spell: a
// region-scoped pass clear and a mid-pass stencil reset. A fullscreen triangle
// at z=1 (GL's clear depth) writes exactly the attachments requested: color via
// the write mask, depth via depthWriteEnabled + Always, stencil via
// Replace + the encoder's stencil reference.
// =============================================================================

WGPURenderPipeline WebGPUDevice::ensureClearPipeline(bool color, bool depth, bool stencil) {
    const u32 key = dsVariantOf(pass_ds_format_) << 3 |
                    (color ? 1u : 0u) | (depth ? 2u : 0u) | (stencil ? 4u : 0u);
    auto it = clear_pipelines_.find(key);
    if (it != clear_pipelines_.end()) return it->second;

    static const char* kClearVS = R"(
@vertex fn vs_main(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
    return vec4f(p[i], 1.0, 1.0);
}
)";
    static const char* kClearFS = R"(
struct ClearColor { value : vec4f };
@group(0) @binding(0) var<uniform> clearColor : ClearColor;
@fragment fn fs_main() -> @location(0) vec4f { return clearColor.value; }
)";
    auto makeModule = [&](const char* code) {
        WGPUShaderSourceWGSL wgsl{};
        wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
        wgsl.code = sv(code);
        WGPUShaderModuleDescriptor md{};
        md.nextInChain = &wgsl.chain;
        return wgpuDeviceCreateShaderModule(device_, &md);
    };

    // One explicit layout for the whole family, so the single bind group is
    // valid with every write-mask variant (auto layouts are per-pipeline).
    if (!clear_bgl_) {
        WGPUBindGroupLayoutEntry ble{};
        ble.binding = 0;
        ble.visibility = WGPUShaderStage_Fragment;
        ble.buffer.type = WGPUBufferBindingType_Uniform;
        ble.buffer.minBindingSize = 16;
        WGPUBindGroupLayoutDescriptor bld{};
        bld.entryCount = 1;
        bld.entries = &ble;
        clear_bgl_ = wgpuDeviceCreateBindGroupLayout(device_, &bld);

        WGPUPipelineLayoutDescriptor pld{};
        pld.bindGroupLayoutCount = 1;
        pld.bindGroupLayouts = &clear_bgl_;
        clear_layout_ = wgpuDeviceCreatePipelineLayout(device_, &pld);

        clear_color_ubo_ = createBuffer({GfxBufferUsage::Uniform, 16, true}, nullptr);
        auto uboIt = buffers_.find(static_cast<u32>(clear_color_ubo_));
        WGPUBindGroupEntry entry{};
        entry.binding = 0;
        entry.buffer = uboIt->second.buffer;
        entry.offset = 0;
        entry.size = 16;
        WGPUBindGroupDescriptor bgd{};
        bgd.layout = clear_bgl_;
        bgd.entryCount = 1;
        bgd.entries = &entry;
        clear_bind_group_ = wgpuDeviceCreateBindGroup(device_, &bgd);
    }

    WGPUShaderModule vs = makeModule(kClearVS);
    WGPUShaderModule fs = makeModule(kClearFS);

    WGPUColorTargetState target{};
    target.format = surface_format_;
    target.writeMask = color ? WGPUColorWriteMask_All : WGPUColorWriteMask_None;

    WGPUFragmentState fragment{};
    fragment.module = fs;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;

    WGPURenderPipelineDescriptor pd{};
    pd.layout = clear_layout_;
    pd.vertex.module = vs;
    pd.vertex.entryPoint = sv("vs_main");
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = WGPUCullMode_None;
    pd.multisample.count = 1;
    pd.multisample.mask = 0xFFFFFFFFu;
    pd.fragment = &fragment;

    WGPUDepthStencilState ds{};
    if (pass_ds_format_ != WGPUTextureFormat_Undefined) {
        ds.format = pass_ds_format_;
        ds.depthCompare = WGPUCompareFunction_Always;
        ds.depthWriteEnabled = depth ? WGPUOptionalBool_True : WGPUOptionalBool_False;
        WGPUStencilFaceState face{};
        face.compare = WGPUCompareFunction_Always;
        face.failOp = stencil ? WGPUStencilOperation_Replace : WGPUStencilOperation_Keep;
        face.depthFailOp = face.failOp;
        face.passOp = face.failOp;
        ds.stencilFront = face;
        ds.stencilBack = face;
        ds.stencilReadMask = 0xFFu;
        ds.stencilWriteMask = stencil ? 0xFFu : 0x00u;
        pd.depthStencil = &ds;
    }

    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device_, &pd);
    wgpuShaderModuleRelease(vs);
    wgpuShaderModuleRelease(fs);
    clear_pipelines_[key] = pipeline;
    return pipeline;
}

void WebGPUDevice::drawInternalClear(bool color, bool depth, bool stencil,
                                     const f32 rgba[4], i32 stencilValue,
                                     const RenderPassDesc* region) {
    if (!pass_ || !device_) return;
    WGPURenderPipeline pipeline = ensureClearPipeline(color, depth, stencil);
    if (!pipeline || !clear_bind_group_) return;

    const f32 black[4] = {0.0f, 0.0f, 0.0f, 0.0f};
    updateBuffer(clear_color_ubo_, 0, rgba ? rgba : black, 16);

    // A region rides its own scissor and restores the full target; without one
    // (mid-pass stencil reset) the currently active scissor applies — the same
    // rectangle glClear would have honored.
    if (region) {
        wgpuRenderPassEncoderSetScissorRect(pass_, static_cast<u32>(region->clearX),
                                            static_cast<u32>(region->clearY),
                                            region->clearW, region->clearH);
    }
    wgpuRenderPassEncoderSetPipeline(pass_, pipeline);
    wgpuRenderPassEncoderSetBindGroup(pass_, 0, clear_bind_group_, 0, nullptr);
    if (stencil) {
        wgpuRenderPassEncoderSetStencilReference(pass_, static_cast<u32>(stencilValue));
    }
    wgpuRenderPassEncoderDraw(pass_, 3, 1, 0, 0);
    if (region) {
        wgpuRenderPassEncoderSetScissorRect(pass_, 0, 0, pass_width_, pass_height_);
    }
    if (stencil) {
        wgpuRenderPassEncoderSetStencilReference(pass_, static_cast<u32>(stencil_ref_));
    }

    // The triangle clobbered pipeline/bind-group pass state; force the next
    // user draw to re-establish everything.
    current_pipeline_ = 0;
    bind_group_dirty_ = true;
}

void WebGPUDevice::flushBindGroup() {
    if (!bind_group_dirty_ || !pass_ || !device_) return;

    WGPURenderPipeline p = ensurePipeline(current_pipeline_);
    if (!p) return;

    // Group 0 = the engine's UBO bindings (0..4). Entries must match the
    // pipeline's layout exactly, so only slots the shader declares may appear;
    // bring-up shaders declare exactly the slots the scene sets. Full slot-mask
    // reflection ships with the WGSL emitter metadata (Phase 3).
    WGPUBindGroupEntry entries[kUniformSlots];
    u32 count = 0;
    for (u32 slot = 0; slot < kUniformSlots; ++slot) {
        if (uniform_slots_[slot] == 0) continue;
        auto it = buffers_.find(uniform_slots_[slot]);
        if (it == buffers_.end()) continue;
        WGPUBindGroupEntry e{};
        e.binding = slot;
        e.buffer = it->second.buffer;
        e.offset = 0;
        e.size = it->second.size;
        entries[count++] = e;
    }

    if (bind_group_) { wgpuBindGroupRelease(bind_group_); bind_group_ = nullptr; }
    if (count == 0) { bind_group_dirty_ = false; return; }

    WGPUBindGroupDescriptor bgd{};
    bgd.layout = wgpuRenderPipelineGetBindGroupLayout(p, 0);
    bgd.entryCount = count;
    bgd.entries = entries;
    bind_group_ = wgpuDeviceCreateBindGroup(device_, &bgd);
    if (bgd.layout) wgpuBindGroupLayoutRelease(bgd.layout);
    if (bind_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 0, bind_group_, 0, nullptr);

    // Group 1: the texture units. The WGSL twin convention is 8 texture_2d at
    // bindings 0..7 paired with 8 samplers at bindings 8..15 (the batch shader's
    // u_textures[8], de-combined: sampler i carries texture i's filter/wrap
    // params via the sampler cache). Unused slots repeat slot 0's view/sampler —
    // the same trick DrawList::execute uses for WebGL2's complete-texture rule.
    // Only set when the pass bound textures AND the current program declares the
    // group — a sampler-less shader (shape) drawn after textured ones must keep
    // its group-0-only layout.
    bool wantsTextures = false;
    if (auto pipeIt = pipelines_.find(current_pipeline_); pipeIt != pipelines_.end()) {
        auto progIt = programs_.find(static_cast<u32>(pipeIt->second.desc.program));
        wantsTextures = progIt != programs_.end() && progIt->second.usesTextureGroup;
    }
    if (any_texture_bound_ && wantsTextures) {
        const TextureRec* slot0 = nullptr;
        for (u32 slot = 0; slot < kTextureSlots && !slot0; ++slot) {
            auto it = textures_.find(texture_slots_[slot]);
            if (it != textures_.end()) slot0 = &it->second;
        }
        if (slot0) {
            WGPUBindGroupEntry texEntries[kTextureSlots * 2] = {};
            for (u32 slot = 0; slot < kTextureSlots; ++slot) {
                auto it = textures_.find(texture_slots_[slot]);
                const TextureRec& rec = (it != textures_.end()) ? it->second : *slot0;
                texEntries[slot].binding = slot;
                texEntries[slot].textureView = rec.view;
                texEntries[kTextureSlots + slot].binding = kTextureSlots + slot;
                texEntries[kTextureSlots + slot].sampler = samplerFor(rec.samplerKey);
            }

            if (texture_group_) { wgpuBindGroupRelease(texture_group_); texture_group_ = nullptr; }
            WGPUBindGroupDescriptor tgd{};
            tgd.layout = wgpuRenderPipelineGetBindGroupLayout(p, 1);
            tgd.entryCount = kTextureSlots * 2;
            tgd.entries = texEntries;
            texture_group_ = wgpuDeviceCreateBindGroup(device_, &tgd);
            if (tgd.layout) wgpuBindGroupLayoutRelease(tgd.layout);
            if (texture_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 1, texture_group_, 0, nullptr);
        }
    }
    bind_group_dirty_ = false;
}

// =============================================================================
// Draws / passes — slice 2 (per-frame command encoder + surface plumbing)
// =============================================================================

void WebGPUDevice::drawElements(u32 indexCount, GfxDataType indexType, u32 indexByteOffset) {
    if (!pass_) return;
    auto it = buffers_.find(bound_index_buffer_);
    if (it == buffers_.end()) return;
    flushBindGroup();
    wgpuRenderPassEncoderSetIndexBuffer(pass_, it->second.buffer, toWGPUIndexFormat(indexType),
                                        0, it->second.size);
    const u32 indexSize = (indexType == GfxDataType::UnsignedShort) ? 2 : 4;
    wgpuRenderPassEncoderDrawIndexed(pass_, indexCount, 1, indexByteOffset / indexSize, 0, 0);
}

void WebGPUDevice::drawArrays(u32 firstVertex, u32 vertexCount) {
    if (!pass_) return;
    flushBindGroup();
    wgpuRenderPassEncoderDraw(pass_, vertexCount, 1, firstVertex, 0);
}

void WebGPUDevice::drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 indexByteOffset,
                                         u32 instanceCount) {
    if (!pass_) return;
    auto it = buffers_.find(bound_index_buffer_);
    if (it == buffers_.end()) return;
    flushBindGroup();
    wgpuRenderPassEncoderSetIndexBuffer(pass_, it->second.buffer, toWGPUIndexFormat(indexType),
                                        0, it->second.size);
    const u32 indexSize = (indexType == GfxDataType::UnsignedShort) ? 2 : 4;
    wgpuRenderPassEncoderDrawIndexed(pass_, indexCount, instanceCount,
                                     indexByteOffset / indexSize, 0, 0);
}

FramebufferHandle WebGPUDevice::createFramebuffer(const FramebufferDesc& desc) {
    FramebufferRec rec{};
    rec.color0 = static_cast<u32>(desc.color0);
    rec.depthStencil = static_cast<u32>(desc.depthStencil);
    if (rec.depthStencil != 0 && !textures_.count(rec.depthStencil)) {
        ES_LOG_ERROR("WebGPUDevice::createFramebuffer: unknown depth-stencil texture");
        return FramebufferHandle::Default;
    }
    // Framebuffer ids share the Default==0 namespace with the surface, so they
    // come from their own counter offset well clear of it.
    const u32 id = 0x40000000u + next_framebuffer_id_++;
    framebuffers_[id] = rec;
    return static_cast<FramebufferHandle>(id);
}

void WebGPUDevice::deleteFramebuffer(FramebufferHandle framebuffer) {
    framebuffers_.erase(static_cast<u32>(framebuffer));
}

void WebGPUDevice::beginRenderPass(const RenderPassDesc& desc) {
    if (!device_) return;
    if (pass_) endRenderPass();  // defensive: a dangling pass would deadlock the queue

    WGPUTextureView targetView = nullptr;
    WGPUTextureView dsView = nullptr;
    pass_ds_format_ = WGPUTextureFormat_Undefined;
    if (desc.target != FramebufferHandle::Default) {
        auto fbIt = framebuffers_.find(static_cast<u32>(desc.target));
        if (fbIt == framebuffers_.end()) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: unknown framebuffer");
            return;
        }
        auto texIt = textures_.find(fbIt->second.color0);
        if (texIt == textures_.end()) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: framebuffer color texture missing");
            return;
        }
        targetView = texIt->second.view;
        pass_width_ = texIt->second.width;
        pass_height_ = texIt->second.height;
        if (fbIt->second.depthStencil != 0) {
            auto dsIt = textures_.find(fbIt->second.depthStencil);
            if (dsIt != textures_.end()) {
                dsView = dsIt->second.view;
                pass_ds_format_ = dsIt->second.format;
            }
        }
    } else {
        if (!surface_) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: no surface configured");
            return;
        }
        WGPUSurfaceTexture st{};
        wgpuSurfaceGetCurrentTexture(surface_, &st);
        if (st.status != WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal &&
            st.status != WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: surface texture unavailable ({})",
                         static_cast<u32>(st.status));
            return;
        }
        frame_texture_ = st.texture;
        frame_view_ = wgpuTextureCreateView(frame_texture_, nullptr);
        targetView = frame_view_;
        pass_width_ = surface_width_;
        pass_height_ = surface_height_;
        dsView = surface_depth_view_;
        pass_ds_format_ = WGPUTextureFormat_Depth24PlusStencil8;
    }

    encoder_ = wgpuDeviceCreateCommandEncoder(device_, nullptr);

    const bool scoped = desc.clearW != 0;
    WGPURenderPassColorAttachment color{};
    color.view = targetView;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = toWGPULoadOp(desc.clearColor, scoped);
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = toWGPUClearColor(desc);

    WGPURenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &color;

    WGPURenderPassDepthStencilAttachment ds{};
    if (dsView) {
        ds.view = dsView;
        ds.depthLoadOp = toWGPULoadOp(desc.clearDepth, scoped);
        ds.depthStoreOp = WGPUStoreOp_Store;
        ds.depthClearValue = 1.0f;  // GL's default clear depth; no RHI override exists
        if (hasStencilPlanes(pass_ds_format_)) {
            ds.stencilLoadOp = toWGPULoadOp(desc.clearStencil, scoped);
            ds.stencilStoreOp = WGPUStoreOp_Store;
            ds.stencilClearValue = static_cast<u32>(desc.clearStencilValue);
        }
        rp.depthStencilAttachment = &ds;
    }
    pass_ = wgpuCommandEncoderBeginRenderPass(encoder_, &rp);
    bind_group_dirty_ = true;
    stencil_ref_ = 0;  // a fresh pass encoder resets its stencil reference

    // Region-scoped clear = load + scissored clear-triangle, per the RHI
    // contract — for every attachment the desc asks to clear.
    if (scoped && (desc.clearColor || desc.clearDepth || desc.clearStencil)) {
        drawInternalClear(desc.clearColor, desc.clearDepth && dsView,
                          desc.clearStencil && hasStencilPlanes(pass_ds_format_),
                          desc.clearColorValue, desc.clearStencilValue, &desc);
    }
    // Each pass starts textureless: group 1 only attaches to pipelines whose
    // draws bind textures (the engine rebinds per draw), never to sampler-less
    // pipelines from a previous pass's leftovers.
    any_texture_bound_ = false;
}

void WebGPUDevice::endRenderPass() {
    if (!pass_) return;
    wgpuRenderPassEncoderEnd(pass_);
    wgpuRenderPassEncoderRelease(pass_);
    pass_ = nullptr;

    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder_, nullptr);
    wgpuCommandEncoderRelease(encoder_);
    encoder_ = nullptr;
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);

    if (frame_view_) { wgpuTextureViewRelease(frame_view_); frame_view_ = nullptr; }
    if (frame_texture_) { wgpuTextureRelease(frame_texture_); frame_texture_ = nullptr; }
}

void WebGPUDevice::readPixels(i32, i32, u32, u32, GfxPixelFormat, void*) { stubOnce("readPixels"); }

// =============================================================================
// Timing / queries / debug
// =============================================================================

u32 WebGPUDevice::createTimerQuery() { return 0; }  // "no GPU timing" — same contract as a bare GL backend
void WebGPUDevice::beginTimerQuery(u32) {}
void WebGPUDevice::endTimerQuery() {}
bool WebGPUDevice::timerDisjoint() { return false; }
bool WebGPUDevice::getTimerQueryNs(u32, u64*) { return false; }

void WebGPUDevice::setWireframe(bool) {}
u32 WebGPUDevice::getError() { return 0; }

std::string WebGPUDevice::getString(GfxStringName name) {
    switch (name) {
    case GfxStringName::Renderer: return "WebGPU (Dawn/emdawnwebgpu)";
    case GfxStringName::Vendor:   return "WebGPU";
    case GfxStringName::Version:  return "WebGPU 1.0";
    case GfxStringName::ShadingLanguageVersion: return "WGSL";
    default: return {};
    }
}

i32 WebGPUDevice::getInt(GfxIntParam param) {
    switch (param) {
    case GfxIntParam::MaxTextureSize:       return 8192;
    case GfxIntParam::MaxTextureImageUnits: return 16;
    case GfxIntParam::MaxVertexAttribs:     return 16;
    default: return 0;
    }
}

}  // namespace esengine
