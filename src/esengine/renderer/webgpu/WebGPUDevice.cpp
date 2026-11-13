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
#include "../rhi/PixelUpload.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

namespace esengine {

using namespace webgpu;

namespace {
WGPUStringView sv(const char* text) {
    WGPUStringView view{};
    view.data = text;
    view.length = text ? std::strlen(text) : 0;
    return view;
}

std::string fromSv(const WGPUStringView& view) {
    if (!view.data) return {};
    return std::string(view.data,
                       view.length == WGPU_STRLEN ? std::strlen(view.data) : view.length);
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

// One and four: what WebGPU guarantees for every renderable format. A target
// asking for more gets four, and its pipelines are built to match the pass they
// draw into — which WebGPU validates, unlike GL.
u32 WebGPUDevice::maxSamples() { return kMsaaSamples; }

void WebGPUDevice::init() {
    captureDeviceIdentity();
}

void WebGPUDevice::captureDeviceIdentity() {
    // Ask the adapter who this GPU is. getString() below answers with constants
    // true of every WebGPU build, and so useless in a loss report; the adapter
    // knows the vendor, the chip and the driver build.
    std::string vendor = "WebGPU";
    std::string renderer = getString(GfxStringName::Renderer);
    std::string version = getString(GfxStringName::Version);
    if (adapter_) {
        WGPUAdapterInfo info = {};
        if (wgpuAdapterGetInfo(adapter_, &info) == WGPUStatus_Success) {
            vendor = fromSv(info.vendor);
            renderer = fromSv(info.device) + " (" + fromSv(info.architecture) + ")";
            version = fromSv(info.description);
            wgpuAdapterInfoFreeMembers(info);
        }
    }
    setDeviceIdentity("WebGPU", std::move(vendor), std::move(renderer), std::move(version));
}

GfxDeviceLostReason WebGPUDevice::reasonFromWgpu(u32 wgpuReason) {
    switch (static_cast<WGPUDeviceLostReason>(wgpuReason)) {
    // Not a failure: this is the device we destroyed reporting that it is gone.
    case WGPUDeviceLostReason_Destroyed:      return GfxDeviceLostReason::Destroyed;
    case WGPUDeviceLostReason_FailedCreation: return GfxDeviceLostReason::Internal;
    default:                                  return GfxDeviceLostReason::Unknown;
    }
}

bool WebGPUDevice::pollDeviceLost() {
    // The device-lost callback is registered AllowSpontaneous and so fires on
    // its own, but pumping here gives it a guaranteed point in the frame — and
    // keeps the loss detectable if the mode ever tightens to ProcessEvents.
    if (instance_) wgpuInstanceProcessEvents(instance_);
    return false;
}

void WebGPUDevice::reportUncapturedError(u32 wgpuErrorType, const char* message) {
    // Only errors that mean the device is finished become losses. A validation
    // error is a bug in the frame we just built — WebGPU drops the call and keeps
    // the device — so promoting it would end the game over one bad draw.
    const auto type = static_cast<WGPUErrorType>(wgpuErrorType);
    if (type == WGPUErrorType_OutOfMemory) {
        markDeviceLost(GfxDeviceLostReason::OutOfMemory, message ? message : "",
                       "uncaptured error");
    } else if (type == WGPUErrorType_Internal) {
        markDeviceLost(GfxDeviceLostReason::Internal, message ? message : "",
                       "uncaptured error");
    } else if (type == WGPUErrorType_Validation && validation_errors_logged_ < 8) {
        // Said, the first few: otherwise all that reaches the console is the queue refusing an invalid command buffer, which names
        // nothing that made it invalid.
        ++validation_errors_logged_;
        ES_LOG_WARN("WebGPU validation error: {}", message ? message : "(no message)");
    }
}

bool WebGPUDevice::adoptDevice(WGPUDevice device) {
    if (!device) return false;

    // Everything below the device goes: a WebGPU object belongs to the device
    // that made it, so none of these caches can be carried over. The instance
    // stays — it outlives devices, and on native the surface must match it.
    releaseDeviceObjects();

    device_ = device;
    queue_ = wgpuDeviceGetQueue(device_);
    init();

#if defined(__EMSCRIPTEN__)
    if (surface_selector_.empty()) return true;
    return configureSurface(surface_selector_.c_str(), surface_width_, surface_height_);
#else
    if (!surface_window_) return true;
    NativeSurface window{};
    window.handle = surface_window_;
    return configureSurface(window, surface_width_, surface_height_);
#endif
}

bool WebGPUDevice::recreateDevice() {
    // "Not yet", not "never": only whoever created the device can replace it, so
    // this waits for a host to hand one over rather than claiming a recovery it
    // cannot perform. The GL path waits on the browser the same way.
    if (!pending_device_) return false;
    WGPUDevice next = pending_device_;
    pending_device_ = nullptr;
    return adoptDevice(next);
}

void WebGPUDevice::shutdown() {
    releaseDeviceObjects();
    if (instance_ && owns_instance_) { wgpuInstanceRelease(instance_); }
    instance_ = nullptr;
}

void WebGPUDevice::releaseDeviceObjects() {
    if (pass_) { wgpuRenderPassEncoderRelease(pass_); pass_ = nullptr; }
    if (encoder_) { wgpuCommandEncoderRelease(encoder_); encoder_ = nullptr; }
    if (frame_view_) { wgpuTextureViewRelease(frame_view_); frame_view_ = nullptr; }
    if (frame_texture_) { wgpuTextureRelease(frame_texture_); frame_texture_ = nullptr; }
    capture_id_ = 0;
    capture_copied_ = false;
    pass_is_surface_ = false;
    pass_timed_ = false;
    span_open_ = false;
    span_closing_ = false;
    span_slot_ = kGpuTimeRing;
    span_passes_ = 0;

    // bind_group_/texture_group_ point INTO the cache — release the cache, not them.
    for (auto& bucket : bind_group_cache_) for (auto& e : bucket.second) if (e.bg) wgpuBindGroupRelease(e.bg);
    bind_group_cache_.clear();
    bind_group_count_ = 0;
    bind_group_ = nullptr;
    texture_group_ = nullptr;
    bind_group_dirty_ = true;
    bound_pipeline_ = 0;

    for (auto& [id, rec] : buffers_) {
        if (rec.buffer) wgpuBufferRelease(rec.buffer);
    }
    buffers_.clear();
    for (auto& [id, rec] : textures_) releaseTexture(rec);
    textures_.clear();
    for (auto& [id, rec] : programs_) {
        if (rec.vertex) wgpuShaderModuleRelease(rec.vertex);
        if (rec.fragment) wgpuShaderModuleRelease(rec.fragment);
    }
    programs_.clear();
    for (auto& [id, rec] : computes_) {
        for (auto& [key, pipeline] : rec.pipelines) {
            if (pipeline) wgpuComputePipelineRelease(pipeline);
        }
        if (rec.module) wgpuShaderModuleRelease(rec.module);
    }
    computes_.clear();
    for (auto& [key, layout] : compute_pipeline_layouts_) {
        if (layout) wgpuPipelineLayoutRelease(layout);
    }
    compute_pipeline_layouts_.clear();
    for (auto& [key, layout] : compute_layouts_) {
        if (layout) wgpuBindGroupLayoutRelease(layout);
    }
    compute_layouts_.clear();
    for (auto& [id, rec] : pipelines_) {
        for (WGPURenderPipeline variant : rec.variants) {
            if (variant) wgpuRenderPipelineRelease(variant);
        }
    }
    pipelines_.clear();

    if (dummy_ubo_.buffer) wgpuBufferRelease(dummy_ubo_.buffer);
    dummy_ubo_ = BufferRec{};
    releaseTexture(dummy_texture_);
    releaseTexture(dummy_depth_texture_);
    releaseTexture(dummy_array_texture_);

    // GPU timing resources.
    if (timestamp_qset_) { wgpuQuerySetRelease(timestamp_qset_); timestamp_qset_ = nullptr; }
    if (timestamp_resolve_) { wgpuBufferRelease(timestamp_resolve_); timestamp_resolve_ = nullptr; }
    for (auto& s : gpu_time_ring_) { if (s.buf) wgpuBufferRelease(s.buf); s.buf = nullptr; s.pending = false; }
    gpu_time_results_.clear();
    for (auto& ps : pass_time_pool_) { if (ps.buf) wgpuBufferRelease(ps.buf); }
    pass_time_pool_.clear();
    pass_time_results_.clear();
    pass_time_slot_ = kNoPassSlot;
    armed_pass_tag_ = 0;
    timestamp_supported_ = false;
    timestamp_init_done_ = false;
    if (clear_bind_group_) { wgpuBindGroupRelease(clear_bind_group_); clear_bind_group_ = nullptr; }
    if (clear_color_buffer_) { wgpuBufferRelease(clear_color_buffer_); clear_color_buffer_ = nullptr; }
    for (auto& [key, pipeline] : clear_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    clear_pipelines_.clear();
    if (clear_layout_) { wgpuPipelineLayoutRelease(clear_layout_); clear_layout_ = nullptr; }
    if (clear_bgl_) { wgpuBindGroupLayoutRelease(clear_bgl_); clear_bgl_ = nullptr; }
    for (auto& [key, pipeline] : flip_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    flip_pipelines_.clear();
    if (flip_layout_) { wgpuPipelineLayoutRelease(flip_layout_); flip_layout_ = nullptr; }
    if (flip_bgl_) { wgpuBindGroupLayoutRelease(flip_bgl_); flip_bgl_ = nullptr; }
    // The depth-resolve family, for the same reason: every one of these belongs to
    // the device that made it, and Dawn refuses one from the generation before.
    for (auto& [key, pipeline] : depth_resolve_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    depth_resolve_pipelines_.clear();
    if (depth_resolve_layout_) { wgpuPipelineLayoutRelease(depth_resolve_layout_); depth_resolve_layout_ = nullptr; }
    if (depth_resolve_bgl_) { wgpuBindGroupLayoutRelease(depth_resolve_bgl_); depth_resolve_bgl_ = nullptr; }
    if (depth_resolve_vs_) { wgpuShaderModuleRelease(depth_resolve_vs_); depth_resolve_vs_ = nullptr; }
    if (depth_resolve_fs_) { wgpuShaderModuleRelease(depth_resolve_fs_); depth_resolve_fs_ = nullptr; }
    for (auto& [key, pipeline] : mip_pipelines_) {
        if (pipeline) wgpuRenderPipelineRelease(pipeline);
    }
    mip_pipelines_.clear();
    if (mip_layout_) { wgpuPipelineLayoutRelease(mip_layout_); mip_layout_ = nullptr; }
    if (mip_bgl_) { wgpuBindGroupLayoutRelease(mip_bgl_); mip_bgl_ = nullptr; }
    if (mip_module_) { wgpuShaderModuleRelease(mip_module_); mip_module_ = nullptr; }
    if (mip_sampler_) { wgpuSamplerRelease(mip_sampler_); mip_sampler_ = nullptr; }
    for (auto& [key, layout] : pipeline_layouts_) {
        if (layout) wgpuPipelineLayoutRelease(layout);
    }
    pipeline_layouts_.clear();
    for (auto& [key, layout] : group_layouts_) {
        if (layout) wgpuBindGroupLayoutRelease(layout);
    }
    group_layouts_.clear();
    // Erase before release: aborting a pending map fires the callback, which must
    // miss the lookup rather than see a half-dead record.
    while (!readbacks_.empty()) releaseReadback(readbacks_.begin()->first);
    for (auto& [key, sampler] : samplers_) {
        if (sampler) wgpuSamplerRelease(sampler);
    }
    samplers_.clear();
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    if (surface_msaa_view_) { wgpuTextureViewRelease(surface_msaa_view_); surface_msaa_view_ = nullptr; }
    if (surface_msaa_texture_) { wgpuTextureRelease(surface_msaa_texture_); surface_msaa_texture_ = nullptr; }
    surface_msaa_width_ = surface_msaa_height_ = 0;
    surface_msaa_samples_ = 0;
    if (surface_) { wgpuSurfaceRelease(surface_); surface_ = nullptr; }
    // Sizes are kept: a re-configured surface has to come back the same shape,
    // and the depth companion is rebuilt against them.
    surface_depth_width_ = 0;
    surface_depth_height_ = 0;
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
    // Kept so a replacement device can re-make the surface: the old one belonged
    // to the device that died, and nothing else records which canvas it was.
    surface_selector_ = selector;
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

    // The SAME window, a new size — a rotation, insets changing, the system bars
    // leaving — is a reconfigure, not a new surface. Creating a second surface for
    // a window the first one still holds leaves every getCurrentTexture in error
    // on Vulkan (the old swapchain owns it), which is a black screen with nothing
    // else wrong.
    if (surface_ && surface_window_ == window.handle) {
        endFrame();   // a held texture belongs to the swapchain being replaced
        return configureSwapchain(width, height);
    }

    // A genuinely new window (an Android screen-off/on destroys it and hands back
    // another): let go of the old swapchain before building one on the new one.
    if (surface_) {
        endFrame();
        wgpuSurfaceUnconfigure(surface_);
        wgpuSurfaceRelease(surface_);
        surface_ = nullptr;
    }
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    surface_depth_width_ = surface_depth_height_ = 0;
    if (surface_msaa_view_) { wgpuTextureViewRelease(surface_msaa_view_); surface_msaa_view_ = nullptr; }
    if (surface_msaa_texture_) { wgpuTextureRelease(surface_msaa_texture_); surface_msaa_texture_ = nullptr; }
    surface_msaa_width_ = surface_msaa_height_ = 0;
    surface_msaa_samples_ = 0;


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
        case NativeWindowKind::Win32Hwnd: {
#if defined(_WIN32)
            WGPUSurfaceSourceWindowsHWND win32{};
            win32.chain.sType = WGPUSType_SurfaceSourceWindowsHWND;
            win32.hinstance = window.instance;
            win32.hwnd = window.handle;
            sd.nextInChain = &win32.chain;
            surface_ = wgpuInstanceCreateSurface(instance_, &sd);
#endif
            break;
        }
        case NativeWindowKind::WaylandSurface: {
#if defined(__linux__)
            WGPUSurfaceSourceWaylandSurface wayland{};
            wayland.chain.sType = WGPUSType_SurfaceSourceWaylandSurface;
            wayland.display = window.instance;   // wl_display*
            wayland.surface = window.handle;     // wl_surface*
            sd.nextInChain = &wayland.chain;
            surface_ = wgpuInstanceCreateSurface(instance_, &sd);
#endif
            break;
        }
        case NativeWindowKind::XlibWindow: {
#if defined(__linux__)
            WGPUSurfaceSourceXlibWindow xlib{};
            xlib.chain.sType = WGPUSType_SurfaceSourceXlibWindow;
            xlib.display = window.instance;      // Display*
            // The XID is an integer, not a pointer — it travels in `handle`
            // because the seam carries one window field, and is read back as the
            // integer it is rather than dereferenced.
            xlib.window = static_cast<uint64_t>(reinterpret_cast<uintptr_t>(window.handle));
            sd.nextInChain = &xlib.chain;
            surface_ = wgpuInstanceCreateSurface(instance_, &sd);
#endif
            break;
        }
    }
    if (!surface_) {
        ES_LOG_ERROR("WebGPUDevice::configureSurface(native): surface creation failed");
        return false;
    }
    surface_window_ = window.handle;

    return configureSwapchain(width, height);
}

/** Whether a surface format makes the hardware encode on write. */
static bool isSrgbFormat(WGPUTextureFormat f) {
    return f == WGPUTextureFormat_BGRA8UnormSrgb || f == WGPUTextureFormat_RGBA8UnormSrgb;
}

void WebGPUDevice::present() {
    if (!surface_) return;
    wgpuSurfacePresent(surface_);
    // Also the frame's end, for a frame the renderer never finished (the host's
    // fallback frame, or a tick that drew nothing): a swapchain texture must
    // never outlive the present it belongs to.
    endFrame();
}
#endif  // !__EMSCRIPTEN__

// Not native-only: a web surface can be BGRA too, and a capture consumer has to
// know which order the bytes came back in.
bool WebGPUDevice::surfaceBytesAreBGRA() const {
    return surface_format_ == WGPUTextureFormat_BGRA8Unorm
        || surface_format_ == WGPUTextureFormat_BGRA8UnormSrgb;
}

/**
 * The fastest present mode this surface actually advertises.
 *
 * Immediate FIRST, and the order is load-bearing: Dawn's Metal backend clears
 * `displaySyncEnabled` for Immediate ALONE (`SwapChainMTL.mm`), so a surface
 * offering both hands back a Mailbox that is still vsynced — measured, every
 * span pinned to 16.6 ms. Fifo is the fallback, and then the frame is throttled.
 */
WGPUPresentMode WebGPUDevice::pickUncappedPresentMode() const {
#if !defined(__EMSCRIPTEN__)
    if (surface_ && adapter_) {
        WGPUSurfaceCapabilities caps{};
        if (wgpuSurfaceGetCapabilities(surface_, adapter_, &caps) == WGPUStatus_Success) {
            WGPUPresentMode chosen = WGPUPresentMode_Fifo;
            for (size_t i = 0; i < caps.presentModeCount; ++i) {
                if (caps.presentModes[i] == WGPUPresentMode_Immediate) {
                    chosen = WGPUPresentMode_Immediate;
                    break;
                }
                if (caps.presentModes[i] == WGPUPresentMode_Mailbox) chosen = WGPUPresentMode_Mailbox;
            }
            wgpuSurfaceCapabilitiesFreeMembers(caps);
            return chosen;
        }
    }
#endif
    return WGPUPresentMode_Fifo;
}

bool WebGPUDevice::configureSwapchain(u32 width, u32 height) {
    // Anything but the canvas' preferred format costs a full-frame copy per
    // present, and only the page can name it (setPreferredSurfaceBGRA). Readback
    // asks frameCaptureIsBGRA which order it got.
    surface_format_ = prefer_surface_bgra_ ? WGPUTextureFormat_BGRA8Unorm
                                           : WGPUTextureFormat_RGBA8Unorm;
#if !defined(__EMSCRIPTEN__)
    // A native surface may accept nothing of the sort — a CAMetalLayer offers only
    // BGRA8Unorm, while Vulkan happens to take RGBA8 — and configuring a format the
    // surface does not advertise leaves every getCurrentTexture in error rather
    // than failing here. So ask, and take the surface's preferred (first) format.
    //
    // Of the formats it advertises, take a NON-sRGB one: the engine hands the
    // surface values that are already display-encoded (the shaders in gamma
    // mode, the final blit in linear), so an *Srgb surface encodes them twice.
    if (adapter_) {
        WGPUSurfaceCapabilities caps{};
        if (wgpuSurfaceGetCapabilities(surface_, adapter_, &caps) == WGPUStatus_Success
            && caps.formatCount > 0) {
            surface_format_ = caps.formats[0];
            for (size_t i = 0; i < caps.formatCount; ++i) {
                if (!isSrgbFormat(caps.formats[i])) {
                    surface_format_ = caps.formats[i];
                    break;
                }
            }
            wgpuSurfaceCapabilitiesFreeMembers(caps);
        }
    }
#endif
    WGPUSurfaceConfiguration cfg{};
    cfg.device = device_;
    cfg.format = surface_format_;
    cfg.usage = WGPUTextureUsage_RenderAttachment;
    // Opt-in (setSurfaceReadback): lets captureNextFrame copy the presented frame.
    if (surface_readback_) cfg.usage |= WGPUTextureUsage_CopySrc;
    cfg.width = width;
    cfg.height = height;
    // Auto, not Opaque: let the backend pick a mode the surface advertises. A
    // browser canvas supports Opaque, but a native Vulkan surface may not (e.g.
    // Adreno on Android only offers Inherit/PreMultiplied) — Configure() rejects
    // an unsupported mode outright.
    cfg.alphaMode = WGPUCompositeAlphaMode_Auto;
    // Fifo is the only mode every surface must support, and the only one a shipped
    // game should want. setPresentUncapped asks for a measurable frame instead —
    // see its comment for why a vsynced one cannot be measured.
    cfg.presentMode = present_uncapped_ ? pickUncappedPresentMode() : WGPUPresentMode_Fifo;
    // Said out loud, because a fallback here makes a measurement WRONG rather than
    // absent: a frame that was throttled reads as the refresh interval, and the
    // bench consuming it cannot tell that from a frame that cost that much.
    if (present_uncapped_) {
        ES_LOG_WARN("WebGPUDevice: uncapped present asked for, surface gave {}",
                    cfg.presentMode == WGPUPresentMode_Immediate ? "Immediate"
                    : cfg.presentMode == WGPUPresentMode_Mailbox ? "Mailbox — the compositor still shows one frame per vsync"
                                                                 : "Fifo — the frame IS the refresh interval");
    }
    wgpuSurfaceConfigure(surface_, &cfg);
    surface_width_ = width;
    surface_height_ = height;

    return ensureSurfaceDepth(width, height);
}

/**
 * The default target's companion depth-stencil planes — the WebGL canvas has
 * them implicitly, and engine stencil masks / depth-tested draws target the
 * backbuffer expecting both. Recreated whenever the size it must match changes;
 * a pass whose attachments disagree is rejected outright, and every draw after
 * that is dropped.
 */
bool WebGPUDevice::ensureSurfaceDepth(u32 width, u32 height) {
    if (surface_depth_view_ && width == surface_depth_width_ && height == surface_depth_height_
        && surface_depth_samples_ == surface_samples_) {
        return true;
    }
    if (surface_depth_view_) { wgpuTextureViewRelease(surface_depth_view_); surface_depth_view_ = nullptr; }
    if (surface_depth_texture_) { wgpuTextureRelease(surface_depth_texture_); surface_depth_texture_ = nullptr; }
    WGPUTextureDescriptor dd{};
    dd.dimension = WGPUTextureDimension_2D;
    dd.format = WGPUTextureFormat_Depth24PlusStencil8;
    dd.size = WGPUExtent3D{width, height, 1};
    dd.mipLevelCount = 1;
    // Every attachment of a pass shares its sample count, so the backbuffer's
    // depth follows the colour it is paired with.
    dd.sampleCount = surface_samples_;
    dd.usage = WGPUTextureUsage_RenderAttachment;
    surface_depth_texture_ = wgpuDeviceCreateTexture(device_, &dd);
    if (surface_depth_texture_) {
        surface_depth_view_ = wgpuTextureCreateView(surface_depth_texture_, nullptr);
        surface_depth_width_ = width;
        surface_depth_height_ = height;
        surface_depth_samples_ = surface_samples_;
    }
    return surface_depth_view_ != nullptr;
}

/**
 * The backbuffer's multisampled companion: what a surface pass draws into when
 * the project asks for MSAA, resolving into the surface texture at pass end. A
 * WebGL canvas is created antialiased; a WebGPU surface texture never is, so
 * this is where the two backends are made to agree.
 */
bool WebGPUDevice::ensureSurfaceMsaa(u32 width, u32 height) {
    if (surface_samples_ <= 1) {
        if (surface_msaa_view_) { wgpuTextureViewRelease(surface_msaa_view_); surface_msaa_view_ = nullptr; }
        if (surface_msaa_texture_) { wgpuTextureRelease(surface_msaa_texture_); surface_msaa_texture_ = nullptr; }
        surface_msaa_samples_ = 0;
        return false;
    }
    if (surface_msaa_view_ && width == surface_msaa_width_ && height == surface_msaa_height_
        && surface_samples_ == surface_msaa_samples_) {
        return true;
    }
    if (surface_msaa_view_) { wgpuTextureViewRelease(surface_msaa_view_); surface_msaa_view_ = nullptr; }
    if (surface_msaa_texture_) { wgpuTextureRelease(surface_msaa_texture_); surface_msaa_texture_ = nullptr; }
    WGPUTextureDescriptor cd{};
    cd.dimension = WGPUTextureDimension_2D;
    cd.format = surface_format_;
    cd.size = WGPUExtent3D{width, height, 1};
    cd.mipLevelCount = 1;
    cd.sampleCount = surface_samples_;
    cd.usage = WGPUTextureUsage_RenderAttachment;
    surface_msaa_texture_ = wgpuDeviceCreateTexture(device_, &cd);
    if (surface_msaa_texture_) {
        surface_msaa_view_ = wgpuTextureCreateView(surface_msaa_texture_, nullptr);
        surface_msaa_width_ = width;
        surface_msaa_height_ = height;
        surface_msaa_samples_ = surface_samples_;
    }
    return surface_msaa_view_ != nullptr;
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

// The RHI states a rectangle the way GL does: origin bottom-left, y up. WebGPU
// measures from the top-left, so any rect that is not the whole target arrives
// upside down here — a UI mask's scissor, a camera viewport sharing the target,
// a region clear. A full-target rect flips to itself, which is why only masked
// content showed it.
i32 WebGPUDevice::flipRectY(i32 y, i32 height) const {
    return static_cast<i32>(pass_height_) - (y + height);
}

void WebGPUDevice::setViewport(i32 x, i32 y, u32 w, u32 h) {
    viewport_ = {x, y, w, h};
    if (pass_) {
        wgpuRenderPassEncoderSetViewport(pass_, static_cast<f32>(x),
                                         static_cast<f32>(flipRectY(y, static_cast<i32>(h))),
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
    if (!pass_ || w <= 0 || h <= 0) return;
    // Clamped to the attachment: WebGPU rejects a rect that leaves it, where GL
    // simply clips — and a mask scrolled half off screen is ordinary.
    const i32 top = flipRectY(y, h);
    const i32 x0 = std::clamp(x, 0, static_cast<i32>(pass_width_));
    const i32 y0 = std::clamp(top, 0, static_cast<i32>(pass_height_));
    const i32 x1 = std::clamp(x + w, 0, static_cast<i32>(pass_width_));
    const i32 y1 = std::clamp(top + h, 0, static_cast<i32>(pass_height_));
    wgpuRenderPassEncoderSetScissorRect(pass_, static_cast<u32>(x0), static_cast<u32>(y0),
                                        static_cast<u32>(std::max(0, x1 - x0)),
                                        static_cast<u32>(std::max(0, y1 - y0)));
}

// =============================================================================
// Buffers
// =============================================================================

u64 WebGPUDevice::estimatedGpuBytes() const {
    if (!device_ || !isDeviceUsable()) return 0;
    u64 bytes = 0;
    const auto bufferBytes = [](WGPUBuffer buffer) -> u64 { return buffer ? wgpuBufferGetSize(buffer) : 0; };
    for (const auto& [id, buffer] : buffers_) bytes += bufferBytes(buffer.buffer);
    bytes += bufferBytes(dummy_ubo_.buffer) + bufferBytes(clear_color_buffer_) + bufferBytes(timestamp_resolve_);
    for (const auto& slot : gpu_time_ring_) bytes += bufferBytes(slot.buf);
    for (const auto& [id, readback] : readbacks_) bytes += bufferBytes(readback.buffer);
    const auto textureBytes = [](WGPUTexture texture) -> u64 {
        if (!texture) return 0;
        u32 width = wgpuTextureGetWidth(texture), height = wgpuTextureGetHeight(texture);
        const auto format = wgpuTextureGetFormat(texture);
        const u32 pixelBytes = format == WGPUTextureFormat_RGBA32Float ? 16 : format == WGPUTextureFormat_RGBA16Float ? 8 : 4;
        GfxBlockInfo block{1, 1, pixelBytes};
        for (const auto compressed : {GfxCompressedFormat::ETC2_RGB8, GfxCompressedFormat::ETC2_RGBA8,
             GfxCompressedFormat::ASTC_4x4, GfxCompressedFormat::ASTC_8x8, GfxCompressedFormat::S3TC_DXT1,
             GfxCompressedFormat::S3TC_DXT5, GfxCompressedFormat::ETC2_RGBA8_SRGB,
             GfxCompressedFormat::ASTC_4x4_SRGB, GfxCompressedFormat::S3TC_DXT5_SRGB}) {
            if (format == toWGPUCompressedFormat(compressed)) { block = gfxCompressedBlockInfo(compressed); break; }
        }
        u64 size = 0;
        for (u32 level = 0; level < wgpuTextureGetMipLevelCount(texture); ++level) {
            size += ((static_cast<u64>(width) + block.blockWidth - 1) / block.blockWidth)
                * ((static_cast<u64>(height) + block.blockHeight - 1) / block.blockHeight) * block.bytesPerBlock
                * wgpuTextureGetSampleCount(texture);
            width = std::max(1u, width / 2); height = std::max(1u, height / 2);
        }
        return size * wgpuTextureGetDepthOrArrayLayers(texture);
    };
    for (const auto& [id, texture] : textures_) bytes += textureBytes(texture.texture);
    bytes += textureBytes(dummy_texture_.texture) + textureBytes(dummy_depth_texture_.texture)
             + textureBytes(dummy_array_texture_.texture);
    bytes += textureBytes(surface_depth_texture_) + textureBytes(surface_msaa_texture_);
    return bytes;
}

WGPUBuffer WebGPUDevice::makeBuffer(GfxBufferUsage usage, u32 size, const void* data) {
    if (!device_) {
        ES_LOG_ERROR("WebGPUDevice: no device to create a buffer on");
        return nullptr;
    }
    WGPUBufferDescriptor bd{};
    bd.usage = toWGPUBufferUsage(usage);
    // Round the allocation, never the caller's data — see alignedWriteSize.
    bd.size = webgpu::alignedWriteSize(size);
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device_, &bd);
    if (!buffer) {
        ES_LOG_ERROR("WebGPUDevice: buffer creation failed ({} bytes)", size);
        return nullptr;
    }
    if (data && size > 0) writeBufferPadded(buffer, 0, data, size);
    return buffer;
}

bool WebGPUDevice::backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) {
    WGPUBuffer buffer = makeBuffer(desc.usage, desc.size, data);
    if (!buffer) return false;
    buffers_[id] = BufferRec{buffer, desc.size, desc.usage};
    return true;
}

void WebGPUDevice::writeBufferPadded(WGPUBuffer buffer, u32 offset, const void* data, u32 size) {
    if (!webgpu::needsWriteStaging(size)) {
        wgpuQueueWriteBuffer(queue_, buffer, offset, data, size);
        return;
    }
    std::vector<u8> padded(webgpu::alignedWriteSize(size), 0);
    std::memcpy(padded.data(), data, size);
    wgpuQueueWriteBuffer(queue_, buffer, offset, padded.data(), padded.size());
}

void WebGPUDevice::backendDeleteBuffer(u32 id) {
    auto it = buffers_.find(id);
    if (it == buffers_.end()) return;
    if (it->second.buffer) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(it->second.buffer)));
        wgpuBufferRelease(it->second.buffer);
    }
    buffers_.erase(it);
}

void WebGPUDevice::evictBindGroups(u64 id) {
    for (auto it = bind_group_cache_.begin(); it != bind_group_cache_.end();) {
        auto& bucket = it->second;
        for (usize i = bucket.size(); i-- > 0;) {
            auto& e = bucket[i];
            bool hit = false;
            for (u64 v : e.ids) {
                if (v == id) { hit = true; break; }
            }
            if (!hit) continue;
            if (e.bg == bind_group_) bind_group_ = nullptr;
            if (e.bg == texture_group_) texture_group_ = nullptr;
            if (e.bg) wgpuBindGroupRelease(e.bg);
            bucket.erase(bucket.begin() + static_cast<std::ptrdiff_t>(i));
            --bind_group_count_;
            bind_group_dirty_ = true;
        }
        it = bucket.empty() ? bind_group_cache_.erase(it) : std::next(it);
    }
}

void WebGPUDevice::backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) {
    auto it = buffers_.find(id);
    if (it == buffers_.end() || !it->second.buffer || !data || sizeBytes == 0) return;
    if (!webgpu::writeFitsInBuffer(offsetBytes, sizeBytes, it->second.size)) {
        ES_LOG_ERROR("WebGPUDevice::updateBuffer: range {}+{} exceeds buffer size {}",
                     offsetBytes, sizeBytes, it->second.size);
        return;
    }
    // GL takes any offset and size; WriteBuffer takes 4-byte multiples of both.
    if ((offsetBytes & 3u) != 0) {
        ES_LOG_ERROR("WebGPUDevice::updateBuffer: offset {} is not 4-byte aligned", offsetBytes);
        return;
    }
    // Only a write ending at the logical end may pad, into the slack the rounded
    // allocation has. One ending mid-buffer would clobber the next field.
    if (webgpu::needsWriteStaging(sizeBytes) && offsetBytes + sizeBytes != it->second.size) {
        ES_LOG_ERROR("WebGPUDevice::updateBuffer: unaligned partial write {}+{} of {}",
                     offsetBytes, sizeBytes, it->second.size);
        return;
    }
    writeBufferPadded(it->second.buffer, offsetBytes, data, sizeBytes);
}

void WebGPUDevice::backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) {
    auto it = buffers_.find(id);
    if (it == buffers_.end()) return;

    // WebGPU buffers are fixed-size, so the store is re-created behind the same id.
    // A cached bind group names the old WGPUBuffer, not the id, and would keep
    // drawing its bytes.
    if (it->second.buffer) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(it->second.buffer)));
        wgpuBufferRelease(it->second.buffer);
    }
    bind_group_dirty_ = true;
    it->second.buffer = makeBuffer(desc.usage, desc.size, data);
    it->second.size = desc.size;
}

void WebGPUDevice::backendSetUniformBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes, u32 sizeBytes) {
    if (slot >= kUniformSlots) return;
    const u32 id = static_cast<u32>(buffer);
    if (uniform_slots_[slot] != id || uniform_offsets_[slot] != offsetBytes ||
        uniform_sizes_[slot] != sizeBytes) {
        uniform_slots_[slot] = id;
        uniform_offsets_[slot] = offsetBytes;
        uniform_sizes_[slot] = sizeBytes;
        bind_group_dirty_ = true;
    }
}

// =============================================================================
// Vertex layouts (descriptors retained; pipelines consume them at build time)
// =============================================================================

bool WebGPUDevice::backendAcceptsVertexLayout(const VertexLayoutDesc& desc) {
    // Every attribute needs a WebGPU spelling — a mismatch is an engine bug, not a
    // runtime condition, so it is refused where the layout is declared.
    for (u32 i = 0; i < desc.attributeCount; ++i) {
        const auto& a = desc.attributes[i];
        if (toWGPUVertexFormat(a.components, a.type, a.normalized) == kInvalidVertexFormat) {
            ES_LOG_ERROR("WebGPUDevice::createVertexLayout: attribute {} ({} x type {}) has no WGPU format",
                         i, a.components, static_cast<u32>(a.type));
            return false;
        }
    }
    return true;
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

// =============================================================================
// Textures
// =============================================================================

u32 WebGPUDevice::colorVariantOf(WGPUTextureFormat format) {
    switch (format) {
    case WGPUTextureFormat_RGBA8UnormSrgb: return kColorSrgb8;
    case WGPUTextureFormat_RGBA16Float:    return kColorRgba16f;
    case WGPUTextureFormat_RGBA32Float:    return kColorRgba32f;
    case WGPUTextureFormat_BGRA8Unorm:     return kColorBgra8;
    default:                               return kColorRgba8;
    }
}

bool WebGPUDevice::makeTexture(const TextureDesc& desc, const void* pixels, TextureRec& out) {
    if (!device_) {
        ES_LOG_ERROR("WebGPUDevice: no device to create a texture on");
        return false;
    }

    const u32 layers = desc.layers > 1 ? desc.layers : 1;
    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.format = toWGPUTextureFormat(desc.format);
    td.size = WGPUExtent3D{desc.width, desc.height, layers};
    td.sampleCount = desc.samples > 1 ? kMsaaSamples : 1;
    td.mipLevelCount = 1;
    if (desc.mipmaps && td.sampleCount == 1 && !isDepthFormat(td.format)) {
        for (u32 side = std::max(desc.width, desc.height); side > 1; side >>= 1) ++td.mipLevelCount;
    }
    // Depth-stencil takes no upload and no readback (writeTexture cannot fill
    // it, CopySrc is refused on depth24plus) but IS sampled: an effect reads the
    // scene's depth. Colour carries CopySrc for the async readback seam.
    td.usage = isDepthFormat(td.format)
                   ? (WGPUTextureUsage_TextureBinding | WGPUTextureUsage_RenderAttachment)
                   : (WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst |
                      WGPUTextureUsage_CopySrc | WGPUTextureUsage_RenderAttachment);
    // A compute target is also written by shaders. Only these formats have the capability in core WebGPU,
    // and one that does not is created plain rather than refused: the record says what it got.
    const bool storage = desc.storage && td.sampleCount == 1 &&
                         (td.format == WGPUTextureFormat_RGBA8Unorm || td.format == WGPUTextureFormat_RGBA16Float ||
                          td.format == WGPUTextureFormat_RGBA32Float);
    if (storage) td.usage |= WGPUTextureUsage_StorageBinding;
    // No copies: invalid on a multisampled texture. Depth keeps TextureBinding
    // because resolveDepthAttachment samples it; colour is read through the
    // single-sample twin the pass resolves into.
    if (td.sampleCount > 1) {
        td.usage = isDepthFormat(td.format)
                       ? (WGPUTextureUsage_RenderAttachment | WGPUTextureUsage_TextureBinding)
                       : WGPUTextureUsage_RenderAttachment;
    }

    WGPUTexture texture = wgpuDeviceCreateTexture(device_, &td);
    if (!texture) {
        ES_LOG_ERROR("WebGPUDevice: texture creation failed ({}x{})", desc.width, desc.height);
        return false;
    }

    WGPUTextureView view = nullptr;
    if (layers > 1) {
        // Never an attachment, so the one view is the sampled one: every layer, every level.
        WGPUTextureViewDescriptor vd{};
        vd.format = td.format;
        vd.dimension = WGPUTextureViewDimension_2DArray;
        vd.mipLevelCount = td.mipLevelCount;
        vd.arrayLayerCount = layers;
        vd.aspect = WGPUTextureAspect_All;
        view = wgpuTextureCreateView(texture, &vd);
    } else if (td.mipLevelCount > 1) {
        WGPUTextureViewDescriptor vd{};
        vd.format = td.format;
        vd.dimension = WGPUTextureViewDimension_2D;
        vd.mipLevelCount = 1;
        vd.arrayLayerCount = 1;
        vd.aspect = WGPUTextureAspect_All;
        view = wgpuTextureCreateView(texture, &vd);
    } else {
        view = wgpuTextureCreateView(texture, nullptr);
    }
    // A depth-stencil texture has two aspects and a sample may name only one, so
    // the view a binding uses is depth-only. Every other format samples through
    // the view it already has — the two members alias, and cleanup knows it.
    WGPUTextureView sampleView = view;
    if (isDepthFormat(td.format)) {
        WGPUTextureViewDescriptor vd{};
        // The ASPECT's format, not the texture's: a depth-only view of a
        // depth24plus-stencil8 texture is a depth24plus view, and asking for it
        // under the combined format is rejected as incompatible.
        vd.format = td.format == WGPUTextureFormat_Depth24PlusStencil8
                        ? WGPUTextureFormat_Depth24Plus
                        : td.format;
        vd.dimension = WGPUTextureViewDimension_2D;
        vd.mipLevelCount = 1;
        vd.arrayLayerCount = 1;
        vd.aspect = WGPUTextureAspect_DepthOnly;
        sampleView = wgpuTextureCreateView(texture, &vd);
    } else if (td.mipLevelCount > 1 && layers == 1) {
        sampleView = wgpuTextureCreateView(texture, nullptr);
    }

    out = TextureRec{texture, view, sampleView,
                     desc.width, desc.height, td.format, desc.format,
                     packSamplerKey(desc.minFilter, desc.magFilter, desc.wrapS, desc.wrapT),
                     td.sampleCount, td.mipLevelCount};
    out.storage = storage;
    out.layers = layers;

    if (pixels && !isDepthFormat(td.format) && layers > 1) {
        // An array takes its layers in the rows given, as GL does (which cannot flip a 3D upload).
        const usize layerBytes = static_cast<usize>(desc.width) * desc.height * gfxBytesPerPixel(desc.format);
        for (u32 layer = 0; layer < layers; ++layer) {
            writeTexture(out, 0, 0, desc.width, desc.height,
                         static_cast<const u8*>(pixels) + layerBytes * layer, false, layer);
        }
        if (out.mipLevels > 1) buildMipChain(out);
    } else if (pixels && !isDepthFormat(td.format)) {
        // desc.flipY, not false: the caller's orientation request has to reach the
        // upload, which is where the row reversal happens (see writeTexture).
        writeTexture(out, 0, 0, desc.width, desc.height, pixels, desc.flipY);
        if (out.mipLevels > 1) buildMipChain(out);
    }
    return true;
}

bool WebGPUDevice::backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) {
    TextureRec rec;
    if (!makeTexture(desc, pixels, rec)) return false;
    textures_[id] = rec;
    return true;
}

bool WebGPUDevice::backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                                  const void* data, u32 byteLength, u32 mipLevels) {
    if (!device_ || !queue_) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: no device");
        return false;
    }
    const WGPUTextureFormat wgpuFmt = toWGPUCompressedFormat(format);
    if (wgpuFmt == WGPUTextureFormat_Undefined) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: unmapped format");
        return false;
    }
    const u32 levels = mipLevels ? mipLevels : 1;

    WGPUTextureDescriptor td{};
    td.dimension = WGPUTextureDimension_2D;
    td.format = wgpuFmt;
    td.size = WGPUExtent3D{desc.width, desc.height, 1};
    td.mipLevelCount = levels;
    td.sampleCount = 1;
    td.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;   // compressed = sampled, never a target

    WGPUTexture texture = wgpuDeviceCreateTexture(device_, &td);
    if (!texture) {
        ES_LOG_ERROR("WebGPUDevice::createCompressedTexture: creation failed ({}x{})", desc.width, desc.height);
        return false;
    }

    // Upload each mip level from the concatenated pyramid. writeTexture counts
    // BLOCKS, not pixels (a partial edge block still counts a whole block).
    const GfxBlockInfo bi = gfxCompressedBlockInfo(format);
    const u8* ptr = static_cast<const u8*>(data);
    const u8* end = ptr + byteLength;
    for (u32 level = 0; ptr && level < levels; ++level) {
        const u32 lw = (desc.width >> level) ? (desc.width >> level) : 1u;
        const u32 lh = (desc.height >> level) ? (desc.height >> level) : 1u;
        const u32 blocksX = (lw + bi.blockWidth - 1) / bi.blockWidth;
        const u32 blocksY = (lh + bi.blockHeight - 1) / bi.blockHeight;
        const u32 levelBytes = blocksX * blocksY * bi.bytesPerBlock;
        if (levelBytes > static_cast<usize>(end - ptr)) break;   // truncated pyramid
        WGPUTexelCopyTextureInfo dst{};
        dst.texture = texture;
        dst.mipLevel = level;
        dst.origin = WGPUOrigin3D{0, 0, 0};
        WGPUTexelCopyBufferLayout layout{};
        layout.bytesPerRow = blocksX * bi.bytesPerBlock;
        layout.rowsPerImage = blocksY;
        // The level's physical size, whole blocks: a level 634 texels tall is stored as 636, and a copy must name whole blocks. Its last
        // block row holds texels past the edge, which the sampler never reads.
        WGPUExtent3D extent{blocksX * bi.blockWidth, blocksY * bi.blockHeight, 1};
        wgpuQueueWriteTexture(queue_, &dst, ptr, levelBytes, &layout, &extent);
        ptr += levelBytes;
    }

    // A compressed texture is never a depth one, so it samples through the view
    // it already has — the two members alias, as they do for any colour format.
    WGPUTextureView view = wgpuTextureCreateView(texture, nullptr);
    textures_[id] = TextureRec{texture, view, view,
                               desc.width, desc.height, wgpuFmt, desc.format,
                               packSamplerKey(desc.minFilter, desc.magFilter,
                                              desc.wrapS, desc.wrapT)};
    return true;
}

void WebGPUDevice::releaseTexture(TextureRec& rec) {
    // The sample view first, and only when it is a view of its own: for a colour
    // texture it aliases `view`, and releasing that twice frees a live object.
    if (rec.sampleView && rec.sampleView != rec.view) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(rec.sampleView)));
        wgpuTextureViewRelease(rec.sampleView);
    }
    if (rec.view) {
        evictBindGroups(static_cast<u64>(reinterpret_cast<uintptr_t>(rec.view)));
        wgpuTextureViewRelease(rec.view);
    }
    if (rec.texture) wgpuTextureRelease(rec.texture);
    rec = TextureRec{};
}

void WebGPUDevice::backendDeleteTexture(u32 id) {
    auto it = textures_.find(id);
    if (it == textures_.end()) return;
    releaseTexture(it->second);
    textures_.erase(it);
}

void WebGPUDevice::backendMoveTexture(u32 into, u32 from) {
    auto it = textures_.find(from);
    if (it == textures_.end()) return;
    textures_[into] = it->second;
    textures_.erase(from);
    for (u32 slot = 0; slot < kTextureSlots; ++slot) {
        if (texture_slots_[slot] == into || texture_slots_[slot] == from) bind_group_dirty_ = true;
    }
}

void WebGPUDevice::backendUpdateTexture(u32 id, i32 x, i32 y, u32 width, u32 height,
                                        const void* pixels, bool flipY) {
    auto it = textures_.find(id);
    if (it == textures_.end()) return;
    writeTexture(it->second, x, y, width, height, pixels, flipY);
}

void WebGPUDevice::writeTexture(const TextureRec& rec, i32 x, i32 y, u32 width, u32 height,
                                const void* pixels, bool flipY, u32 layer) {
    if (!pixels || !queue_ || !rec.texture) return;
    if (isDepthFormat(rec.format)) {
        ES_LOG_ERROR("WebGPUDevice::updateTexture: depth-stencil textures are attachment-only");
        return;
    }
    WGPUTexelCopyTextureInfo dst{};
    dst.texture = rec.texture;
    dst.origin = WGPUOrigin3D{static_cast<u32>(x), static_cast<u32>(y), layer};

    // Source rows are what the caller allocated; destination rows are the texel
    // size WebGPU stores. They differ for RGB8, which has no WebGPU format and so
    // lands in an RGBA8 texture — reading dstRow from the source is the over-read.
    const u32 srcBpp = gfxBytesPerPixel(rec.srcFormat);
    const u32 dstBpp = wgpuBytesPerPixel(rec.srcFormat);
    const usize dstRow = static_cast<usize>(width) * dstBpp;

    WGPUTexelCopyBufferLayout layout{};
    layout.bytesPerRow = static_cast<u32>(dstRow);
    layout.rowsPerImage = height;

    // Decoded images arrive top-first while the engine samples v upward. GL flips
    // with UNPACK_FLIP_Y_WEBGL; WebGPU has no pixel-store parameter, so rows are
    // reversed here — the same bytes GL sends, which is what keeps the two equal.
    const bool reverseRows = flipY && height > 1;
    std::vector<u8> staged;
    const void* src = pixels;
    if (reverseRows || srcBpp != dstBpp) {
        staged.resize(dstRow * height);
        stageTextureRows(staged.data(), static_cast<const u8*>(pixels),
                         width, height, srcBpp, dstBpp, reverseRows);
        src = staged.data();
    }

    WGPUExtent3D extent{width, height, 1};
    wgpuQueueWriteTexture(queue_, &dst, src, dstRow * height, &layout, &extent);
}

void WebGPUDevice::backendSetTextureParams(u32 id, const TextureDesc& desc) {
    // GL's texture-object sampler state, de-combined: the texture record carries
    // its params key and the bind group pairs it with a cached sampler object.
    auto it = textures_.find(id);
    if (it == textures_.end()) return;
    const u8 key = packSamplerKey(desc.minFilter, desc.magFilter, desc.wrapS, desc.wrapT);
    if (it->second.samplerKey == key) return;
    it->second.samplerKey = key;
    for (u32 slot = 0; slot < kTextureSlots; ++slot) {
        if (texture_slots_[slot] == id) {
            bind_group_dirty_ = true;
            break;
        }
    }
}

void WebGPUDevice::backendGenerateMipmaps(u32 id) {
    auto it = textures_.find(id);
    if (it != textures_.end() && it->second.mipLevels > 1) buildMipChain(it->second);
}

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
    if (!device_) return false;
    // The DEVICE, not the adapter: a format the adapter offers is unusable until
    // the device was created asking for its feature, and createTexture rejects it
    // — which arrives as a texture that never loaded rather than as this answer.
    return wgpuDeviceHasFeature(device_, compressionFeatureFor(format)) != 0;
}

// =============================================================================
// Programs (WGSL shader modules)
// =============================================================================

bool WebGPUDevice::backendCreateProgram(u32 id, const GfxShaderSource& source,
                                        const GfxAttribBinding*, u32,
                                        std::string* outLog, GfxShaderStage* outFailedStage) {
    if (source.language != GfxShaderLanguage::WGSL) {
        if (outLog) *outLog = "WebGPUDevice compiles WGSL only";
        if (outFailedStage) *outFailedStage = GfxShaderStage::Vertex;
        ES_LOG_ERROR("WebGPUDevice::createProgram: unsupported shader language");
        return false;
    }
    if (!device_) {
        if (outLog) *outLog = "no WGPUDevice";
        ES_LOG_ERROR("WebGPUDevice::createProgram: no device");
        return false;
    }

    // A stage that names `tN`/`sN` without declaring it cannot compile, and WebGPU says
    // so as an invalid PIPELINE naming no shader — so the refusal is here, where the
    // source is still in hand. check-wgsl-twin holds the repo's own to the same rule.
    const auto undeclared = [&](const char* src, const char* stage) -> bool {
        u32 reachedTex = 0;
        u32 reachedSam = 0;
        scanWGSLReachedUnits(src, reachedTex, reachedSam);
        const u32 declared = scanWGSLBindingMask(src, 1);
        for (u32 unit = 0; unit < 16; ++unit) {
            const bool tex = (reachedTex & (1u << unit)) != 0
                             && (declared & (1u << textureBindingForUnit(unit))) == 0;
            const bool sam = (reachedSam & (1u << unit)) != 0
                             && (declared & (1u << samplerBindingForUnit(unit))) == 0;
            if (!tex && !sam) continue;
            if (outLog) {
                *outLog = std::string("the ") + stage + " stage reaches "
                        + (tex ? "t" : "s") + std::to_string(unit) + " and declares no binding for it";
            }
            ES_LOG_ERROR("WebGPUDevice::createProgram: the {} stage reaches {}{} and declares "
                         "no binding for it", stage, tex ? "t" : "s", unit);
            return true;
        }
        return false;
    };
    if (undeclared(source.vertexSrc, "vertex")) {
        if (outFailedStage) *outFailedStage = GfxShaderStage::Vertex;
        return false;
    }
    if (undeclared(source.fragmentSrc, "fragment")) {
        if (outFailedStage) *outFailedStage = GfxShaderStage::Fragment;
        return false;
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
    rec.group1DepthMask = scanWGSLDepthTextureMask(source.vertexSrc, 1) |
                          scanWGSLDepthTextureMask(source.fragmentSrc, 1);
    rec.group1ArrayMask = scanWGSLArrayTextureMask(source.vertexSrc, 1) |
                          scanWGSLArrayTextureMask(source.fragmentSrc, 1);
    // What the VERTEX stage declares, on its own: a sampled texture is visible
    // to the fragment stage alone unless the layout says otherwise, and reading
    // one it was not given is a pipeline WebGPU rejects with nothing named.
    rec.group1VertexMask = scanWGSLBindingMask(source.vertexSrc, 1);
    if (!rec.vertex || !rec.fragment) {
        if (rec.vertex) wgpuShaderModuleRelease(rec.vertex);
        if (rec.fragment) wgpuShaderModuleRelease(rec.fragment);
        if (outLog) *outLog = "shader module creation failed";
        if (outFailedStage) *outFailedStage = rec.vertex ? GfxShaderStage::Fragment : GfxShaderStage::Vertex;
        return false;
    }

    programs_[id] = rec;
    return true;
}

void WebGPUDevice::backendDeleteProgram(u32 id) {
    auto it = programs_.find(id);
    if (it == programs_.end()) return;
    if (it->second.vertex) wgpuShaderModuleRelease(it->second.vertex);
    if (it->second.fragment) wgpuShaderModuleRelease(it->second.fragment);
    programs_.erase(it);
}

// =============================================================================
// Pipelines (descriptors retained; WGPURenderPipeline built lazily per pass
// depth-stencil shape — WebGPU validates that coupling, GL never had it)
// =============================================================================

WGPURenderPipeline WebGPUDevice::ensurePipeline(u32 id) {
    const PipelineDesc* described = pipelineDesc(PipelineHandle{id});
    if (!described || !device_) return nullptr;
    PipelineRec& built = pipelines_[id];
    const u32 dsVariant = dsVariantOf(pass_ds_format_);
    const PipelineDesc& desc = *described;
    const bool writesAlbedo = pass_albedo_ && desc.gbuffer && desc.albedo;
    const u32 gbufferVariant = !pass_gbuffer_ ? kGBufferNone
                              : writesAlbedo ? kGBufferWritesAlbedo
                              : desc.gbuffer ? kGBufferWrites : kGBufferSkips;
    const u32 variant = ((dsVariant * kColorVariantCount + colorVariantOf(pass_color_format_))
                         * kSampleVariantCount + (pass_samples_ > 1 ? kMultiSample : kSingleSample))
                        * kGBufferVariantCount + gbufferVariant;
    if (built.variants[variant]) return built.variants[variant];

    auto progIt = programs_.find(static_cast<u32>(desc.program));
    const VertexLayoutDesc* layout = vertexLayoutDesc(desc.vertexLayout);
    if (progIt == programs_.end() || !layout) {
        ES_LOG_ERROR("WebGPUDevice::ensurePipeline: missing program or layout");
        return nullptr;
    }
    const VertexLayoutDesc& vl = *layout;

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

    WGPUColorTargetState targets[3]{};
    targets[0].format = pass_color_format_;
    targets[0].blend = desc.blendEnabled ? &blendState : nullptr;
    targets[0].writeMask = (writesStencil(desc.stencil) || !desc.colorWrite) ? WGPUColorWriteMask_None
                                                                              : WGPUColorWriteMask_All;
    // The second attachment, when the pass has one: written by a shader that has the output, and
    // declared with an empty write mask by every other — WebGPU asks the pipeline to account for
    // every attachment of the pass, and a shader with one output may not be given a mask that
    // would write the second. Never blended: a normal averaged with what was there is neither's.
    targets[1].format = WGPUTextureFormat_RGBA8Unorm;
    targets[1].writeMask = (desc.gbuffer && desc.colorWrite && !writesStencil(desc.stencil)) ? WGPUColorWriteMask_All
                                                                         : WGPUColorWriteMask_None;
    // The third, the albedo, the same way: written only by a shader that has a location-2 output.
    targets[2].format = WGPUTextureFormat_RGBA8Unorm;
    targets[2].writeMask = (writesAlbedo && desc.colorWrite && !writesStencil(desc.stencil)) ? WGPUColorWriteMask_All
                                                                                         : WGPUColorWriteMask_None;

    WGPUFragmentState fragment{};
    fragment.module = progIt->second.fragment;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = !pass_gbuffer_ ? 1 : pass_albedo_ ? 3 : 2;
    fragment.targets = targets;

    WGPURenderPipelineDescriptor pd{};
    // Explicit layout from the program's binding masks — the same cached
    // objects flushBindGroup builds bind groups against, so declared-but-
    // unbound bindings are legal (dummy backfill) and group compatibility
    // holds by identity.
    pd.layout = pipelineLayoutFor(progIt->second.group0Mask, progIt->second.group1Mask,
                                  progIt->second.group1DepthMask,
                                  progIt->second.group1VertexMask,
                                  progIt->second.group1ArrayMask);
    pd.vertex.module = progIt->second.vertex;
    pd.vertex.entryPoint = sv("vs_main");
    pd.vertex.bufferCount = slotCount;
    pd.vertex.buffers = slots;
    pd.primitive.topology = desc.topology == GfxTopology::Lines ? WGPUPrimitiveTopology_LineList
                                                                : WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = toWGPUCullMode(desc.cullEnabled, desc.cullFront);
    // The pass's count, which WebGPU validates against the attachment: a pipeline
    // built for one sample cannot draw into a multisampled target at all.
    pd.multisample.count = pass_samples_;
    pd.multisample.mask = 0xFFFFFFFFu;
    // WebGPU refuses coverage from alpha on a single-sampled pipeline.
    pd.multisample.alphaToCoverageEnabled = desc.alphaToCoverage && pass_samples_ > 1;
    pd.fragment = &fragment;
    WGPUDepthStencilState ds{};
    if (dsVariant != kDsNone) {
        ds = toWGPUDepthStencil(desc, pass_ds_format_);
        pd.depthStencil = &ds;
    } else if (desc.depthTest || desc.stencil != GfxStencilMode::Off) {
        ES_LOG_WARN("WebGPUDevice::ensurePipeline: depth/stencil requested but the "
                    "pass target has no depth-stencil attachment");
    }

    built.variants[variant] = wgpuDeviceCreateRenderPipeline(device_, &pd);
    if (!built.variants[variant]) {
        ES_LOG_ERROR("WebGPUDevice::ensurePipeline: creation failed");
    }
    return built.variants[variant];
}

void WebGPUDevice::backendSetPipeline(u32 id, const PipelineDesc&) {
    bound_pipeline_ = id;
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
    // Trilinear across mips when a texture has them (compressed KTX2 pyramids);
    // with a single mip WebGPU samples level 0 unchanged, so this is harmless for
    // the still-common single-mip textures.
    sd.mipmapFilter = WGPUMipmapFilterMode_Linear;
    sd.lodMinClamp = 0.0f;
    sd.lodMaxClamp = 32.0f;
    // Sharpened at a slant (a floor, a hair card, a sleeve seen edge-on): the sampler takes extra samples along the footprint's long side.
    // WebGPU allows it only when every filter is linear, so a nearest-filtered sampler stays at one.
    sd.maxAnisotropy = (key & 3u) == 0u ? 16 : 1;
    WGPUSampler sampler = wgpuDeviceCreateSampler(device_, &sd);
    samplers_[key] = sampler;
    return sampler;
}

// =============================================================================
// Depth resolve — the half WebGPU does not do: a depth attachment has no
// resolveTarget, so a fullscreen pass writes sample 0 into the single-sample
// twin. Stencil does not come along; a shader cannot write it.
// =============================================================================

WGPURenderPipeline WebGPUDevice::ensureDepthResolvePipeline(WGPUTextureFormat format) {
    const u32 key = static_cast<u32>(format);
    auto it = depth_resolve_pipelines_.find(key);
    if (it != depth_resolve_pipelines_.end()) return it->second;
    if (!device_) return nullptr;

    static const char* kVS = R"(
@vertex fn vs_main(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
    return vec4f(p[i], 0.0, 1.0);
}
)";
    static const char* kFS = R"(
@group(0) @binding(0) var src : texture_depth_multisampled_2d;
@fragment fn fs_main(@builtin(position) pos : vec4f) -> @builtin(frag_depth) f32 {
    return textureLoad(src, vec2i(i32(pos.x), i32(pos.y)), 0);
}
)";
    auto makeModule = [&](const char* code) {
        WGPUShaderSourceWGSL wgsl{};
        wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
        wgsl.code = sv(code);
        WGPUShaderModuleDescriptor md{};
        md.nextInChain = &wgsl.chain;
        return wgpuDeviceCreateShaderModule(device_, &md);
    };
    if (!depth_resolve_vs_) depth_resolve_vs_ = makeModule(kVS);
    if (!depth_resolve_fs_) depth_resolve_fs_ = makeModule(kFS);
    if (!depth_resolve_bgl_) {
        WGPUBindGroupLayoutEntry ble{};
        ble.binding = 0;
        ble.visibility = WGPUShaderStage_Fragment;
        ble.texture.sampleType = WGPUTextureSampleType_Depth;
        ble.texture.viewDimension = WGPUTextureViewDimension_2D;
        ble.texture.multisampled = true;
        WGPUBindGroupLayoutDescriptor bld{};
        bld.entryCount = 1;
        bld.entries = &ble;
        depth_resolve_bgl_ = wgpuDeviceCreateBindGroupLayout(device_, &bld);
        WGPUPipelineLayoutDescriptor pld{};
        pld.bindGroupLayoutCount = 1;
        pld.bindGroupLayouts = &depth_resolve_bgl_;
        depth_resolve_layout_ = wgpuDeviceCreatePipelineLayout(device_, &pld);
    }

    WGPURenderPipelineDescriptor pd{};
    pd.layout = depth_resolve_layout_;
    pd.vertex.module = depth_resolve_vs_;
    pd.vertex.entryPoint = sv("vs_main");
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = WGPUCullMode_None;
    pd.multisample.count = 1;
    pd.multisample.mask = 0xFFFFFFFFu;
    // No colour target: the pass writes depth and nothing else.
    WGPUFragmentState fragment{};
    fragment.module = depth_resolve_fs_;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 0;
    pd.fragment = &fragment;
    WGPUDepthStencilState ds{};
    ds.format = format;
    ds.depthWriteEnabled = WGPUOptionalBool_True;
    ds.depthCompare = WGPUCompareFunction_Always;
    WGPUStencilFaceState face{};
    face.compare = WGPUCompareFunction_Always;
    face.failOp = WGPUStencilOperation_Keep;
    face.depthFailOp = WGPUStencilOperation_Keep;
    face.passOp = WGPUStencilOperation_Keep;
    ds.stencilFront = face;
    ds.stencilBack = face;
    ds.stencilReadMask = 0xFFFFFFFFu;
    ds.stencilWriteMask = 0u;
    pd.depthStencil = &ds;

    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device_, &pd);
    if (!pipeline) ES_LOG_ERROR("WebGPUDevice: depth resolve pipeline creation failed");
    depth_resolve_pipelines_[key] = pipeline;
    return pipeline;
}

WGPURenderPipeline WebGPUDevice::ensureMipPipeline(WGPUTextureFormat format) {
    const u32 key = static_cast<u32>(format);
    auto it = mip_pipelines_.find(key);
    if (it != mip_pipelines_.end()) return it->second;
    if (!device_) return nullptr;

    // The triangle's uv runs down the target as its rows do, so a level keeps the
    // orientation of the one it is made from.
    static const char* kWGSL = R"(
struct VSOut { @builtin(position) pos : vec4f, @location(0) uv : vec2f };
@vertex fn vs_main(@builtin(vertex_index) i : u32) -> VSOut {
    var p = array<vec2f, 3>(vec2f(-1.0, 1.0), vec2f(3.0, 1.0), vec2f(-1.0, -3.0));
    var out : VSOut;
    out.pos = vec4f(p[i], 0.0, 1.0);
    out.uv = vec2f(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
    return out;
}
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var smp : sampler;
@fragment fn fs_main(v : VSOut) -> @location(0) vec4f {
    return textureSampleLevel(src, smp, v.uv, 0.0);
}
)";
    if (!mip_module_) {
        WGPUShaderSourceWGSL wgsl{};
        wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
        wgsl.code = sv(kWGSL);
        WGPUShaderModuleDescriptor md{};
        md.nextInChain = &wgsl.chain;
        mip_module_ = wgpuDeviceCreateShaderModule(device_, &md);
    }
    if (!mip_bgl_) {
        WGPUBindGroupLayoutEntry entries[2]{};
        entries[0].binding = 0;
        entries[0].visibility = WGPUShaderStage_Fragment;
        entries[0].texture.sampleType = WGPUTextureSampleType_Float;
        entries[0].texture.viewDimension = WGPUTextureViewDimension_2D;
        entries[1].binding = 1;
        entries[1].visibility = WGPUShaderStage_Fragment;
        entries[1].sampler.type = WGPUSamplerBindingType_Filtering;
        WGPUBindGroupLayoutDescriptor bld{};
        bld.entryCount = 2;
        bld.entries = entries;
        mip_bgl_ = wgpuDeviceCreateBindGroupLayout(device_, &bld);
        WGPUPipelineLayoutDescriptor pld{};
        pld.bindGroupLayoutCount = 1;
        pld.bindGroupLayouts = &mip_bgl_;
        mip_layout_ = wgpuDeviceCreatePipelineLayout(device_, &pld);
        WGPUSamplerDescriptor sd{};
        sd.minFilter = WGPUFilterMode_Linear;
        sd.magFilter = WGPUFilterMode_Linear;
        sd.mipmapFilter = WGPUMipmapFilterMode_Nearest;
        sd.addressModeU = WGPUAddressMode_ClampToEdge;
        sd.addressModeV = WGPUAddressMode_ClampToEdge;
        sd.addressModeW = WGPUAddressMode_ClampToEdge;
        sd.lodMaxClamp = 32.0f;
        sd.maxAnisotropy = 1;
        mip_sampler_ = wgpuDeviceCreateSampler(device_, &sd);
    }

    WGPURenderPipelineDescriptor pd{};
    pd.layout = mip_layout_;
    pd.vertex.module = mip_module_;
    pd.vertex.entryPoint = sv("vs_main");
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = WGPUCullMode_None;
    pd.multisample.count = 1;
    pd.multisample.mask = 0xFFFFFFFFu;
    WGPUColorTargetState target{};
    target.format = format;
    target.writeMask = WGPUColorWriteMask_All;
    WGPUFragmentState fragment{};
    fragment.module = mip_module_;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;
    pd.fragment = &fragment;

    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device_, &pd);
    if (!pipeline) ES_LOG_ERROR("WebGPUDevice: mip pipeline creation failed");
    mip_pipelines_[key] = pipeline;
    return pipeline;
}

void WebGPUDevice::buildMipChain(const TextureRec& rec) {
    if (!device_ || !queue_ || rec.mipLevels < 2) return;
    WGPURenderPipeline pipeline = ensureMipPipeline(rec.format);
    if (!pipeline) return;

    // Its own encoder, submitted at once: an upload can land in the middle of a
    // frame, and the frame's encoder may have a pass open.
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    if (!encoder) return;
    // Each layer of an array is its own chain: views[layer * mipLevels + level] is one level of one layer.
    std::vector<WGPUTextureView> views;
    std::vector<WGPUBindGroup> groups;
    for (u32 layer = 0; layer < rec.layers; ++layer) {
        for (u32 level = 0; level < rec.mipLevels; ++level) {
            WGPUTextureViewDescriptor vd{};
            vd.format = rec.format;
            vd.dimension = WGPUTextureViewDimension_2D;
            vd.baseMipLevel = level;
            vd.mipLevelCount = 1;
            vd.baseArrayLayer = layer;
            vd.arrayLayerCount = 1;
            vd.aspect = WGPUTextureAspect_All;
            views.push_back(wgpuTextureCreateView(rec.texture, &vd));
        }
    }
    for (u32 step = 0; step < rec.layers * rec.mipLevels; ++step) {
        const u32 level = step % rec.mipLevels;
        if (level == 0) continue;
        WGPUBindGroupEntry entries[2]{};
        entries[0].binding = 0;
        entries[0].textureView = views[step - 1];
        entries[1].binding = 1;
        entries[1].sampler = mip_sampler_;
        WGPUBindGroupDescriptor bgd{};
        bgd.layout = mip_bgl_;
        bgd.entryCount = 2;
        bgd.entries = entries;
        WGPUBindGroup group = wgpuDeviceCreateBindGroup(device_, &bgd);
        if (!group) break;
        groups.push_back(group);

        WGPURenderPassColorAttachment color{};
        color.view = views[step];
        color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
        color.loadOp = WGPULoadOp_Clear;
        color.storeOp = WGPUStoreOp_Store;
        WGPURenderPassDescriptor rp{};
        rp.colorAttachmentCount = 1;
        rp.colorAttachments = &color;
        WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &rp);
        if (!pass) break;
        wgpuRenderPassEncoderSetPipeline(pass, pipeline);
        wgpuRenderPassEncoderSetBindGroup(pass, 0, group, 0, nullptr);
        wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
        wgpuRenderPassEncoderEnd(pass);
        wgpuRenderPassEncoderRelease(pass);
    }
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    if (commands) {
        wgpuQueueSubmit(queue_, 1, &commands);
        wgpuCommandBufferRelease(commands);
    }
    wgpuCommandEncoderRelease(encoder);
    for (WGPUBindGroup group : groups) wgpuBindGroupRelease(group);
    for (WGPUTextureView view : views) wgpuTextureViewRelease(view);
}

void WebGPUDevice::resolveDepthAttachment(u32 msaaDepth, u32 resolveDepth) {
    if (!device_ || !encoder_) return;
    auto srcIt = textures_.find(msaaDepth);
    auto dstIt = textures_.find(resolveDepth);
    if (srcIt == textures_.end() || dstIt == textures_.end()) return;
    WGPURenderPipeline pipeline = ensureDepthResolvePipeline(dstIt->second.format);
    if (!pipeline) return;

    // The MULTISAMPLED view, not the depth-only sample view: a multisampled depth
    // texture is read through `texture_depth_multisampled_2d`, whose view carries
    // every aspect the texture has.
    WGPUBindGroupEntry entry{};
    entry.binding = 0;
    entry.textureView = srcIt->second.sampleView;
    WGPUBindGroupDescriptor bgd{};
    bgd.layout = depth_resolve_bgl_;
    bgd.entryCount = 1;
    bgd.entries = &entry;
    WGPUBindGroup group = wgpuDeviceCreateBindGroup(device_, &bgd);
    if (!group) return;

    WGPURenderPassDepthStencilAttachment ds{};
    ds.view = dstIt->second.view;
    ds.depthLoadOp = WGPULoadOp_Clear;
    ds.depthStoreOp = WGPUStoreOp_Store;
    ds.depthClearValue = 1.0f;
    if (hasStencilPlanes(dstIt->second.format)) {
        ds.stencilLoadOp = WGPULoadOp_Clear;
        ds.stencilStoreOp = WGPUStoreOp_Store;
    }
    WGPURenderPassDescriptor rp{};
    rp.colorAttachmentCount = 0;
    rp.depthStencilAttachment = &ds;

    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder_, &rp);
    if (pass) {
        wgpuRenderPassEncoderSetPipeline(pass, pipeline);
        wgpuRenderPassEncoderSetBindGroup(pass, 0, group, 0, nullptr);
        wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
        wgpuRenderPassEncoderEnd(pass);
        wgpuRenderPassEncoderRelease(pass);
    }
    wgpuBindGroupRelease(group);
}

// =============================================================================
// Internal clear family — the two clears WebGPU load-ops cannot spell: a
// region-scoped pass clear and a mid-pass stencil reset. A fullscreen triangle
// at z=1 (GL's clear depth) writes exactly the attachments requested: color via
// the write mask, depth via depthWriteEnabled + Always, stencil via
// Replace + the encoder's stencil reference.
// =============================================================================

WGPURenderPipeline WebGPUDevice::ensureClearPipeline(bool color, bool depth, bool stencil) {
    // The sample count is part of the key for the same reason the formats are:
    // a clear pipeline is validated against the pass it runs in.
    const u32 key = (pass_gbuffer_ ? 1u << 12 : 0u) | (pass_albedo_ ? 1u << 13 : 0u) |
                    colorVariantOf(pass_color_format_) << 6 |
                    dsVariantOf(pass_ds_format_) << 4 |
                    (pass_samples_ > 1 ? 8u : 0u) |
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

        clear_color_buffer_ = makeBuffer(GfxBufferUsage::Uniform, 16, nullptr);
        WGPUBindGroupEntry entry{};
        entry.binding = 0;
        entry.buffer = clear_color_buffer_;
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

    WGPUColorTargetState clearTargets[3]{};
    clearTargets[0].format = pass_color_format_;
    clearTargets[0].writeMask = color ? WGPUColorWriteMask_All : WGPUColorWriteMask_None;
    // A scoped clear is the camera's background, which a surface record has no part in.
    clearTargets[1].format = WGPUTextureFormat_RGBA8Unorm;
    clearTargets[1].writeMask = WGPUColorWriteMask_None;
    clearTargets[2].format = WGPUTextureFormat_RGBA8Unorm;
    clearTargets[2].writeMask = WGPUColorWriteMask_None;

    WGPUFragmentState fragment{};
    fragment.module = fs;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = !pass_gbuffer_ ? 1 : pass_albedo_ ? 3 : 2;
    fragment.targets = clearTargets;

    WGPURenderPipelineDescriptor pd{};
    pd.layout = clear_layout_;
    pd.vertex.module = vs;
    pd.vertex.entryPoint = sv("vs_main");
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = WGPUCullMode_None;
    pd.multisample.count = pass_samples_;
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
    writeBufferPadded(clear_color_buffer_, 0, rgba ? rgba : black, 16);

    // A region rides its own scissor and restores the full target; without one
    // (mid-pass stencil reset) the currently active scissor applies — the same
    // rectangle glClear would have honored.
    if (region) {
        setScissor(region->clearX, region->clearY,
                   static_cast<i32>(region->clearW), static_cast<i32>(region->clearH));
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
    bound_pipeline_ = 0;
    bind_group_dirty_ = true;
}

WGPURenderPipeline WebGPUDevice::ensureFlipPipeline(WGPUTextureFormat format) {
    const u32 key = static_cast<u32>(format);
    if (auto it = flip_pipelines_.find(key); it != flip_pipelines_.end()) return it->second;
    static const char* kFlipVS = R"(
@vertex fn vs_main(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
    return vec4f(p[i], 0.0, 1.0);
}
)";
    static const char* kFlipFS = R"(
@group(0) @binding(0) var source : texture_2d<f32>;
@fragment fn fs_main(@builtin(position) at : vec4f) -> @location(0) vec4f {
    let size = vec2i(textureDimensions(source));
    return textureLoad(source, vec2i(i32(at.x), size.y - 1 - i32(at.y)), 0);
}
)";
    auto makeModule = [&](const char* code) {
        WGPUShaderSourceWGSL wgsl{};
        wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
        wgsl.code = sv(code);
        WGPUShaderModuleDescriptor md{};
        md.nextInChain = &wgsl.chain;
        return wgpuDeviceCreateShaderModule(device_, &md);
    };
    if (!flip_bgl_) {
        WGPUBindGroupLayoutEntry entry{};
        entry.binding = 0;
        entry.visibility = WGPUShaderStage_Fragment;
        entry.texture.sampleType = WGPUTextureSampleType_UnfilterableFloat;
        entry.texture.viewDimension = WGPUTextureViewDimension_2D;
        WGPUBindGroupLayoutDescriptor bld{};
        bld.entryCount = 1;
        bld.entries = &entry;
        flip_bgl_ = wgpuDeviceCreateBindGroupLayout(device_, &bld);
        WGPUPipelineLayoutDescriptor pld{};
        pld.bindGroupLayoutCount = 1;
        pld.bindGroupLayouts = &flip_bgl_;
        flip_layout_ = wgpuDeviceCreatePipelineLayout(device_, &pld);
    }
    WGPUShaderModule vs = makeModule(kFlipVS);
    WGPUShaderModule fs = makeModule(kFlipFS);
    WGPUColorTargetState target{};
    target.format = format;
    target.writeMask = WGPUColorWriteMask_All;
    WGPUFragmentState fragment{};
    fragment.module = fs;
    fragment.entryPoint = sv("fs_main");
    fragment.targetCount = 1;
    fragment.targets = &target;
    WGPURenderPipelineDescriptor pd{};
    pd.layout = flip_layout_;
    pd.vertex.module = vs;
    pd.vertex.entryPoint = sv("vs_main");
    pd.primitive.topology = WGPUPrimitiveTopology_TriangleList;
    pd.primitive.frontFace = WGPUFrontFace_CCW;
    pd.primitive.cullMode = WGPUCullMode_None;
    pd.multisample.count = 1;
    pd.multisample.mask = 0xFFFFFFFFu;
    pd.fragment = &fragment;
    WGPURenderPipeline pipeline = wgpuDeviceCreateRenderPipeline(device_, &pd);
    wgpuShaderModuleRelease(vs);
    wgpuShaderModuleRelease(fs);
    flip_pipelines_[key] = pipeline;
    return pipeline;
}

void WebGPUDevice::copyTextureFlippedY(TextureHandle src, TextureHandle dst) {
    if (!device_ || !isDeviceUsable()) return;
    const auto from = textures_.find(static_cast<u32>(src));
    const auto to = textures_.find(static_cast<u32>(dst));
    if (from == textures_.end() || to == textures_.end()) return;
    if (from->second.samples > 1 || to->second.samples > 1
        || from->second.width != to->second.width || from->second.height != to->second.height) {
        ES_LOG_ERROR("WebGPUDevice::copyTextureFlippedY: the two textures must be single-sampled and the same size");
        return;
    }
    if (pass_) endRenderPass();
    WGPURenderPipeline pipeline = ensureFlipPipeline(to->second.format);
    if (!pipeline) return;

    WGPUBindGroupEntry entry{};
    entry.binding = 0;
    entry.textureView = from->second.sampleView ? from->second.sampleView : from->second.view;
    WGPUBindGroupDescriptor bgd{};
    bgd.layout = flip_bgl_;
    bgd.entryCount = 1;
    bgd.entries = &entry;
    WGPUBindGroup group = wgpuDeviceCreateBindGroup(device_, &bgd);

    WGPURenderPassColorAttachment color{};
    color.view = to->second.view;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = WGPULoadOp_Clear;
    color.storeOp = WGPUStoreOp_Store;
    WGPURenderPassDescriptor rp{};
    rp.colorAttachmentCount = 1;
    rp.colorAttachments = &color;

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    WGPURenderPassEncoder pass = wgpuCommandEncoderBeginRenderPass(encoder, &rp);
    wgpuRenderPassEncoderSetPipeline(pass, pipeline);
    wgpuRenderPassEncoderSetBindGroup(pass, 0, group, 0, nullptr);
    wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
    wgpuRenderPassEncoderEnd(pass);
    wgpuRenderPassEncoderRelease(pass);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);
    wgpuCommandEncoderRelease(encoder);
    wgpuBindGroupRelease(group);
}

WGPUBindGroupLayout WebGPUDevice::groupLayoutFor(u32 group, u32 mask, u32 depthMask,
                                                u32 vertexMask, u32 arrayMask) {
    // Every mask is part of the key: the same bindings sampled as depth or as an
    // array are a DIFFERENT layout, and visibility is part of an entry too.
    const std::array<u32, 5> key{group, mask, depthMask, vertexMask, arrayMask};
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
        // visibility unless the vertex stage declared the binding itself: a
        // stage sees only what its entry admits.
        static_assert(kTextureSlots == kGroup1TextureUnits,
                      "device texture slots mirror the group-1 convention");
        for (u32 unit = 0; unit < kTextureSlots; ++unit) {
            const u32 tb = textureBindingForUnit(unit);
            const u32 sb = samplerBindingForUnit(unit);
            const auto stages = [&](u32 binding) {
                return (vertexMask & (1u << binding))
                           ? (WGPUShaderStage_Vertex | WGPUShaderStage_Fragment)
                           : WGPUShaderStage_Fragment;
            };
            if (mask & (1u << tb)) {
                WGPUBindGroupLayoutEntry e{};
                e.binding = tb;
                e.visibility = stages(tb);
                // A unit with no sampler cannot be textureSample'd, so it is
                // unfilterable by construction — which is what lets rgba32float
                // bind here. Filterable formats satisfy it too.
                e.texture.sampleType =
                    (depthMask & (1u << tb))  ? WGPUTextureSampleType_Depth
                    : (mask & (1u << sb))     ? WGPUTextureSampleType_Float
                                              : WGPUTextureSampleType_UnfilterableFloat;
                e.texture.viewDimension = (arrayMask & (1u << tb)) ? WGPUTextureViewDimension_2DArray
                                                                   : WGPUTextureViewDimension_2D;
                entries[count++] = e;
            }
            if (mask & (1u << sb)) {
                WGPUBindGroupLayoutEntry e{};
                e.binding = sb;
                e.visibility = stages(sb);
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

WGPUPipelineLayout WebGPUDevice::pipelineLayoutFor(u32 group0Mask, u32 group1Mask,
                                                   u32 group1DepthMask, u32 group1VertexMask,
                                                   u32 group1ArrayMask) {
    // The depth, visibility and array masks change the group-1 layout under this
    // pipeline, so they have to reach the key here too — see groupLayoutFor.
    const std::array<u32, 5> key{group0Mask, group1Mask, group1DepthMask, group1VertexMask, group1ArrayMask};
    auto cached = pipeline_layouts_.find(key);
    if (cached != pipeline_layouts_.end()) return cached->second;
    if (!device_) return nullptr;

    // Group indices are positional: a program with group-1 bindings always
    // carries a group-0 layout too (zero entries when the mask is empty).
    WGPUBindGroupLayout bgls[2];
    u32 count = 0;
    if (group0Mask != 0 || group1Mask != 0) bgls[count++] = groupLayoutFor(0, group0Mask);
    if (group1Mask != 0) {
        bgls[count++] = groupLayoutFor(1, group1Mask, group1DepthMask, group1VertexMask, group1ArrayMask);
    }

    WGPUPipelineLayoutDescriptor pld{};
    pld.bindGroupLayoutCount = count;
    pld.bindGroupLayouts = bgls;
    WGPUPipelineLayout layout = wgpuDeviceCreatePipelineLayout(device_, &pld);
    pipeline_layouts_[key] = layout;
    return layout;
}

void WebGPUDevice::ensureDummies() {
    if (!dummy_ubo_.buffer) {
        // Sized past the largest engine block (LightConstants, just under 16 KB with the tiled lights) so a
        // declared-but-unbound block always satisfies draw-time size validation.
        const std::vector<u8> zeros(16384, 0);
        dummy_ubo_ = BufferRec{makeBuffer(GfxBufferUsage::Uniform, 16384, zeros.data()), 16384,
                               GfxBufferUsage::Uniform};
    }
    if (!dummy_texture_.texture) {
        const u8 white[4] = {255, 255, 255, 255};
        makeTexture(TextureDesc{}, white, dummy_texture_);
    }
    if (!dummy_depth_texture_.texture) {
        // Never written, only bound: a depth format takes no upload, and the
        // point is a texture of the right KIND under a declared depth binding.
        TextureDesc td{};
        td.format = GfxPixelFormat::Depth24Stencil8;
        makeTexture(td, nullptr, dummy_depth_texture_);
    }
    if (!dummy_array_texture_.texture) {
        const u8 white[8] = {255, 255, 255, 255, 255, 255, 255, 255};
        TextureDesc td{};
        td.layers = 2;
        makeTexture(td, white, dummy_array_texture_);
    }
}

WGPUBindGroup WebGPUDevice::cachedBindGroup(const u64* ids, u32 idCount,
                                            const WGPUBindGroupDescriptor& desc) {
    u64 hash = 1469598103934665603ull ^ reinterpret_cast<uintptr_t>(desc.layout);
    for (u32 i = 0; i < idCount; ++i) hash = (hash ^ ids[i]) * 1099511628211ull;
    auto found = bind_group_cache_.find(hash);
    if (found != bind_group_cache_.end()) {
        for (auto& e : found->second) {
            if (e.layout != desc.layout || e.ids.size() != idCount) continue;
            bool same = true;
            for (u32 i = 0; i < idCount; ++i) {
                if (e.ids[i] != ids[i]) { same = false; break; }
            }
            if (same) { e.used = bind_group_frame_; return e.bg; }  // hit — reuse, no wgpuDeviceCreateBindGroup
        }
    }
    // Miss. When full, only what neither this frame nor the last bound goes: emptying the cache made a view of more groups than
    // it holds create every one of them again each frame, and the device ran out of descriptors within some hundreds of frames.
    if (bind_group_count_ >= kBindGroupCacheCap) {
        for (auto it = bind_group_cache_.begin(); it != bind_group_cache_.end();) {
            auto& bucket = it->second;
            for (usize i = bucket.size(); i-- > 0;) {
                if (bucket[i].used + 1 >= bind_group_frame_) continue;
                if (bucket[i].bg) wgpuBindGroupRelease(bucket[i].bg);
                bucket.erase(bucket.begin() + static_cast<std::ptrdiff_t>(i));
                --bind_group_count_;
            }
            it = bucket.empty() ? bind_group_cache_.erase(it) : std::next(it);
        }
    }
    WGPUBindGroup bg = wgpuDeviceCreateBindGroup(device_, &desc);
    if (bg) {
        bind_group_cache_[hash].push_back({desc.layout, std::vector<u64>(ids, ids + idCount), bg, bind_group_frame_});
        ++bind_group_count_;
    }
    return bg;
}

void WebGPUDevice::flushBindGroup() {
    if (!bind_group_dirty_ || !pass_ || !device_) return;

    WGPURenderPipeline p = ensurePipeline(bound_pipeline_);
    if (!p) return;

    const ProgramRec* prog = nullptr;
    if (const PipelineDesc* desc = pipelineDesc(PipelineHandle{bound_pipeline_})) {
        auto progIt = programs_.find(static_cast<u32>(desc->program));
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
            const bool armed = it != buffers_.end() && it->second.buffer;
            const BufferRec& bound = armed ? it->second : dummy_ubo_;
            if (!bound.buffer) continue;
            WGPUBindGroupEntry e{};
            e.binding = slot;
            e.buffer = bound.buffer;
            e.offset = armed ? uniform_offsets_[slot] : 0;
            e.size = armed && uniform_sizes_[slot] ? uniform_sizes_[slot] : bound.size;
            entries[count++] = e;
        }

        WGPUBindGroupDescriptor bgd{};
        bgd.layout = groupLayoutFor(0, prog->group0Mask);
        bgd.entryCount = count;
        bgd.entries = entries;
        // An offset is keyed with its top bit set, so it never equals the buffer
        // pointer evictBindGroups looks for.
        u64 ids[kUniformSlots * 2];
        for (u32 i = 0; i < count; ++i) {
            ids[i * 2] = static_cast<u64>(reinterpret_cast<uintptr_t>(entries[i].buffer));
            ids[i * 2 + 1] = (u64{1} << 63) | (entries[i].offset << 20) | entries[i].size;
        }
        bind_group_ = cachedBindGroup(ids, count * 2, bgd);
        if (bind_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 0, bind_group_, 0, nullptr);
    }

    // Group 1: the texture units through the unit→binding convention (engine
    // units 0..7 at texture bindings 0..7 / samplers 8..15, material units
    // 8..15 at 16..23 / 24..31; sampler i carries texture i's filter/wrap
    // params via the sampler cache). Every declared binding gets an entry —
    // the bound unit's view/sampler or the 1x1 white dummy — so the group
    // always matches the explicit layout, textures bound or not.
    if (prog->group1Mask != 0) {
        const TextureRec* dummy = dummy_texture_.texture ? &dummy_texture_ : nullptr;
        const TextureRec* depthDummy = dummy_depth_texture_.texture ? &dummy_depth_texture_ : nullptr;
        const TextureRec* arrayDummy = dummy_array_texture_.texture ? &dummy_array_texture_ : nullptr;

        WGPUBindGroupEntry texEntries[kTextureSlots * 2];
        u32 texCount = 0;
        for (u32 unit = 0; unit < kTextureSlots; ++unit) {
            // A pass may not sample what it draws into: WebGPU rejects the whole
            // COMMAND BUFFER for it, not the draw. The dummy stands in — reading
            // one's own attachment is undefined under every backend anyway.
            const u32 bound = texture_slots_[unit];
            const bool feedback = bound != 0 && (bound == pass_color_texture_ ||
                                                 bound == pass_depth_texture_);
            auto it = feedback ? textures_.end() : textures_.find(bound);
            const TextureRec* rec = (it != textures_.end()) ? &it->second : dummy;
            if (!rec) continue;
            const u32 tb = textureBindingForUnit(unit);
            const u32 sb = samplerBindingForUnit(unit);
            if (prog->group1Mask & (1u << tb)) {
                // A depth declaration must be fed a depth texture even when the
                // unit is unbound: the white dummy under `sampleType = Depth` is
                // a validation error, not a blank sample.
                const bool wantsDepth = (prog->group1DepthMask & (1u << tb)) != 0;
                // The view's dimension must be the declaration's: an array where a
                // 2D texture is declared, or the reverse, is the dummy of the right kind.
                const bool wantsArray = (prog->group1ArrayMask & (1u << tb)) != 0;
                const TextureRec* src = rec;
                if (wantsDepth && !isDepthFormat(src->format)) src = depthDummy;
                else if (wantsArray && src->layers == 1) src = arrayDummy;
                else if (!wantsArray && src->layers > 1) src = dummy;
                if (!src) continue;
                WGPUBindGroupEntry e{};
                e.binding = tb;
                e.textureView = src->sampleView;
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
        tgd.layout = groupLayoutFor(1, prog->group1Mask, prog->group1DepthMask,
                                    prog->group1VertexMask, prog->group1ArrayMask);
        tgd.entryCount = texCount;
        tgd.entries = texEntries;
        u64 tids[kTextureSlots * 2];
        for (u32 i = 0; i < texCount; ++i) {
            const uintptr_t p = texEntries[i].textureView
                ? reinterpret_cast<uintptr_t>(texEntries[i].textureView)
                : reinterpret_cast<uintptr_t>(texEntries[i].sampler);
            tids[i] = static_cast<u64>(p);
        }
        texture_group_ = cachedBindGroup(tids, texCount, tgd);
        if (texture_group_) wgpuRenderPassEncoderSetBindGroup(pass_, 1, texture_group_, 0, nullptr);
    }
    bind_group_dirty_ = false;
}

// =============================================================================
// Draws / passes — slice 2 (per-frame command encoder + surface plumbing)
// =============================================================================

void WebGPUDevice::drawElements(u32 indexCount, GfxDataType indexType, u32 indexByteOffset) {
    if (!isDeviceUsable() || !pass_) return;
    auto it = buffers_.find(bound_index_buffer_);
    if (it == buffers_.end()) return;
    flushBindGroup();
    wgpuRenderPassEncoderSetIndexBuffer(pass_, it->second.buffer, toWGPUIndexFormat(indexType),
                                        0, it->second.size);
    const u32 indexSize = (indexType == GfxDataType::UnsignedShort) ? 2 : 4;
    countDraw();
    wgpuRenderPassEncoderDrawIndexed(pass_, indexCount, 1, indexByteOffset / indexSize, 0, 0);
}

void WebGPUDevice::drawArrays(u32 firstVertex, u32 vertexCount) {
    if (!isDeviceUsable() || !pass_) return;
    flushBindGroup();
    countDraw();
    wgpuRenderPassEncoderDraw(pass_, vertexCount, 1, firstVertex, 0);
}

void WebGPUDevice::drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 indexByteOffset,
                                         u32 instanceCount) {
    if (!isDeviceUsable() || !pass_) return;
    auto it = buffers_.find(bound_index_buffer_);
    if (it == buffers_.end()) return;
    flushBindGroup();
    wgpuRenderPassEncoderSetIndexBuffer(pass_, it->second.buffer, toWGPUIndexFormat(indexType),
                                        0, it->second.size);
    const u32 indexSize = (indexType == GfxDataType::UnsignedShort) ? 2 : 4;
    countDraw();
    wgpuRenderPassEncoderDrawIndexed(pass_, indexCount, instanceCount,
                                     indexByteOffset / indexSize, 0, 0);
}

bool WebGPUDevice::backendCreateFramebuffer(u32, const FramebufferDesc& desc) {
    const u32 depthStencil = static_cast<u32>(desc.depthStencil);
    if (depthStencil != 0 && !textures_.count(depthStencil)) {
        ES_LOG_ERROR("WebGPUDevice::createFramebuffer: unknown depth-stencil texture");
        return false;
    }
    return true;
}

void WebGPUDevice::beginRenderPass(const RenderPassDesc& desc) {
    if (!isDeviceUsable()) return;
    if (!device_) return;
    if (pass_) endRenderPass();  // defensive: a dangling pass would deadlock the queue

    WGPUTextureView targetView = nullptr;
    WGPUTextureView resolveView = nullptr;
    WGPUTextureView dsView = nullptr;
    pass_ds_format_ = WGPUTextureFormat_Undefined;
    pass_color_format_ = surface_format_;
    pass_color_texture_ = 0;
    pass_depth_texture_ = 0;
    pass_is_surface_ = desc.target == FramebufferHandle::Default;
    pass_samples_ = 1;
    pass_gbuffer_ = false;
    pass_albedo_ = false;
    WGPUTextureView gbufferView = nullptr;
    WGPUTextureView gbufferResolveView = nullptr;
    WGPUTextureView albedoView = nullptr;
    WGPUTextureView albedoResolveView = nullptr;
    pass_depth_msaa_ = 0;
    pass_depth_resolve_ = 0;
    if (desc.target != FramebufferHandle::Default) {
        const FramebufferDesc* fb = framebufferDesc(desc.target);
        if (!fb) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: unknown framebuffer");
            return;
        }
        const u32 color0 = static_cast<u32>(fb->color0);
        const u32 depthStencil = static_cast<u32>(fb->depthStencil);
        auto texIt = textures_.find(color0);
        if (texIt == textures_.end()) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: framebuffer color texture missing");
            return;
        }
        targetView = texIt->second.view;
        pass_color_format_ = texIt->second.format;
        pass_color_texture_ = color0;
        pass_samples_ = texIt->second.samples;
        pass_width_ = texIt->second.width;
        pass_height_ = texIt->second.height;
        // A multisampled attachment is written, never read: the frame's readback
        // and everything that samples the scene take the single-sample twin the
        // pass resolves into, so that is the texture this pass ANSWERS with.
        if (pass_samples_ > 1) {
            const u32 resolve = static_cast<u32>(fb->resolveColor0);
            auto resolveIt = textures_.find(resolve);
            if (resolveIt == textures_.end()) {
                ES_LOG_ERROR("WebGPUDevice::beginRenderPass: a multisampled target with no resolve twin");
                return;
            }
            resolveView = resolveIt->second.view;
            pass_color_texture_ = resolve;
        }
        if (fb->color1 != TextureHandle::Invalid) {
            auto gIt = textures_.find(static_cast<u32>(fb->color1));
            if (gIt != textures_.end()) {
                gbufferView = gIt->second.view;
                pass_gbuffer_ = true;
                if (gIt->second.samples > 1) {
                    auto gResolve = textures_.find(static_cast<u32>(fb->resolveColor1));
                    if (gResolve == textures_.end()) {
                        ES_LOG_ERROR("WebGPUDevice::beginRenderPass: a multisampled surface record with no resolve twin");
                        return;
                    }
                    gbufferResolveView = gResolve->second.view;
                }
            }
        }
        if (pass_gbuffer_ && fb->color2 != TextureHandle::Invalid) {
            auto aIt = textures_.find(static_cast<u32>(fb->color2));
            if (aIt != textures_.end()) {
                albedoView = aIt->second.view;
                pass_albedo_ = true;
                if (aIt->second.samples > 1) {
                    auto aResolve = textures_.find(static_cast<u32>(fb->resolveColor2));
                    if (aResolve == textures_.end()) {
                        ES_LOG_ERROR("WebGPUDevice::beginRenderPass: a multisampled albedo with no resolve twin");
                        return;
                    }
                    albedoResolveView = aResolve->second.view;
                }
            }
        }
        if (depthStencil != 0) {
            auto dsIt = textures_.find(depthStencil);
            if (dsIt != textures_.end()) {
                dsView = dsIt->second.view;
                pass_ds_format_ = dsIt->second.format;
                pass_depth_texture_ = depthStencil;
                // A multisampled depth attachment owes its contents to the twin
                // whatever samples scene depth will read; the resolve runs once
                // the pass is closed, on the same encoder.
                const u32 resolveDepth = static_cast<u32>(fb->resolveDepthStencil);
                if (dsIt->second.samples > 1 && resolveDepth != 0) {
                    pass_depth_msaa_ = depthStencil;
                    pass_depth_resolve_ = resolveDepth;
                    pass_depth_texture_ = resolveDepth;
                }
            }
        }
    } else {
        if (!surface_) {
            ES_LOG_ERROR("WebGPUDevice::beginRenderPass: no surface configured");
            return;
        }
        // The swapchain texture belongs to the FRAME, not to one pass: WebGPU
        // hands it out once and takes it back at present. A frame that opens a
        // second pass on it — a post-process blit over the captured scene, a
        // second camera — must reuse the one it already holds; re-acquiring
        // after releasing it returns an error, and every draw after that is
        // dropped, which is a black screen with nothing else wrong.
        // A web boot logs one "Destroyed texture used in a submit" from a frame
        // that is never ended; the frames are correct and it happens once. See
        // docs/REARCH_RENDER.md §9 for what was measured and what it costs.
        if (!frame_view_) {
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
            // The texture the surface hands back is the truth about its size: a
            // native surface may ignore the configured extent (a window mid-
            // rotation still reports the old one), and a depth companion built
            // for the size we ASKED for is then the wrong shape, which invalidates
            // the pass and takes the whole frame with it.
            const u32 texW = wgpuTextureGetWidth(frame_texture_);
            const u32 texH = wgpuTextureGetHeight(frame_texture_);
            if (texW > 0 && texH > 0) {
                surface_width_ = texW;
                surface_height_ = texH;
                ensureSurfaceDepth(texW, texH);
            }
        }
        pass_width_ = surface_width_;
        pass_height_ = surface_height_;
        // Multisampled: draw into the companion and resolve into the surface
        // texture the browser presents. Single-sampled: draw into it directly.
        if (ensureSurfaceMsaa(surface_width_, surface_height_)) {
            ensureSurfaceDepth(surface_width_, surface_height_);
            targetView = surface_msaa_view_;
            resolveView = frame_view_;
            pass_samples_ = surface_msaa_samples_;
        } else {
            targetView = frame_view_;
        }
        dsView = surface_depth_view_;
        pass_ds_format_ = WGPUTextureFormat_Depth24PlusStencil8;
    }

    encoder_ = wgpuDeviceCreateCommandEncoder(device_, nullptr);

    // GPU timing. A pass the graph armed is timed under its own name; any other pass that opens inside a timer span
    // adds its time to the span, whatever it draws to — the span is the frame's, not the surface pass's.
    pass_time_slot_ = takePassTimeSlot();
    pass_timed_ = pass_time_slot_ == kNoPassSlot && spanTakesPass();

    const bool scoped = desc.clearW != 0;
    WGPURenderPassColorAttachment color{};
    color.view = targetView;
    color.resolveTarget = resolveView;
    color.depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
    color.loadOp = toWGPULoadOp(desc.clearColor, scoped);
    // Resolved into its single-sample twin by the pass itself; when nothing continues on this target the samples need not be kept.
    color.storeOp = (desc.discardMultisampled && resolveView) ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
    color.clearValue = toWGPUClearColor(desc);

    // The surface record clears to zero — "nothing wrote here" — whatever the background is.
    WGPURenderPassColorAttachment colors[3]{};
    colors[0] = color;
    if (pass_gbuffer_) {
        colors[1].view = gbufferView;
        colors[1].resolveTarget = gbufferResolveView;
        colors[1].depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
        colors[1].loadOp = toWGPULoadOp(desc.clearColor, scoped);
        colors[1].storeOp = (desc.discardMultisampled && gbufferResolveView) ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
        colors[1].clearValue = {0.0, 0.0, 0.0, 0.0};
    }
    if (pass_albedo_) {
        colors[2].view = albedoView;
        colors[2].resolveTarget = albedoResolveView;
        colors[2].depthSlice = WGPU_DEPTH_SLICE_UNDEFINED;
        colors[2].loadOp = toWGPULoadOp(desc.clearColor, scoped);
        colors[2].storeOp = (desc.discardMultisampled && albedoResolveView) ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
        colors[2].clearValue = {0.0, 0.0, 0.0, 0.0};
    }

    WGPURenderPassDescriptor rp{};
    rp.colorAttachmentCount = !pass_gbuffer_ ? 1 : pass_albedo_ ? 3 : 2;
    rp.colorAttachments = colors;

    WGPURenderPassDepthStencilAttachment ds{};
    if (dsView) {
        ds.view = dsView;
        ds.depthLoadOp = toWGPULoadOp(desc.clearDepth, scoped);
        // Kept unless the pass said it is only for testing, and unless a multisampled one is resolved by hand after the pass.
        ds.depthStoreOp = (desc.discardDepth && pass_depth_msaa_ == 0) ? WGPUStoreOp_Discard : WGPUStoreOp_Store;
        ds.depthClearValue = 1.0f;  // GL's default clear depth; no RHI override exists
        if (hasStencilPlanes(pass_ds_format_)) {
            ds.stencilLoadOp = toWGPULoadOp(desc.clearStencil, scoped);
            ds.stencilStoreOp = WGPUStoreOp_Store;
            ds.stencilClearValue = static_cast<u32>(desc.clearStencilValue);
        }
        rp.depthStencilAttachment = &ds;
    }
    WGPUPassTimestampWrites tw{};
    if (pass_timed_ || pass_time_slot_ != kNoPassSlot) {
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

    // Depth, on the same encoder and after the pass that wrote it: colour was
    // resolved by the pass itself, and this is the half WebGPU leaves to us.
    if (pass_depth_msaa_ && pass_depth_resolve_) {
        resolveDepthAttachment(pass_depth_msaa_, pass_depth_resolve_);
        pass_depth_msaa_ = 0;
        pass_depth_resolve_ = 0;
    }

    // GPU timing: resolve this pass's begin/end timestamps into the reserved ring
    // slot (recorded on the same encoder, so it runs after the pass on the GPU).
    const u32 passSlot = encoder_ ? pass_time_slot_ : kNoPassSlot;
    pass_time_slot_ = kNoPassSlot;
    if (passSlot != kNoPassSlot) resolvePassTime(encoder_, passSlot);
    if (pass_timed_ && encoder_) resolveSpanPass(encoder_);
    pass_timed_ = false;

    // A booked capture rides the pass's OWN encoder: the browser presents the
    // swapchain image with this submit, so a copy encoded afterwards copies a
    // destroyed texture. Several surface passes overwrite; the last one wins.
    if (capture_id_ && pass_is_surface_ && frame_texture_ && encoder_) {
        encodeReadbackCopy(encoder_, capture_id_, frame_texture_);
        capture_copied_ = true;
    }
    pass_is_surface_ = false;

    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder_, nullptr);
    wgpuCommandEncoderRelease(encoder_);
    encoder_ = nullptr;
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);

    if (passSlot != kNoPassSlot) mapPassTime(passSlot);
    // The span was closed while this pass was still open: it was the last one in it.
    if (span_closing_) {
        span_closing_ = false;
        finishSpan();
    }
}

/** Give the swapchain texture back: the frame is over (see GfxDevice::endFrame).
 *  A frame may have opened several passes on it, so no single pass may do this. */
void WebGPUDevice::endFrame() {
    ++bind_group_frame_;
    // A capture is served HERE and nowhere else: this is the last instant at which
    // the frame is both finished and still ours. Asking from outside cannot work —
    // whoever could ask runs after the renderer has already given the image back.
    if (capture_id_) {
        const u32 id = capture_id_;
        capture_id_ = 0;
        if (capture_copied_) {
            capture_copied_ = false;
            mapReadback(id);
        } else if (frame_texture_) {
            submitReadbackCopy(id, frame_texture_);
        } else {
            // Nothing drew, so there is no image to copy. Leaving the record
            // Pending would hang whoever is polling it.
            auto it = readbacks_.find(id);
            if (it != readbacks_.end()) it->second.status = GfxReadbackStatus::Failed;
        }
    }
    if (frame_view_) { wgpuTextureViewRelease(frame_view_); frame_view_ = nullptr; }
    if (frame_texture_) { wgpuTextureRelease(frame_texture_); frame_texture_ = nullptr; }
}

ReadbackHandle WebGPUDevice::captureNextFrame(u32 w, u32 h) {
    if (!isDeviceUsable() || !device_ || w == 0 || h == 0) return ReadbackHandle::Invalid;
    if (!surface_readback_) {
        ES_LOG_ERROR("WebGPUDevice::captureNextFrame: the surface was configured without CopySrc "
                     "(setSurfaceReadback must be on before configureSurface)");
        return ReadbackHandle::Invalid;
    }
    if (capture_id_) return ReadbackHandle::Invalid;   // one in flight is enough
    capture_id_ = allocReadback(w, h);
    return static_cast<ReadbackHandle>(capture_id_);
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
    if (!isDeviceUsable()) return ReadbackHandle::Invalid;
    if (!device_ || w == 0 || h == 0) return ReadbackHandle::Invalid;
    if (inPass()) {
        ES_LOG_ERROR("WebGPUDevice::requestReadback: must be called outside a render pass");
        return ReadbackHandle::Invalid;
    }
    if (target == FramebufferHandle::Default) {
        // Not addressable from out here: the renderer gives the swapchain image
        // back at the end of its own frame, so any caller is already too late.
        // captureNextFrame reads the presented frame instead.
        stubOnce("requestReadback(default framebuffer) — use captureNextFrame");
        return ReadbackHandle::Invalid;
    }
    const FramebufferDesc* fb = framebufferDesc(target);
    if (!fb) return ReadbackHandle::Invalid;
    auto tit = textures_.find(static_cast<u32>(fb->color0));
    if (tit == textures_.end() || !tit->second.texture) return ReadbackHandle::Invalid;

    const u32 id = allocReadback(w, h);
    if (!id) return ReadbackHandle::Invalid;
    submitReadbackCopy(id, tit->second.texture);
    return static_cast<ReadbackHandle>(id);
}

/** The staging buffer and its record, with no copy yet. Split from the copy so a
 *  capture can be handed a handle to poll NOW and filled in later, at the only
 *  moment the swapchain image exists (see captureNextFrame). */
u32 WebGPUDevice::allocReadback(u32 w, u32 h) {
    // copyTextureToBuffer requires a 256-byte row alignment; rows are compacted
    // (and flipped to the bottom-up contract) in takeReadback.
    const u32 padded = (w * 4u + 255u) & ~255u;
    WGPUBufferDescriptor bd{};
    bd.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    bd.size = static_cast<u64>(padded) * h;
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device_, &bd);
    if (!buffer) return 0;
    const u32 id = next_readback_id_++;
    readbacks_[id] = ReadbackRec{buffer, w, h, padded, GfxReadbackStatus::Pending};
    return id;
}

void WebGPUDevice::encodeReadbackCopy(WGPUCommandEncoder encoder, u32 id, WGPUTexture source) {
    auto it = readbacks_.find(id);
    if (it == readbacks_.end() || !source || !encoder) return;
    ReadbackRec& rec = it->second;

    WGPUTexelCopyTextureInfo src = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
    src.texture = source;
    WGPUTexelCopyBufferInfo dst = WGPU_TEXEL_COPY_BUFFER_INFO_INIT;
    dst.buffer = rec.buffer;
    dst.layout.offset = 0;
    dst.layout.bytesPerRow = rec.paddedBytesPerRow;
    dst.layout.rowsPerImage = rec.height;
    WGPUExtent3D size{rec.width, rec.height, 1};
    wgpuCommandEncoderCopyTextureToBuffer(encoder, &src, &dst, &size);
}

void WebGPUDevice::mapReadback(u32 id) {
    auto it = readbacks_.find(id);
    if (it == readbacks_.end()) return;
    ReadbackRec& rec = it->second;
    WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_AllowSpontaneous;
    cb.callback = &WebGPUDevice::onReadbackMapped;
    cb.userdata1 = this;
    cb.userdata2 = reinterpret_cast<void*>(static_cast<uintptr_t>(id));
    wgpuBufferMapAsync(rec.buffer, WGPUMapMode_Read, 0,
                       static_cast<u64>(rec.paddedBytesPerRow) * rec.height, cb);
}

void WebGPUDevice::submitReadbackCopy(u32 id, WGPUTexture source) {
    if (readbacks_.find(id) == readbacks_.end() || !source) return;
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    encodeReadbackCopy(encoder, id, source);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);
    mapReadback(id);
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
    if (rec.raw) {
        // A compute readback: the source's own bytes, rows top-down with the padding taken out.
        if (destSize < rec.tightBytes) return false;
        const auto* mapped = static_cast<const u8*>(
            wgpuBufferGetConstMappedRange(rec.buffer, 0, static_cast<u64>(rec.paddedBytesPerRow) * rec.height));
        if (!mapped) {
            releaseReadback(static_cast<u32>(handle));
            return false;
        }
        auto* out = static_cast<u8*>(dest);
        const u32 rowBytes = rec.width * rec.bytesPerTexel;
        for (u32 row = 0; row < rec.height; ++row) {
            std::memcpy(out + static_cast<usize>(row) * rowBytes, mapped + static_cast<usize>(row) * rec.paddedBytesPerRow, rowBytes);
        }
        wgpuBufferUnmap(rec.buffer);
        releaseReadback(static_cast<u32>(handle));
        return true;
    }
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
    qd.count = 2;  // begin + end of the pass being timed; resolved out before the next pass reuses them
    timestamp_qset_ = wgpuDeviceCreateQuerySet(device_, &qd);
    if (!timestamp_qset_) return;

    WGPUBufferDescriptor rd{};
    rd.usage = WGPUBufferUsage_QueryResolve | WGPUBufferUsage_CopySrc;
    rd.size = 16;  // 2 × u64 nanosecond timestamps
    timestamp_resolve_ = wgpuDeviceCreateBuffer(device_, &rd);
    for (u32 i = 0; i < kGpuTimeRing; ++i) {
        WGPUBufferDescriptor bd{};
        bd.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
        bd.size = 16 * kSpanPasses;
        gpu_time_ring_[i].buf = wgpuDeviceCreateBuffer(device_, &bd);
    }
    timestamp_supported_ = timestamp_resolve_ && gpu_time_ring_[0].buf;
}

// One query set serves every timer: timing rides the passes, so a query id
// only has to exist for the engine's GpuTimer to turn on.
bool WebGPUDevice::backendCreateTimerQuery(u32) {
    ensureTimestamps();
    return timestamp_supported_;
}

// A span is what GL's GL_TIME_ELAPSED gives between the same two calls: the GPU's time for everything issued inside
// it. WebGPU can only stamp a pass, so every pass that opens inside the span is stamped and the span is their sum.
void WebGPUDevice::beginTimerQuery(u32) {
    if (!timestamp_supported_) return;
    span_closing_ = false;
    span_slot_ = kGpuTimeRing;
    span_passes_ = 0;
    for (u32 i = 0; i < kGpuTimeRing; ++i) {
        const u32 s = (gpu_time_next_ + i) % kGpuTimeRing;
        if (!gpu_time_ring_[s].pending) {
            span_slot_ = s;
            gpu_time_next_ = (s + 1) % kGpuTimeRing;
            break;
        }
    }
    // With every readback still in flight the span goes untimed, and says so with a zero rather than no answer:
    // the caller keeps one query in flight per span and would otherwise wait on this one for good.
    span_open_ = true;
}

void WebGPUDevice::endTimerQuery() {
    if (!span_open_) return;
    span_open_ = false;
    // A pass still open belongs to the span and has not been stamped yet; its end finishes the span.
    if (pass_) span_closing_ = true;
    else finishSpan();
}

bool WebGPUDevice::spanTakesPass() const {
    return timestamp_supported_ && span_open_ && span_slot_ < kGpuTimeRing && span_passes_ < kSpanPasses;
}

void WebGPUDevice::resolveSpanPass(WGPUCommandEncoder encoder) {
    wgpuCommandEncoderResolveQuerySet(encoder, timestamp_qset_, 0, 2, timestamp_resolve_, 0);
    wgpuCommandEncoderCopyBufferToBuffer(encoder, timestamp_resolve_, 0,
                                         gpu_time_ring_[span_slot_].buf, 16ull * span_passes_, 16);
    ++span_passes_;
}

void WebGPUDevice::finishSpan() {
    const u32 slot = span_slot_;
    const u32 passes = span_passes_;
    span_slot_ = kGpuTimeRing;
    span_passes_ = 0;
    if (!timestamp_supported_) return;
    if (slot >= kGpuTimeRing || passes == 0) {
        if (gpu_time_results_.size() < 16) gpu_time_results_.push_back(0);
        return;
    }
    // Map async — drained by getTimerQueryNs a few frames later (the GpuTimer ring tolerates the latency).
    gpu_time_ring_[slot].pending = true;
    gpu_time_ring_[slot].passes = passes;
    WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_AllowSpontaneous;
    cb.callback = &WebGPUDevice::onGpuTimeMapped;
    cb.userdata1 = this;
    cb.userdata2 = reinterpret_cast<void*>(static_cast<uintptr_t>(slot));
    wgpuBufferMapAsync(gpu_time_ring_[slot].buf, WGPUMapMode_Read, 0, 16ull * passes, cb);
}
bool WebGPUDevice::timerDisjoint() { return false; }

bool WebGPUDevice::getTimerQueryNs(u32 query, u64* outNs) {
    if (pass_time_tags_.count(query)) {
        const auto it = pass_time_results_.find(query);
        if (it == pass_time_results_.end()) return false;
        if (outNs) *outNs = it->second;
        pass_time_results_.erase(it);
        return true;
    }
    if (gpu_time_results_.empty()) return false;
    if (outNs) *outNs = gpu_time_results_.front();
    gpu_time_results_.erase(gpu_time_results_.begin());
    return true;
}

void WebGPUDevice::armPassTimer(u32 query) {
    armed_pass_tag_ = timestamp_supported_ ? query : 0;
    if (armed_pass_tag_) pass_time_tags_.insert(armed_pass_tag_);
}

u32 WebGPUDevice::takePassTimeSlot() {
    const u32 tag = armed_pass_tag_;
    armed_pass_tag_ = 0;
    if (!tag || !timestamp_supported_) return kNoPassSlot;
    u32 slot = kNoPassSlot;
    for (u32 i = 0; i < pass_time_pool_.size(); ++i) {
        if (!pass_time_pool_[i].pending) { slot = i; break; }
    }
    if (slot == kNoPassSlot) {
        if (pass_time_pool_.size() >= kPassTimePool) return kNoPassSlot;  // readbacks are not coming back: skip, don't grow
        WGPUBufferDescriptor bd{};
        bd.usage = WGPUBufferUsage_MapRead | WGPUBufferUsage_CopyDst;
        bd.size = 16;
        PassTimeSlot fresh;
        fresh.buf = wgpuDeviceCreateBuffer(device_, &bd);
        if (!fresh.buf) return kNoPassSlot;
        pass_time_pool_.push_back(fresh);
        slot = static_cast<u32>(pass_time_pool_.size() - 1);
    }
    pass_time_pool_[slot].tag = tag;
    return slot;
}

void WebGPUDevice::resolvePassTime(WGPUCommandEncoder encoder, u32 slot) {
    wgpuCommandEncoderResolveQuerySet(encoder, timestamp_qset_, 0, 2, timestamp_resolve_, 0);
    wgpuCommandEncoderCopyBufferToBuffer(encoder, timestamp_resolve_, 0, pass_time_pool_[slot].buf, 0, 16);
}

void WebGPUDevice::mapPassTime(u32 slot) {
    pass_time_pool_[slot].pending = true;
    WGPUBufferMapCallbackInfo cb = WGPU_BUFFER_MAP_CALLBACK_INFO_INIT;
    cb.mode = WGPUCallbackMode_AllowSpontaneous;
    cb.callback = &WebGPUDevice::onPassTimeMapped;
    cb.userdata1 = this;
    cb.userdata2 = reinterpret_cast<void*>(static_cast<uintptr_t>(slot));
    wgpuBufferMapAsync(pass_time_pool_[slot].buf, WGPUMapMode_Read, 0, 16, cb);
}

void WebGPUDevice::onPassTimeMapped(WGPUMapAsyncStatus status, WGPUStringView /*message*/,
                                    void* userdata1, void* userdata2) {
    auto* self = static_cast<WebGPUDevice*>(userdata1);
    const u32 slot = static_cast<u32>(reinterpret_cast<uintptr_t>(userdata2));
    if (!self || slot >= self->pass_time_pool_.size()) return;
    PassTimeSlot& ps = self->pass_time_pool_[slot];
    if (status == WGPUMapAsyncStatus_Success && ps.buf) {
        const auto* ts = static_cast<const u64*>(wgpuBufferGetConstMappedRange(ps.buf, 0, 16));
        if (ts && ts[1] >= ts[0]) self->pass_time_results_[ps.tag] = ts[1] - ts[0];
        wgpuBufferUnmap(ps.buf);
    }
    ps.pending = false;
}

void WebGPUDevice::onGpuTimeMapped(WGPUMapAsyncStatus status, WGPUStringView /*message*/,
                                   void* userdata1, void* userdata2) {
    auto* self = static_cast<WebGPUDevice*>(userdata1);
    const u32 slot = static_cast<u32>(reinterpret_cast<uintptr_t>(userdata2));
    if (!self || slot >= kGpuTimeRing) return;
    WGPUBuffer buf = self->gpu_time_ring_[slot].buf;
    const u32 passes = self->gpu_time_ring_[slot].passes;
    if (status == WGPUMapAsyncStatus_Success && buf) {
        const auto* ts = static_cast<const u64*>(wgpuBufferGetConstMappedRange(buf, 0, 16ull * passes));
        // The span is the sum of its passes; a pair that ran backwards (a timestamp reset) counts for nothing.
        u64 total = 0;
        for (u32 i = 0; ts && i < passes; ++i) {
            if (ts[2 * i + 1] >= ts[2 * i]) total += ts[2 * i + 1] - ts[2 * i];
        }
        // Cap the FIFO so a stalled consumer can't grow it without bound.
        if (ts && self->gpu_time_results_.size() < 16) self->gpu_time_results_.push_back(total);
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


// =============================================================================
// Compute
// =============================================================================

namespace {
/// Bytes a texel takes in the formats a compute shader can write, 0 for the rest.
u32 storageTexelBytes(WGPUTextureFormat format) {
    switch (format) {
    case WGPUTextureFormat_RGBA8Unorm:
    case WGPUTextureFormat_BGRA8Unorm:
    case WGPUTextureFormat_RGBA8UnormSrgb: return 4;
    case WGPUTextureFormat_RGBA16Float:    return 8;
    case WGPUTextureFormat_RGBA32Float:    return 16;
    default:                               return 0;
    }
}

constexpr u32 kMaxComputeBindings = 16;
constexpr u32 kMaxWorkgroupsPerDimension = 65535;
}  // namespace

bool WebGPUDevice::backendCreateCompute(u32 id, const GfxComputeSource& source, std::string* outLog) {
    if (source.language != GfxShaderLanguage::WGSL || !source.source) {
        if (outLog) *outLog = "WebGPUDevice compiles WGSL only";
        return false;
    }
    if (!device_) {
        if (outLog) *outLog = "no WGPUDevice";
        return false;
    }
    WGPUShaderSourceWGSL wgsl{};
    wgsl.chain.sType = WGPUSType_ShaderSourceWGSL;
    wgsl.code = sv(source.source);
    WGPUShaderModuleDescriptor md{};
    md.nextInChain = &wgsl.chain;
    WGPUShaderModule module = wgpuDeviceCreateShaderModule(device_, &md);
    if (!module) {
        if (outLog) *outLog = "shader module creation failed";
        return false;
    }
    ComputeRec rec;
    rec.module = module;
    rec.entry = source.entry && *source.entry ? source.entry : "main";
    computes_[id] = std::move(rec);
    return true;
}

void WebGPUDevice::backendDeleteCompute(u32 id) {
    auto it = computes_.find(id);
    if (it == computes_.end()) return;
    for (auto& [key, pipeline] : it->second.pipelines) {
        if (pipeline) wgpuComputePipelineRelease(pipeline);
    }
    if (it->second.module) wgpuShaderModuleRelease(it->second.module);
    computes_.erase(it);
}

bool WebGPUDevice::backendDispatchCompute(u32 id, const GfxComputeBinding* bindings, u32 bindingCount,
                                          u32 groupsX, u32 groupsY, u32 groupsZ) {
    if (inPass()) {
        ES_LOG_ERROR("WebGPUDevice::dispatchCompute: must be called outside a render pass");
        return false;
    }
    auto program = computes_.find(id);
    if (program == computes_.end() || !program->second.module) return false;
    if (groupsX > kMaxWorkgroupsPerDimension || groupsY > kMaxWorkgroupsPerDimension ||
        groupsZ > kMaxWorkgroupsPerDimension || bindingCount > kMaxComputeBindings) {
        ES_LOG_ERROR("WebGPUDevice::dispatchCompute: {}x{}x{} groups with {} bindings is over the limit",
                     groupsX, groupsY, groupsZ, bindingCount);
        return false;
    }

    WGPUBindGroupLayoutEntry layoutEntries[kMaxComputeBindings] = {};
    WGPUBindGroupEntry groupEntries[kMaxComputeBindings] = {};
    std::string key;
    for (u32 i = 0; i < bindingCount; ++i) {
        const GfxComputeBinding& b = bindings[i];
        WGPUBindGroupLayoutEntry& le = layoutEntries[i];
        WGPUBindGroupEntry& ge = groupEntries[i];
        le.binding = ge.binding = b.binding;
        le.visibility = WGPUShaderStage_Compute;
        key += std::to_string(b.binding) + "." + std::to_string(static_cast<u32>(b.kind));
        switch (b.kind) {
        case GfxComputeBinding::Kind::Uniform:
        case GfxComputeBinding::Kind::StorageRead:
        case GfxComputeBinding::Kind::Storage: {
            auto it = buffers_.find(static_cast<u32>(b.buffer));
            if (it == buffers_.end() || !it->second.buffer) {
                ES_LOG_ERROR("WebGPUDevice::dispatchCompute: binding {} names a buffer that is gone", b.binding);
                return false;
            }
            const bool uniform = b.kind == GfxComputeBinding::Kind::Uniform;
            if ((uniform && it->second.usage != GfxBufferUsage::Uniform) ||
                (!uniform && it->second.usage != GfxBufferUsage::Storage)) {
                ES_LOG_ERROR("WebGPUDevice::dispatchCompute: binding {} is bound as {} but the buffer was not made for it",
                             b.binding, uniform ? "a uniform" : "storage");
                return false;
            }
            le.buffer.type = uniform ? WGPUBufferBindingType_Uniform
                           : b.kind == GfxComputeBinding::Kind::StorageRead ? WGPUBufferBindingType_ReadOnlyStorage
                                                                           : WGPUBufferBindingType_Storage;
            ge.buffer = it->second.buffer;
            ge.offset = b.offset;
            const u32 whole = webgpu::alignedWriteSize(it->second.size);
            ge.size = b.size ? b.size : (whole > b.offset ? whole - b.offset : 0);
            break;
        }
        case GfxComputeBinding::Kind::Texture: {
            auto it = textures_.find(static_cast<u32>(b.texture));
            if (it == textures_.end() || !it->second.texture) {
                ES_LOG_ERROR("WebGPUDevice::dispatchCompute: binding {} names a texture that is gone", b.binding);
                return false;
            }
            const WGPUTextureFormat f = it->second.format;
            le.texture.sampleType = isDepthFormat(f) ? WGPUTextureSampleType_Depth
                                  : f == WGPUTextureFormat_RGBA32Float ? WGPUTextureSampleType_UnfilterableFloat
                                                                       : WGPUTextureSampleType_Float;
            le.texture.viewDimension = WGPUTextureViewDimension_2D;
            ge.textureView = it->second.sampleView;
            key += "." + std::to_string(static_cast<u32>(le.texture.sampleType));
            break;
        }
        case GfxComputeBinding::Kind::DepthTexture: {
            auto it = textures_.find(static_cast<u32>(b.texture));
            const TextureRec* rec = (it != textures_.end() && it->second.texture && isDepthFormat(it->second.format)) ? &it->second : nullptr;
            if (!rec) {
                ensureDummies();
                rec = &dummy_depth_texture_;
            }
            le.texture.sampleType = WGPUTextureSampleType_Depth;
            le.texture.viewDimension = WGPUTextureViewDimension_2D;
            ge.textureView = rec->sampleView;
            break;
        }
        case GfxComputeBinding::Kind::StorageTexture: {
            auto it = textures_.find(static_cast<u32>(b.texture));
            if (it == textures_.end() || !it->second.texture) {
                ES_LOG_ERROR("WebGPUDevice::dispatchCompute: binding {} names a texture that is gone", b.binding);
                return false;
            }
            if (!it->second.storage) {
                ES_LOG_ERROR("WebGPUDevice::dispatchCompute: binding {} is a storage texture but the texture was not made with storage", b.binding);
                return false;
            }
            le.storageTexture.access = WGPUStorageTextureAccess_WriteOnly;
            le.storageTexture.format = it->second.format;
            le.storageTexture.viewDimension = WGPUTextureViewDimension_2D;
            ge.textureView = it->second.view;
            key += "." + std::to_string(static_cast<u32>(it->second.format));
            break;
        }
        case GfxComputeBinding::Kind::Sampler:
            le.sampler.type = WGPUSamplerBindingType_Filtering;
            ge.sampler = samplerFor(packSamplerKey(b.filter, b.filter, TextureWrap::ClampToEdge, TextureWrap::ClampToEdge));
            break;
        }
        key += "/";
    }

    WGPUBindGroupLayout layout = nullptr;
    auto cachedLayout = compute_layouts_.find(key);
    if (cachedLayout != compute_layouts_.end()) {
        layout = cachedLayout->second;
    } else {
        WGPUBindGroupLayoutDescriptor bld{};
        bld.entryCount = bindingCount;
        bld.entries = layoutEntries;
        layout = wgpuDeviceCreateBindGroupLayout(device_, &bld);
        compute_layouts_[key] = layout;
    }
    if (!layout) return false;

    WGPUPipelineLayout pipelineLayout = nullptr;
    auto cachedPipelineLayout = compute_pipeline_layouts_.find(key);
    if (cachedPipelineLayout != compute_pipeline_layouts_.end()) {
        pipelineLayout = cachedPipelineLayout->second;
    } else {
        WGPUPipelineLayoutDescriptor pld{};
        pld.bindGroupLayoutCount = 1;
        pld.bindGroupLayouts = &layout;
        pipelineLayout = wgpuDeviceCreatePipelineLayout(device_, &pld);
        compute_pipeline_layouts_[key] = pipelineLayout;
    }
    if (!pipelineLayout) return false;

    WGPUComputePipeline pipeline = nullptr;
    auto cachedPipeline = program->second.pipelines.find(key);
    if (cachedPipeline != program->second.pipelines.end()) {
        pipeline = cachedPipeline->second;
    } else {
        WGPUComputePipelineDescriptor cpd = WGPU_COMPUTE_PIPELINE_DESCRIPTOR_INIT;
        cpd.layout = pipelineLayout;
        cpd.compute.module = program->second.module;
        cpd.compute.entryPoint = sv(program->second.entry.c_str());
        pipeline = wgpuDeviceCreateComputePipeline(device_, &cpd);
        program->second.pipelines[key] = pipeline;
    }
    if (!pipeline) return false;

    WGPUBindGroupDescriptor bgd{};
    bgd.layout = layout;
    bgd.entryCount = bindingCount;
    bgd.entries = groupEntries;
    WGPUBindGroup group = wgpuDeviceCreateBindGroup(device_, &bgd);
    if (!group) return false;

    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    WGPUComputePassDescriptor pd = WGPU_COMPUTE_PASS_DESCRIPTOR_INIT;
    const u32 passSlot = takePassTimeSlot();
    // A kernel is the frame's GPU time as much as a draw is. No render pass is open here to carry a span past its
    // end, so this one is resolved and counted before the call returns.
    const bool inSpan = passSlot == kNoPassSlot && spanTakesPass();
    WGPUPassTimestampWrites tw{};
    if (passSlot != kNoPassSlot || inSpan) {
        tw.querySet = timestamp_qset_;
        tw.beginningOfPassWriteIndex = 0;
        tw.endOfPassWriteIndex = 1;
        pd.timestampWrites = &tw;
    }
    WGPUComputePassEncoder pass = wgpuCommandEncoderBeginComputePass(encoder, &pd);
    wgpuComputePassEncoderSetPipeline(pass, pipeline);
    wgpuComputePassEncoderSetBindGroup(pass, 0, group, 0, nullptr);
    wgpuComputePassEncoderDispatchWorkgroups(pass, groupsX, groupsY, groupsZ);
    wgpuComputePassEncoderEnd(pass);
    wgpuComputePassEncoderRelease(pass);
    if (passSlot != kNoPassSlot) resolvePassTime(encoder, passSlot);
    if (inSpan) resolveSpanPass(encoder);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);
    if (passSlot != kNoPassSlot) mapPassTime(passSlot);
    wgpuBindGroupRelease(group);
    return true;
}

u32 WebGPUDevice::allocRawReadback(u32 w, u32 h, u32 bytesPerTexel, u32 tightBytes) {
    // A texture copy wants 256-byte rows; a buffer copy is one row of any multiple of four.
    const u32 padded = (h > 1 || bytesPerTexel != 1) ? ((w * bytesPerTexel + 255u) & ~255u) : tightBytes;
    WGPUBufferDescriptor bd{};
    bd.usage = WGPUBufferUsage_CopyDst | WGPUBufferUsage_MapRead;
    bd.size = static_cast<u64>(padded) * h;
    WGPUBuffer buffer = wgpuDeviceCreateBuffer(device_, &bd);
    if (!buffer) return 0;
    const u32 id = next_readback_id_++;
    ReadbackRec rec{buffer, w, h, padded, GfxReadbackStatus::Pending};
    rec.raw = true;
    rec.bytesPerTexel = bytesPerTexel;
    rec.tightBytes = tightBytes;
    readbacks_[id] = rec;
    return id;
}

ReadbackHandle WebGPUDevice::requestBufferReadback(BufferHandle buffer, u32 offsetBytes, u32 sizeBytes) {
    if (!isDeviceUsable() || !device_ || sizeBytes == 0 || (offsetBytes & 3u) || (sizeBytes & 3u)) {
        return ReadbackHandle::Invalid;
    }
    if (inPass()) {
        ES_LOG_ERROR("WebGPUDevice::requestBufferReadback: must be called outside a render pass");
        return ReadbackHandle::Invalid;
    }
    auto it = buffers_.find(static_cast<u32>(buffer));
    if (it == buffers_.end() || !it->second.buffer || it->second.usage != GfxBufferUsage::Storage ||
        static_cast<u64>(offsetBytes) + sizeBytes > webgpu::alignedWriteSize(it->second.size)) {
        return ReadbackHandle::Invalid;
    }
    // One row of sizeBytes bytes: width counts bytes, a texel is one.
    const u32 id = allocRawReadback(sizeBytes, 1, 1, sizeBytes);
    if (!id) return ReadbackHandle::Invalid;
    WGPUCommandEncoder encoder = wgpuDeviceCreateCommandEncoder(device_, nullptr);
    wgpuCommandEncoderCopyBufferToBuffer(encoder, it->second.buffer, offsetBytes, readbacks_[id].buffer, 0, sizeBytes);
    WGPUCommandBuffer commands = wgpuCommandEncoderFinish(encoder, nullptr);
    wgpuCommandEncoderRelease(encoder);
    wgpuQueueSubmit(queue_, 1, &commands);
    wgpuCommandBufferRelease(commands);
    mapReadback(id);
    return static_cast<ReadbackHandle>(id);
}

ReadbackHandle WebGPUDevice::requestTextureReadback(TextureHandle texture) {
    if (!isDeviceUsable() || !device_) return ReadbackHandle::Invalid;
    if (inPass()) {
        ES_LOG_ERROR("WebGPUDevice::requestTextureReadback: must be called outside a render pass");
        return ReadbackHandle::Invalid;
    }
    auto it = textures_.find(static_cast<u32>(texture));
    if (it == textures_.end() || !it->second.texture || it->second.samples > 1) return ReadbackHandle::Invalid;
    const u32 bpt = storageTexelBytes(it->second.format);
    if (bpt == 0) return ReadbackHandle::Invalid;
    const u32 w = it->second.width, h = it->second.height;
    const u32 id = allocRawReadback(w, h, bpt, w * h * bpt);
    if (!id) return ReadbackHandle::Invalid;
    submitReadbackCopy(id, it->second.texture);
    return static_cast<ReadbackHandle>(id);
}

}  // namespace esengine
