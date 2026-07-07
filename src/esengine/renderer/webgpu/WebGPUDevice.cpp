// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUDevice.cpp
 * @brief   WebGPU backend skeleton (REARCH_WGSL Phase 2, slice 1).
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
    if (device_) queue_ = wgpuDeviceGetQueue(device_);
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
        if (rec.texture) wgpuTextureRelease(rec.texture);
    }
    textures_.clear();
    for (auto& [id, rec] : programs_) {
        if (rec.vertex) wgpuShaderModuleRelease(rec.vertex);
        if (rec.fragment) wgpuShaderModuleRelease(rec.fragment);
    }
    programs_.clear();
    layouts_.clear();
    pipelines_.clear();
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

void WebGPUDevice::setViewport(i32, i32, u32, u32) { stubOnce("setViewport"); }
void WebGPUDevice::clearStencil(i32) { stubOnce("clearStencil"); }
void WebGPUDevice::setScissorTest(bool) { stubOnce("setScissorTest"); }
void WebGPUDevice::setScissor(i32, i32, i32, i32) { stubOnce("setScissor"); }

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

void WebGPUDevice::setUniformBuffer(u32, BufferHandle) { stubOnce("setUniformBuffer (bind groups)"); }

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

void WebGPUDevice::setVertexBuffer(u32, BufferHandle, u32) { stubOnce("setVertexBuffer"); }
void WebGPUDevice::setIndexBuffer(BufferHandle) { stubOnce("setIndexBuffer"); }

const VertexLayoutDesc* WebGPUDevice::layoutDesc(VertexLayoutHandle handle) const {
    auto it = layouts_.find(static_cast<u32>(handle));
    return it != layouts_.end() ? &it->second : nullptr;
}

const PipelineDesc* WebGPUDevice::pipelineDesc(PipelineHandle handle) const {
    auto it = pipelines_.find(static_cast<u32>(handle));
    return it != pipelines_.end() ? &it->second : nullptr;
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
    textures_[id] = TextureRec{texture, desc.width, desc.height};

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
void WebGPUDevice::bindTexture(u32, TextureHandle) { stubOnce("bindTexture (bind groups)"); }

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
    const u32 id = next_id_++;
    pipelines_[id] = desc;
    return static_cast<PipelineHandle>(id);
}

void WebGPUDevice::setPipeline(PipelineHandle) { stubOnce("setPipeline"); }
void WebGPUDevice::setStencilReference(i32) { stubOnce("setStencilReference"); }
void WebGPUDevice::invalidatePipelineCache() {}

// =============================================================================
// Draws / passes — slice 2 (per-frame command encoder + surface plumbing)
// =============================================================================

void WebGPUDevice::drawElements(u32, GfxDataType, u32) { stubOnce("drawElements"); }
void WebGPUDevice::drawArrays(u32, u32) { stubOnce("drawArrays"); }
void WebGPUDevice::drawElementsInstanced(u32, GfxDataType, u32, u32) { stubOnce("drawElementsInstanced"); }

FramebufferHandle WebGPUDevice::createFramebuffer(const FramebufferDesc&) {
    stubOnce("createFramebuffer");
    return FramebufferHandle::Default;
}
void WebGPUDevice::deleteFramebuffer(FramebufferHandle) {}
void WebGPUDevice::beginRenderPass(const RenderPassDesc&) { stubOnce("beginRenderPass"); }
void WebGPUDevice::endRenderPass() { stubOnce("endRenderPass"); }

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
