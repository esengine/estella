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

u32 colorVariantOf(WGPUTextureFormat format) {
    switch (format) {
    case WGPUTextureFormat_RGBA8UnormSrgb: return WebGPUDevice::kColorSrgb8;
    case WGPUTextureFormat_RGBA16Float:    return WebGPUDevice::kColorRgba16f;
    default:                               return WebGPUDevice::kColorRgba8;
    }
}

u8 packSamplerKey(TextureFilter minFilter, TextureFilter magFilter,
                  TextureWrap wrapS, TextureWrap wrapT) {
    return static_cast<u8>((minFilter == TextureFilter::Nearest ? 1u : 0u) |
                           (magFilter == TextureFilter::Nearest ? 2u : 0u) |
                           (static_cast<u32>(wrapS) << 2) |
                           (static_cast<u32>(wrapT) << 4));
}
}  // namespace

WebGPUDevice::WebGPUDevice(WGPUDevice device, WGPUInstance instance, WGPUAdapter adapter)
    : device_(device), adapter_(adapter) {
    if (device_) {
        queue_ = wgpuDeviceGetQueue(device_);
        if (instance) {
            instance_ = instance;      // native shell shares its instance (surface must match it)
            owns_instance_ = false;
        } else {
            instance_ = wgpuCreateInstance(nullptr);  // web/standalone: own one (emscripten singleton)
            owns_instance_ = true;
        }
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
    // bind_group_/texture_group_ point INTO the cache — release the cache, not them.
    for (auto& e : bind_group_cache_) if (e.bg) wgpuBindGroupRelease(e.bg);
    bind_group_cache_.clear();
    bind_group_ = nullptr;
    texture_group_ = nullptr;

    // GPU timing resources.
    if (timestamp_qset_) { wgpuQuerySetRelease(timestamp_qset_); timestamp_qset_ = nullptr; }
    if (timestamp_resolve_) { wgpuBufferRelease(timestamp_resolve_); timestamp_resolve_ = nullptr; }
    for (auto& s : gpu_time_ring_) { if (s.buf) wgpuBufferRelease(s.buf); s.buf = nullptr; s.pending = false; }
    gpu_time_results_.clear();
    timestamp_supported_ = false;
    timestamp_init_done_ = false;
    if (clear_bind_group_) { wgpuBindGroupRelease(clear_bind_group_); clear_bind_group_ = nullptr; }
    for (auto& [key, pipeline] : clear_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    clear_pipelines_.clear();
    if (clear_layout_) { wgpuPipelineLayoutRelease(clear_layout_); clear_layout_ = nullptr; }
    if (clear_bgl_) { wgpuBindGroupLayoutRelease(clear_bgl_); clear_bgl_ = nullptr; }
    for (auto& [key, layout] : pipeline_layouts_) {
        if (layout) wgpuPipelineLayoutRelease(layout);
    }
    pipeline_layouts_.clear();
    for (auto& [key, layout] : group_layouts_) {
        if (layout) wgpuBindGroupLayoutRelease(layout);
    }
    group_layouts_.clear();
    dummy_ubo_ = BufferHandle{};  // the WGPUBuffer/WGPUTexture went with the maps above
    dummy_texture_ = 0;
    framebuffers_.clear();
    // Erase before release: aborting a pending map fires the callback, which must
    // miss the lookup rather than see a half-dead record.
    while (!readbacks_.empty()) releaseReadback(readbacks_.begin()->first);
    for (auto& [key, sampler] : samplers_) {
        if (sampler) wgpuSamplerRelease(sampler);
    }
    samplers_.clear();
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    if (surface_) { wgpuSurfaceRelease(surface_); surface_ = nullptr; }
    if (instance_ && owns_instance_) { wgpuInstanceRelease(instance_); }
    instance_ = nullptr;
}

// =============================================================================
// Surface (bring-up: a canvas is the Default framebuffer)
// =============================================================================

#if defined(__EMSCRIPTEN__)
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

    return configureSwapchain(width, height);
}
#endif  // __EMSCRIPTEN__

#if !defined(__EMSCRIPTEN__)
// The native (iOS/Android) surface source: the same instance + swapchain as the web
// path, but the surface is created from a native window handle instead of a canvas
// selector. Dawn's Metal/Android surface descriptors replace the emscripten one; the
// host owns the CAMetalLayer / ANativeWindow lifetime. Compiled only in a native Dawn
// build (emscripten's emdawnwebgpu has no native window source).
bool WebGPUDevice::configureSurface(const NativeSurface& window, u32 width, u32 height) {
    if (!device_ || !instance_) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface(native): no device/instance");
        return false;
    }
    if (!window.handle) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface(native): null window handle");
        return false;
    }

    // Re-entrant: an Android screen-off/on (or a rotation) destroys the window and
    // hands back a new one, so drop the previous surface + depth before rebinding.
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    if (surface_) { wgpuSurfaceRelease(surface_); surface_ = nullptr; }

    WGPUSurfaceDescriptor sd{};
    switch (window.kind) {
        case NativeWindowKind::MetalLayer: {
            WGPUSurfaceSourceMetalLayer metal{};
            metal.chain.sType = WGPUSType_SurfaceSourceMetalLayer;
            metal.layer = window.handle;  // CAMetalLayer*
            sd.nextInChain = &metal.chain;
            surface_ = wgpuInstanceCreateSurface(instance_, &sd);
            break;
        }
        case NativeWindowKind::AndroidWindow: {
            WGPUSurfaceSourceAndroidNativeWindow android{};
            android.chain.sType = WGPUSType_SurfaceSourceAndroidNativeWindow;
            android.window = window.handle;  // ANativeWindow*
            sd.nextInChain = &android.chain;
            surface_ = wgpuInstanceCreateSurface(instance_, &sd);
            break;
        }
    }
    if (!surface_) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface(native): surface creation failed");
        return false;
    }

    return configureSwapchain(width, height);
}

void WebGPUDevice::present() {
    if (surface_) wgpuSurfacePresent(surface_);
}
#endif  // !__EMSCRIPTEN__

bool WebGPUDevice::configureSwapchain(u32 width, u32 height) {
    // RGBA8 is universally valid for emscripten surfaces and keeps readback simple.
    surface_format_ = WGPUTextureFormat_RGBA8Unorm;
#if !defined(__EMSCRIPTEN__)
    // A native surface may accept nothing of the sort — a CAMetalLayer offers only
    // BGRA8Unorm, while Vulkan happens to take RGBA8 — and configuring a format the
    // surface does not advertise leaves every getCurrentTexture in error rather
    // than failing here. So ask, and take the surface's preferred (first) format.
    if (adapter_) {
        WGPUSurfaceCapabilities caps{};
        if (wgpuSurfaceGetCapabilities(surface_, adapter_, &caps) == WGPUStatus_Success
            && caps.formatCount > 0) {
            surface_format_ = caps.formats[0];
            wgpuSurfaceCapabilitiesFreeMembers(caps);
        }
    }
#endif
    WGPUSurfaceConfiguration cfg{};
    cfg.device = device_;
    cfg.format = surface_format_;
    cfg.usage = WGPUTextureUsage_RenderAttachment;
    cfg.width = width;
    cfg.height = height;
    // Auto, not Opaque: let the backend pick a mode the surface advertises. A
    // browser canvas supports Opaque, but a native Vulkan surface may not (e.g.
    // Adreno on Android only offers Inherit/PreMultiplied) — Configure() rejects
    // an unsupported mode outright.
    cfg.alphaMode = WGPUCompositeAlphaMode_Auto;
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

void WebGPUDevice::resizeBackbuffer(u32 width, u32 height) {
    if (!surface_ || !device_ || width == 0 || height == 0) return;
    if (width == surface_width_ && height == surface_height_) return;
    if (pass_) {
        ES_LOG_WARN("WebGPUDevice::resizeBackbuffer: ignored inside a render pass");
        return;
    }
    configureSwapchain(width, height);
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
    if (it->second.buffer) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(it->second.buffer)));
        wgpuBufferRelease(it->second.buffer);
    }
    buffers_.erase(it);
}

void WebGPUDevice::evictBindGroups(u64 id) {
    for (usize i = bind_group_cache_.size(); i-- > 0;) {
        auto& e = bind_group_cache_[i];
        bool hit = false;
        for (u64 v : e.ids) {
            if (v == id) { hit = true; break; }
        }
        if (!hit) continue;
        if (e.bg == bind_group_) bind_group_ = nullptr;
        if (e.bg == texture_group_) texture_group_ = nullptr;
        if (e.bg) wgpuBindGroupRelease(e.bg);
        bind_group_cache_.erase(bind_group_cache_.begin() + static_cast<std::ptrdiff_t>(i));
        bind_group_dirty_ = true;
    }
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
    // and the engine never samples its depth attachments. Color textures carry
    // CopySrc so an offscreen target can serve the async readback seam.
    td.usage = isDepthFormat(td.format)
                   ? WGPUTextureUsage_RenderAttachment
                   : (WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst |
                      WGPUTextureUsage_CopySrc | WGPUTextureUsage_RenderAttachment);

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

TextureHandle WebGPUDevice::createCompressedTexture(const TextureDesc& desc, GfxCompressedFormat format,
                                                    const void* data, u32 byteLength) {
    if (!device_ || !queue_) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: no device");
        return TextureHandle::Invalid;
    }
    const WGPUTextureFormat wgpuFmt = toWGPUCompressedFormat(format);
    if (wgpuFmt == WGPUTextureFormat_Undefined) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: unmapped format");
        return TextureHandle::Invalid;
    }

    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.format = wgpuFmt;
    td.size = WGPUExtent3D{desc.width, desc.height, 1};
    td.mipLevelCount = 1;
    td.sampleCount = 1;
    td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;   // compressed = sampled, never a target

    WGPUTexture texture = wgpuDeviceCreateTexture(device_, &td);
    if (!texture) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: creation failed ({}x{})", desc.width, desc.height);
        return TextureHandle::Invalid;
    }

    // writeTexture counts BLOCKS, not pixels: a partial edge block still counts.
    const CompressedBlockInfo bi = compressedBlockInfo(format);
    const u32 blocksX = (desc.width + bi.blockWidth - 1) / bi.blockWidth;
    const u32 blocksY = (desc.height + bi.blockHeight - 1) / bi.blockHeight;
    WGPUTexelCopyTextureInfo dst{};
    dst.texture = texture;
    dst.origin = WGPUOrigin3D{0, 0, 0};
    WGPUTexelCopyBufferLayout layout{};
    layout.bytesPerRow = blocksX * bi.bytesPerBlock;
    layout.rowsPerImage = blocksY;
    WGPUExtent3D extent{desc.width, desc.height, 1};
    wgpuQueueWriteTexture(queue_, &dst, data, byteLength, &layout, &extent);

    const u32 id = next_id_++;
    textures_[id] = TextureRec{texture, wgpuTextureCreateView(texture, nullptr),
                               desc.width, desc.height, wgpuFmt,
                               packSamplerKey(desc.minFilter, desc.magFilter,
                                              desc.wrapS, desc.wrapT)};
    return TextureHandle{id};
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
    if (it->second.view) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(it->second.view)));
        wgpuTextureViewRelease(it->second.view);
    }
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

    const u32 bpp = it->second.format == WGPUTextureFormat_RGBA16Float ? 8u : 4u;
    WGPUTexelCopyBufferLayout layout{};
    layout.bytesPerRow = width * bpp;
    layout.rowsPerImage = height;

    WGPUExtent3D extent{width, height, 1};
    wgpuQueueWriteTexture(queue_, &dst, pixels,
                          static_cast<usize>(width) * height * bpp, &layout, &extent);
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
}

bool WebGPUDevice::supportsCompressedFormat(GfxCompressedFormat format) {
    if (toWGPUCompressedFormat(format) == WGPUTextureFormat_Undefined) return false;
    // Native: the host passes the adapter, so query it for real — and it requests
    // exactly the supported compression families at device creation, so "adapter
    // has" == "device can create". Without an adapter handle (the web WebGPU
    // build) assume the ETC2 core baseline.
    if (!adapter_) return toWGPUCompressedFormat(format) != WGPUTextureFormat_Undefined;
    return wgpuAdapterHasFeature(adapter_, compressionFeatureFor(format)) != 0;
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
    // Reflection-by-scan: bind groups must match the pipeline's auto layout
    // exactly, so record which group-0 UBO slots and group-1 texture/sampler
    // bindings the program declares (twin discipline: declare = use).
    rec.group0Mask = scanWGSLBindingMask(source.vertexSrc, 0) |
                     scanWGSLBindingMask(source.fragmentSrc, 0);
    rec.group1Mask = scanWGSLBindingMask(source.vertexSrc, 1) |
                     scanWGSLBindingMask(source.fragmentSrc, 1);
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
    const u32 dsVariant = dsVariantOf(pass_ds_format_);
    const u32 variant = dsVariant * kColorVariantCount + colorVariantOf(pass_color_format_);
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
    target.format = pass_color_format_;
    target.blend = desc.blendEnabled ? &blendState : nullptr;
    target.writeMask = (desc.stencil == GfxStencilMode::Write) ? WGPUColorWriteMask_None
                                                               : WGPUColorWriteMask_All;

    WGPUFragmentState fragment{};
    fragment.module = progIt->second.fragment;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;

    WGPURenderPipelineDescriptor pd{};
    // Explicit layout from the program's binding masks — the same cached
    // objects flushBindGroup builds bind groups against, so declared-but-
    // unbound bindings are legal (dummy backfill) and group compatibility
    // holds by identity.
    pd.layout = pipelineLayoutFor(progIt->second.group0Mask, progIt->second.group1Mask);
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
    if (dsVariant != kDsNone) {
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
    const u32 key = colorVariantOf(pass_color_format_) << 5 |
                    dsVariantOf(pass_ds_format_) << 3 |
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
    target.format = pass_color_format_;
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

WGPUBindGroupLayout WebGPUDevice::groupLayoutFor(u32 group, u32 mask) {
    const u64 key = (static_cast<u64>(group) << 32) | mask;
    auto cached = group_layouts_.find(key);
    if (cached != group_layouts_.end()) return cached->second;
    if (!device_) return nullptr;

    WGPUBindGroupLayoutEntry entries[kTextureSlots * 2];
    u32 count = 0;
    if (group == 0) {
        // Engine UBO slots. minBindingSize stays 0: the shader's own struct
        // size is validated per draw, and dummy backfill covers unbound slots.
        for (u32 slot = 0; slot < kUniformSlots; ++slot) {
            if ((mask & (1u << slot)) == 0) continue;
            WGPUBindGroupLayoutEntry e{};
            e.binding = slot;
            e.visibility = WGPUShaderStage_Vertex | WGPUShaderStage_Fragment;
            e.buffer.type = WGPUBufferBindingType_Uniform;
            entries[count++] = e;
        }
    } else {
        // Texture units through the unit→binding convention. Fragment-only
        // visibility: the engine samples in fragment stages exclusively.
        static_assert(kTextureSlots == kGroup1TextureUnits,
                      "device texture slots mirror the group-1 convention");
        for (u32 unit = 0; unit < kTextureSlots; ++unit) {
            const u32 tb = textureBindingForUnit(unit);
            const u32 sb = samplerBindingForUnit(unit);
            if (mask & (1u << tb)) {
                WGPUBindGroupLayoutEntry e{};
                e.binding = tb;
                e.visibility = WGPUShaderStage_Fragment;
                e.texture.sampleType = WGPUTextureSampleType_Float;
                e.texture.viewDimension = WGPUTextureViewDimension_2D;
                entries[count++] = e;
            }
            if (mask & (1u << sb)) {
                WGPUBindGroupLayoutEntry e{};
                e.binding = sb;
                e.visibility = WGPUShaderStage_Fragment;
                e.sampler.type = WGPUSamplerBindingType_Filtering;
                entries[count++] = e;
            }
        }
    }

    WGPUBindGroupLayoutDescriptor bld{};
    bld.entryCount = count;
    bld.entries = entries;
    WGPUBindGroupLayout layout = wgpuDeviceCreateBindGroupLayout(device_, &bld);
    group_layouts_[key] = layout;
    return layout;
}

WGPUPipelineLayout WebGPUDevice::pipelineLayoutFor(u32 group0Mask, u32 group1Mask) {
    const u64 key = (static_cast<u64>(group1Mask) << 32) | group0Mask;
    auto cached = pipeline_layouts_.find(key);
    if (cached != pipeline_layouts_.end()) return cached->second;
    if (!device_) return nullptr;

    // Group indices are positional: a program with group-1 bindings always
    // carries a group-0 layout too (zero entries when the mask is empty).
    WGPUBindGroupLayout bgls[2];
    u32 count = 0;
    if (group0Mask != 0 || group1Mask != 0) bgls[count++] = groupLayoutFor(0, group0Mask);
    if (group1Mask != 0) bgls[count++] = groupLayoutFor(1, group1Mask);

    WGPUPipelineLayoutDescriptor pld{};
    pld.bindGroupLayoutCount = count;
    pld.bindGroupLayouts = bgls;
    WGPUPipelineLayout layout = wgpuDeviceCreatePipelineLayout(device_, &pld);
    pipeline_layouts_[key] = layout;
    return layout;
}

void WebGPUDevice::ensureDummies() {
    if (dummy_ubo_ == BufferHandle::Invalid || buffers_.find(static_cast<u32>(dummy_ubo_)) == buffers_.end()) {
        // Sized past the largest engine block (LightConstants, 1184 bytes) so a
        // declared-but-unbound block always satisfies draw-time size validation.
        const std::vector<u8> zeros(2048, 0);
        dummy_ubo_ = createBuffer({GfxBufferUsage::Uniform, 2048, false}, zeros.data());
    }
    if (dummy_texture_ == 0 || textures_.find(dummy_texture_) == textures_.end()) {
        const u8 white[4] = {255, 255, 255, 255};
        TextureDesc td{};
        dummy_texture_ = static_cast<u32>(createTexture(td, white));
    }
}

WGPUBindGroup WebGPUDevice::cachedBindGroup(u32 group, u32 mask, const u64* ids, u32 idCount,
                                            const WGPUBindGroupDescriptor& desc) {
    for (auto& e : bind_group_cache_) {
        if (e.group != group || e.mask != mask || e.ids.size() != idCount) continue;
        bool same = true;
        for (u32 i = 0; i < idCount; ++i) {
            if (e.ids[i] != ids[i]) { same = false; break; }
        }
        if (same) return e.bg;  // hit — reuse, no wgpuDeviceCreateBindGroup
    }
    // Miss. A stable scene never fills the cache; clearing when full is a simple,
    // safe eviction — a group bound this frame stays alive via the pass encoder's
    // own reference until submit, so releasing our handle now is fine.
    if (bind_group_cache_.size() >= kBindGroupCacheCap) {
        for (auto& e : bind_group_cache_) if (e.bg) wgpuBindGroupRelease(e.bg);
        bind_group_cache_.clear();
    }
    WGPUBindGroup bg = wgpuDeviceCreateBindGroup(device_, &desc);
    if (bg) bind_group_cache_.push_back({group, mask, std::vector<u64>(ids, ids + idCount), bg});
    return bg;
}

void WebGPUDevice::flushBindGroup() {
    if (!bind_group_dirty_ || !pass_ || !device_) return;

    WGPURenderPipeline p = ensurePipeline(current_pipeline_);
    if (!p) return;

    const ProgramRec* prog = nullptr;
    if (auto pipeIt = pipelines_.find(current_pipeline_); pipeIt != pipelines_.end()) {
        auto progIt = programs_.find(static_cast<u32>(pipeIt->second.desc.program));
        if (progIt != programs_.end()) prog = &progIt->second;
    }
    if (!prog) return;
    if (prog->group0Mask == 0 && prog->group1Mask == 0) {
        bind_group_dirty_ = false;
        return;
    }

    ensureDummies();

    // Group 0 = the engine's UBO bindings (0..4). Every mask bit gets an entry
    // against the explicit layout: the armed slot's buffer (the engine keeps
    // Frame/Time/DrawParams on 0/3/4, Material/Light arrive per draw/frame), or
    // the zeroed dummy for a declared-but-unbound slot. A group-1-only program
    // still sets a (zero-entry) group 0, keeping indices positional.
    {
        WGPUBindGroupEntry entries[kUniformSlots];
        u32 count = 0;
        for (u32 slot = 0; slot < kUniformSlots; ++slot) {
            if ((prog->group0Mask & (1u << slot)) == 0) continue;
            auto it = buffers_.find(uniform_slots_[slot]);
            if (it == buffers_.end()) it = buffers_.find(static_cast<u32>(dummy_ubo_));
            if (it == buffers_.end()) continue;
            WGPUBindGroupEntry e{};
            e.binding = slot;
            e.buffer = it->second.buffer;
            e.offset = 0;
            e.size = it->second.size;
            entries[count++] = e;
        }

        WGPUBindGroupDescriptor bgd{};
        bgd.layout = groupLayoutFor(0, prog->group0Mask);
        bgd.entryCount = count;
        bgd.entries = entries;
        u64 ids[kUniformSlots];
        for (u32 i = 0; i < count; ++i)
            ids[i] = static_cast<u64>(reinterpret_cast<uintptr_t>(entries[i].buffer));
        bind_group_ = cachedBindGroup(0, prog->group0Mask, ids, count, bgd);
        if (bind_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 0, bind_group_, 0, nullptr);
    }

    // Group 1: the texture units through the unit→binding convention (engine
    // units 0..7 at texture bindings 0..7 / samplers 8..15, material units
    // 8..15 at 16..23 / 24..31; sampler i carries texture i's filter/wrap
    // params via the sampler cache). Every declared binding gets an entry —
    // the bound unit's view/sampler or the 1x1 white dummy — so the group
    // always matches the explicit layout, textures bound or not.
    if (prog->group1Mask != 0) {
        auto dummyIt = textures_.find(dummy_texture_);
        const TextureRec* dummy = (dummyIt != textures_.end()) ? &dummyIt->second : nullptr;

        WGPUBindGroupEntry texEntries[kTextureSlots * 2];
        u32 texCount = 0;
        for (u32 unit = 0; unit < kTextureSlots; ++unit) {
            auto it = textures_.find(texture_slots_[unit]);
            const TextureRec* rec = (it != textures_.end()) ? &it->second : dummy;
            if (!rec) continue;
            const u32 tb = textureBindingForUnit(unit);
            const u32 sb = samplerBindingForUnit(unit);
            if (prog->group1Mask & (1u << tb)) {
                WGPUBindGroupEntry e{};
                e.binding = tb;
                e.textureView = rec->view;
                texEntries[texCount++] = e;
            }
            if (prog->group1Mask & (1u << sb)) {
                WGPUBindGroupEntry e{};
                e.binding = sb;
                e.sampler = samplerFor(rec->samplerKey);
                texEntries[texCount++] = e;
            }
        }

        WGPUBindGroupDescriptor tgd{};
        tgd.layout = groupLayoutFor(1, prog->group1Mask);
        tgd.entryCount = texCount;
        tgd.entries = texEntries;
        u64 tids[kTextureSlots * 2];
        for (u32 i = 0; i < texCount; ++i) {
            const uintptr_t p = texEntries[i].textureView
                ? reinterpret_cast<uintptr_t>(texEntries[i].textureView)
                : reinterpret_cast<uintptr_t>(texEntries[i].sampler);
            tids[i] = static_cast<u64>(p);
        }
        texture_group_ = cachedBindGroup(1, prog->group1Mask, tids, texCount, tgd);
        if (texture_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 1, texture_group_, 0, nullptr);
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
    pass_color_format_ = surface_format_;
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
        pass_color_format_ = texIt->second.format;
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

    // GPU timing: time the surface (present) pass — one timestamped pass per frame
    // in the common case. Reserve a free ring slot; skip timing if none is free.
    pass_timed_ = false;
    gpu_time_slot_ = kGpuTimeRing;
    if (timestamp_supported_ && desc.target == FramebufferHandle::Default) {
        for (u32 i = 0; i < kGpuTimeRing; ++i) {
            const u32 s = (gpu_time_next_ + i) % kGpuTimeRing;
            if (!gpu_time_ring_[s].pending) {
                gpu_time_slot_ = s;
                gpu_time_next_ = (s + 1) % kGpuTimeRing;
                break;
            }
        }
        pass_timed_ = (gpu_time_slot_ < kGpuTimeRing);
    }

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
    WGPUPassTimestampWrites tw{};
    if (pass_timed_) {
        tw.querySet = timestamp_qset_;
        tw.beginningOfPassWriteIndex = 0;
        tw.endOfPassWriteIndex = 1;
        rp.timestampWrites = &tw;  // outlives the call below (same scope)
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
}

void WebGPUDevice::endRenderPass() {
    if (!pass_) return;
    wgpuRenderPassEncoderEnd(pass_);
    wgpuRenderPassEncoderRelease(pass_);
    pass_ = nullptr;

    // GPU timing: resolve this pass's begin/end timestamps into the reserved ring
    // slot (recorded on the same encoder, so it runs after the pass on the GPU).
    const bool timed = pass_timed_ && gpu_time_slot_ < kGpuTimeRing && encoder_;
    if (timed) {
        wgpuCommandEncoderResolveQuerySet(encoder_, timestamp_qset_, 0, 2, timestamp_resolve_, 0);
        wgpuCommandEncoderCopyBufferToBuffer(encoder_, timestamp_resolve_, 0,
                                             gpu_time_ring_[gpu_time_slot_].buf, 0, 16);
    }

    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder_, nullptr);
    wgpuCommandEncoderRelease(encoder_);
    encoder_ = nullptr;
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);

    if (timed) {
        // Map async — drained by getTimerQueryNs a few frames later (the GpuTimer
        // ring tolerates the latency).
        gpu_time_ring_[gpu_time_slot_].pending = true;
        WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
        cb.mode = WGPUCallbackMode_AllowSpontaneous;
        cb.callback = &WebGPUDevice::onGpuTimeMapped;
        cb.userdata1 = this;
        cb.userdata2 = reinterpret_cast<void*>(static_cast<uintptr_t>(gpu_time_slot_));
        wgpuBufferMapAsync(gpu_time_ring_[gpu_time_slot_].buf, WGPUMapMode_Read, 0, 16, cb);
    }
    pass_timed_ = false;
    gpu_time_slot_ = kGpuTimeRing;

    if (frame_view_) { wgpuTextureViewRelease(frame_view_); frame_view_ = nullptr; }
    if (frame_texture_) { wgpuTextureRelease(frame_texture_); frame_texture_ = nullptr; }
}

// =============================================================================
// Readback (async seam: texture → staging copy, resolved when the map lands)
// =============================================================================

void WebGPUDevice::onReadbackMapped(WGPUMapAsyncStatus status, WGPUStringView /*message*/,
                                    void* userdata1, void* userdata2) {
    auto* self = static_cast<WebGPUDevice*>(userdata1);
    const u32 id = static_cast<u32>(reinterpret_cast<uintptr_t>(userdata2));
    auto it = self->readbacks_.find(id);
    if (it == self->readbacks_.end()) return;  // taken or discarded while in flight
    it->second.status = (status == WGPUMapAsyncStatus_Success) ? GfxReadbackStatus::Ready
                                                               : GfxReadbackStatus::Failed;
}

void WebGPUDevice::releaseReadback(u32 id) {
    auto it = readbacks_.find(id);
    if (it == readbacks_.end()) return;
    WGPUBuffer buffer = it->second.buffer;
    // Erase first: releasing a buffer with a pending map fires the callback with
    // an abort status, which must miss the lookup.
    readbacks_.erase(it);
    if (buffer) wgpuBufferRelease(buffer);
}

ReadbackHandle WebGPUDevice::requestReadback(FramebufferHandle target, u32 w, u32 h) {
    if (!device_ || w == 0 || h == 0) return ReadbackHandle::Invalid;
    if (inPass()) {
        ES_LOG_ERROR("WebGPUDevice::requestReadback: must be called outside a render pass");
        return ReadbackHandle::Invalid;
    }
    if (target == FramebufferHandle::Default) {
        // The surface texture is released at endRenderPass and carries no CopySrc;
        // page-level capture covers the presented frame instead.
        stubOnce("requestReadback(default framebuffer)");
        return ReadbackHandle::Invalid;
    }
    auto fit = framebuffers_.find(static_cast<u32>(target));
    if (fit == framebuffers_.end()) return ReadbackHandle::Invalid;
    auto tit = textures_.find(fit->second.color0);
    if (tit == textures_.end() || !tit->second.texture) return ReadbackHandle::Invalid;

    // copyTextureToBuffer requires a 256-byte row alignment; rows are compacted
    // (and flipped to the bottom-up contract) in takeReadback.
    const u32 padded = (w * 4u + 255u) & ~255u;
    WGPUBufferDescriptor bd{};
    bd.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    bd.size = static_cast<u64>(padded) * h;
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device_, &bd);
    if (!buffer) return ReadbackHandle::Invalid;

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    WGPUTexelCopyTextureInfo src = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    src.texture = tit->second.texture;
    WGPUTexelCopyBufferInfo dst = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    dst.buffer = buffer;
    dst.layout.offset = 0;
    dst.layout.bytesPerRow = padded;
    dst.layout.rowsPerImage = h;
    WGPUExtent3D size{w, h, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &src, &dst, &size);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);

    const u32 id = next_readback_id_++;
    readbacks_[id] = ReadbackRec{buffer, w, h, padded, GfxReadbackStatus::Pending};

    WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_AllowSpontaneous;
    cb.callback = &WebGPUDevice::onReadbackMapped;
    cb.userdata1 = this;
    cb.userdata2 = reinterpret_cast<void*>(static_cast<uintptr_t>(id));
    wgpuBufferMapAsync(buffer, WGPUMapMode_Read, 0, bd.size, cb);
    return static_cast<ReadbackHandle>(id);
}

GfxReadbackStatus WebGPUDevice::pollReadback(ReadbackHandle handle) {
    // AllowSpontaneous callbacks fire from the browser's event loop on their own;
    // the pump is defensive (and required if the callback mode ever tightens).
    if (instance_) wgpuInstanceProcessEvents(instance_);
    auto it = readbacks_.find(static_cast<u32>(handle));
    if (it == readbacks_.end()) return GfxReadbackStatus::Failed;
    if (it->second.status == GfxReadbackStatus::Failed) {
        releaseReadback(static_cast<u32>(handle));
        return GfxReadbackStatus::Failed;
    }
    return it->second.status;
}

bool WebGPUDevice::takeReadback(ReadbackHandle handle, void* dest, usize destSize) {
    auto it = readbacks_.find(static_cast<u32>(handle));
    if (it == readbacks_.end() || it->second.status != GfxReadbackStatus::Ready) return false;
    ReadbackRec& rec = it->second;
    const usize tight = static_cast<usize>(rec.width) * rec.height * 4;
    if (destSize < tight) return false;
    const auto* mapped = static_cast<const u8*>(
        wgpuBufferGetConstMappedRange(rec.buffer, 0, static_cast<u64>(rec.paddedBytesPerRow) * rec.height));
    if (!mapped) {
        releaseReadback(static_cast<u32>(handle));
        return false;
    }
    // The copy lands top-down; the contract (GL readPixels) is bottom-up rows.
    auto* out = static_cast<u8*>(dest);
    const u32 rowBytes = rec.width * 4u;
    for (u32 row = 0; row < rec.height; ++row) {
        std::memcpy(out + static_cast<usize>(rec.height - 1 - row) * rowBytes,
                    mapped + static_cast<usize>(row) * rec.paddedBytesPerRow, rowBytes);
    }
    wgpuBufferUnmap(rec.buffer);
    releaseReadback(static_cast<u32>(handle));
    return true;
}

void WebGPUDevice::discardReadback(ReadbackHandle handle) {
    releaseReadback(static_cast<u32>(handle));
}

// =============================================================================
// Timing / queries / debug
// =============================================================================

void WebGPUDevice::ensureTimestamps() {
    if (timestamp_init_done_) return;
    timestamp_init_done_ = true;
    if (!device_ || !wgpuDeviceHasFeature(device_, WGPUFeatureName_TimestampQuery)) return;

    WGPUQuerySetDescriptor qd{};
    qd.type = WGPUQueryType_Timestamp;
    qd.count = 2;  // begin + end of the timed pass
    timestamp_qset_ = wgpuDeviceCreateQuerySet(device_, &qd);
    if (!timestamp_qset_) return;

    WGPUBufferDescriptor rd{};
    rd.usage = WGPUBufferUsage_QueryResolve | WGPUBufferUsage_CopySrc;
    rd.size = 16;  // 2 × u64 nanosecond timestamps
    timestamp_resolve_ = wgpuDeviceCreateBuffer(device_, &rd);
    for (u32 i = 0; i < kGpuTimeRing; ++i) {
        WGPUBufferDescriptor bd{};
        bd.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
        bd.size = 16;
        gpu_time_ring_[i].buf = wgpuDeviceCreateBuffer(device_, &bd);
    }
    timestamp_supported_ = timestamp_resolve_ && gpu_time_ring_[0].buf;
}

u32 WebGPUDevice::createTimerQuery() {
    ensureTimestamps();
    return timestamp_supported_ ? 1 : 0;  // non-zero → the engine's GpuTimer enables; 0 → no GPU timing (as before)
}

void WebGPUDevice::beginTimerQuery(u32) {}  // timing rides the pass: attached at beginRenderPass, resolved at endRenderPass
void WebGPUDevice::endTimerQuery() {}
bool WebGPUDevice::timerDisjoint() { return false; }

bool WebGPUDevice::getTimerQueryNs(u32, u64* outNs) {
    if (gpu_time_results_.empty()) return false;
    if (outNs) *outNs = gpu_time_results_.front();
    gpu_time_results_.erase(gpu_time_results_.begin());
    return true;
}

void WebGPUDevice::onGpuTimeMapped(WGPUMapAsyncStatus status, WGPUStringView /*message*/,
                                   void* userdata1, void* userdata2) {
    auto* self = static_cast<WebGPUDevice*>(userdata1);
    const u32 slot = static_cast<u32>(reinterpret_cast<uintptr_t>(userdata2));
    if (!self || slot >= kGpuTimeRing) return;
    WGPUBuffer buf = self->gpu_time_ring_[slot].buf;
    if (status == WGPUMapAsyncStatus_Success && buf) {
        const auto* ts = static_cast<const u64*>(wgpuBufferGetConstMappedRange(buf, 0, 16));
        // Cap the FIFO so a stalled consumer can't grow it without bound.
        if (ts && ts[1] >= ts[0] && self->gpu_time_results_.size() < 16)
            self->gpu_time_results_.push_back(ts[1] - ts[0]);
        wgpuBufferUnmap(buf);
    }
    self->gpu_time_ring_[slot].pending = false;
}

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
