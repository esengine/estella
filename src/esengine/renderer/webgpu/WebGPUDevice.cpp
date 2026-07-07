// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUDevice.cpp
 * @brief   WebGPU backend (REARCH_WGSL Phase 2): resources (slice 1) + live
 *          render path — surface, pass encoding, lazy pipelines, bind groups,
 *          draws (slice 2).
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
        if (rec.pipeline) wgpuRenderPipelineRelease(rec.pipeline);
    }
    pipelines_.clear();
    if (bind_group_) { wgpuBindGroupRelease(bind_group_); bind_group_ = nullptr; }
    if (texture_group_) { wgpuBindGroupRelease(texture_group_); texture_group_ = nullptr; }
    if (sampler_) { wgpuSamplerRelease(sampler_); sampler_ = nullptr; }
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
    return true;
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

void WebGPUDevice::clearStencil(i32) { stubOnce("clearStencil (stencil-write quad)"); }

void WebGPUDevice::setScissorTest(bool enabled) {
    // WebGPU's scissor is always on; "disabled" = the full target rectangle.
    if (pass_ && !enabled) {
        wgpuRenderPassEncoderSetScissorRect(pass_, 0, 0, surface_width_, surface_height_);
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
    td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst |
               WGPUTextureUsage_RenderAttachment;

    WGPUTexture texture = wgpuDeviceCreateTexture(device_, &td);
    if (!texture) {
        ES_LOG_ERROR("WebGPUDevice::createTexture: creation failed ({}x{})", desc.width, desc.height);
        return TextureHandle::Invalid;
    }

    const u32 id = next_id_++;
    textures_[id] = TextureRec{texture, wgpuTextureCreateView(texture, nullptr),
                               desc.width, desc.height};

    if (pixels) {
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

void WebGPUDevice::setTextureParams(TextureHandle, TextureFilter, TextureFilter,
                                    TextureWrap, TextureWrap) {
    // Sampler state is a bind-group object on WebGPU, not texture state; the
    // sampler cache keyed by (filter, wrap) lands with bind groups in slice 2.
    stubOnce("setTextureParams (sampler objects)");
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
// Pipelines (descriptors retained; WGPURenderPipeline builds in slice 2 where
// bind-group layouts exist)
// =============================================================================

PipelineHandle WebGPUDevice::createPipeline(const PipelineDesc& desc) {
    // Dedup on the descriptor like GLDevice's pipeline cache.
    for (const auto& [id, rec] : pipelines_) {
        if (rec.desc == desc) return static_cast<PipelineHandle>(id);
    }
    const u32 id = next_id_++;
    pipelines_[id] = PipelineRec{desc, nullptr};
    return static_cast<PipelineHandle>(id);
}

WGPURenderPipeline WebGPUDevice::ensurePipeline(u32 id) {
    auto it = pipelines_.find(id);
    if (it == pipelines_.end() || !device_) return nullptr;
    if (it->second.pipeline) return it->second.pipeline;

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
    // Bring-up passes carry no depth/stencil attachment; the depth/stencil
    // pipeline states join when the surface gains a depth buffer (slice 3).
    if (desc.depthTest || desc.stencil != GfxStencilMode::Off) {
        stubOnce("depth/stencil pipeline state");
    }

    it->second.pipeline = wgpuDeviceCreateRenderPipeline(device_, &pd);
    if (!it->second.pipeline) {
        ES_LOG_ERROR("WebGPUDevice::ensurePipeline: creation failed");
    }
    return it->second.pipeline;
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
    if (pass_) wgpuRenderPassEncoderSetStencilReference(pass_, static_cast<u32>(reference));
}

void WebGPUDevice::invalidatePipelineCache() {}

WGPUSampler WebGPUDevice::defaultSampler() {
    if (!sampler_ && device_) {
        // Bring-up default: linear filtering, clamped — per-texture sampler state
        // (setTextureParams) becomes a keyed sampler cache in a later slice.
        WGPUSamplerDescriptor sd{};
        sd.addressModeU = WGPUAddressMode_ClampToEdge;
        sd.addressModeV = WGPUAddressMode_ClampToEdge;
        sd.addressModeW = WGPUAddressMode_ClampToEdge;
        sd.magFilter = WGPUFilterMode_Linear;
        sd.minFilter = WGPUFilterMode_Linear;
        sd.mipmapFilter = WGPUMipmapFilterMode_Nearest;
        sd.lodMinClamp = 0.0f;
        sd.lodMaxClamp = 32.0f;
        sd.maxAnisotropy = 1;
        sampler_ = wgpuDeviceCreateSampler(device_, &sd);
    }
    return sampler_;
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
    // bindings 0..7 + one shared sampler at binding 8 (the batch shader's
    // u_textures[8]). Unused slots repeat slot 0's view — the same trick
    // DrawList::execute uses for WebGL2's complete-texture rule. Only set when
    // the pass bound textures, so sampler-less shaders keep a group-0-only layout.
    if (any_texture_bound_) {
        WGPUTextureView slot0 = nullptr;
        for (u32 slot = 0; slot < kTextureSlots && !slot0; ++slot) {
            auto it = textures_.find(texture_slots_[slot]);
            if (it != textures_.end()) slot0 = it->second.view;
        }
        if (slot0) {
            WGPUBindGroupEntry texEntries[kTextureSlots + 1] = {};
            for (u32 slot = 0; slot < kTextureSlots; ++slot) {
                auto it = textures_.find(texture_slots_[slot]);
                texEntries[slot].binding = slot;
                texEntries[slot].textureView = (it != textures_.end()) ? it->second.view : slot0;
            }
            texEntries[kTextureSlots].binding = kTextureSlots;
            texEntries[kTextureSlots].sampler = defaultSampler();

            if (texture_group_) { wgpuBindGroupRelease(texture_group_); texture_group_ = nullptr; }
            WGPUBindGroupDescriptor tgd{};
            tgd.layout = wgpuRenderPipelineGetBindGroupLayout(p, 1);
            tgd.entryCount = kTextureSlots + 1;
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

FramebufferHandle WebGPUDevice::createFramebuffer(const FramebufferDesc&) {
    stubOnce("createFramebuffer (offscreen targets)");
    return FramebufferHandle::Default;
}
void WebGPUDevice::deleteFramebuffer(FramebufferHandle) {}

void WebGPUDevice::beginRenderPass(const RenderPassDesc& desc) {
    if (!device_) return;
    if (pass_) endRenderPass();  // defensive: a dangling pass would deadlock the queue

    if (desc.target != FramebufferHandle::Default) {
        stubOnce("beginRenderPass(offscreen target)");
        return;
    }
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

    encoder_ = wgpuDeviceCreateCommandEncoder(device_, nullptr);

    const bool scoped = desc.clearW != 0;
    WGPURenderPassColorAttachment color{};
    color.view = frame_view_;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = toWGPULoadOp(desc.clearColor, scoped);
    color.storeOp = WGPUStoreOp_Store;
    color.clearValue = toWGPUClearColor(desc);
    if (desc.clearColor && scoped) {
        // Region-scoped clear = load + scissored clear-quad, per the RHI contract.
        stubOnce("region-scoped clear emulation");
    }

    WGPURenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &color;
    pass_ = wgpuCommandEncoderBeginRenderPass(encoder_, &rp);
    bind_group_dirty_ = true;
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
