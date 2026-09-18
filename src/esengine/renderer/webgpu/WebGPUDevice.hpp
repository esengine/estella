// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUDevice.hpp
 * @brief   WebGPU (Dawn / emdawnwebgpu) backend for GfxDevice (REARCH_WGSL Phase 2).
 * @details The live render path: a canvas surface (configureSurface) with a
 *          companion depth-stencil texture, per-pass command encoding
 *          (beginRenderPass applies the RenderPassDesc load-ops on color AND
 *          depth-stencil; endRenderPass submits), lazy WGPURenderPipeline builds
 *          from the retained PipelineDesc + layout + shader modules — one variant
 *          per pass depth-stencil shape, since WebGPU validates that coupling —
 *          EXPLICIT bind-group layouts built from each program's binding masks
 *          (group 0 = UBO slots, group 1 = texture/sampler pairs per the
 *          WebGPUMappings unit→binding convention, with dummy backfill for
 *          declared-but-unbound bindings — GL's tolerance for unused
 *          declarations, which the dual-language emitter's uniform injection
 *          relies on), indexed/instanced draw recording, and an internal
 *          clear-triangle family that emulates region-scoped clears and
 *          mid-pass stencil resets (the two clears WebGPU load-ops cannot spell).
 *          The class stays null-device safe: constructed without a WGPUDevice it
 *          degrades every entry point to a logged no-op, so handle bookkeeping
 *          and the language gate are testable without an adapter.
 *
 *          Compiled only under ES_ENABLE_WEBGPU; never part of the GL build.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../rhi/GfxDevice.hpp"

#include <webgpu/webgpu.h>

#include <string>
#include <unordered_map>
#include <vector>

namespace esengine {

class WebGPUDevice final : public GfxDevice {
public:
    /** @brief Depth-stencil attachment shape of a pass — one WGPURenderPipeline
     *         per shape, since WebGPU validates a pipeline's depthStencil state
     *         against the pass it draws into (GL has no such coupling). */
    enum DsVariant : u32 { kDsNone = 0, kDsDepthOnly = 1, kDsDepthStencil = 2, kDsVariantCount = 3 };

    /** @brief Color attachment format of a pass — like DsVariant, WebGPU
     *         validates the pipeline's color target format against the pass, and
     *         BGRA is a DIFFERENT format from RGBA to that check even though both
     *         are 8-bit unorm: a surface is usually the former, a render target
     *         the latter, so they cannot share a slot. */
    enum ColorVariant : u32 {
        kColorRgba8 = 0, kColorBgra8 = 1, kColorSrgb8 = 2, kColorRgba16f = 3, kColorVariantCount = 4,
    };

    /** @brief Sample count of a pass — a third thing WebGPU validates a pipeline
     *         against, and the reason a multisampled scene needs its own variant
     *         of every pipeline that draws into it. One or {@link kMsaaSamples}. */
    enum SampleVariant : u32 { kSingleSample = 0, kMultiSample = 1, kSampleVariantCount = 2 };

    /** @brief The multisampled count this backend offers. WebGPU guarantees 1 and
     *         4 for every renderable format; nothing else is portable. */
    static constexpr u32 kMsaaSamples = 4;

    /** @brief Which variant slot a pass's colour format uses. Beside the enum
     *         because the two are one decision: a format that shares a slot with
     *         another is a pipeline handed to a pass that rejects it. */
    static u32 colorVariantOf(WGPUTextureFormat format);

    /** @brief @p device may be null for bookkeeping-only use (tests, bring-up).
     *  @param instance  The host's WGPUInstance to share. Web/emscripten passes
     *         null and the device creates its own (the emscripten singleton). A
     *         native shell that already built the instance to acquire the
     *         adapter/device passes it here so the surface is created on the SAME
     *         instance — native Dawn ties a surface to its creating instance. */
    /** @param adapter Native hosts pass theirs so the swapchain can ask the surface
     *                 which formats it supports; omitting it assumes RGBA8. */
    explicit WebGPUDevice(WGPUDevice device = nullptr, WGPUInstance instance = nullptr,
                          WGPUAdapter adapter = nullptr);
    ~WebGPUDevice() override;

    ClipDepthRange clipDepthRange() const override { return ClipDepthRange::ZeroToOne; }

    void init() override;
    void shutdown() override;

    // Device loss reaches this class from OUTSIDE it: WebGPU accepts a
    // device-lost callback only in the descriptor that creates the device, and
    // both hosts create theirs before handing it over. Hence these entry points.

    /** @brief Maps a WGPUDeviceLostReason to the backend-neutral reason. */
    static GfxDeviceLostReason reasonFromWgpu(u32 wgpuReason);

    /** @brief Routes the device's uncaptured-error callback; only fatal kinds become losses. */
    void reportUncapturedError(u32 wgpuErrorType, const char* message);

    bool pollDeviceLost() override;

    /** @brief Hands a replacement in for the next recovery attempt to take up. */
    bool provideReplacementDevice(void* nativeDevice) override {
        pending_device_ = static_cast<WGPUDevice>(nativeDevice);
        return pending_device_ != nullptr;
    }

    void setViewport(i32 x, i32 y, u32 w, u32 h) override;
    void clearStencil(i32 value) override;

    void setScissorTest(bool enabled) override;
    void setScissor(i32 x, i32 y, i32 w, i32 h) override;

    void setUniformBuffer(u32 slot, BufferHandle buffer) override;
    void setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) override;
    void setIndexBuffer(BufferHandle buffer) override;

    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;
    // Float-target rendering is a WebGPU core capability.
    bool supportsFloatTargets() override { return true; }
    u32 maxSamples() override;
    /** Colour resolves in the pass; depth is resolved by a pass of our own
     *  ({@link resolveDepthAttachment}), since WebGPU's depth attachment has no
     *  resolve target. Either way nothing above the RHI knows. */
    bool resolvesDepth() const override { return true; }
    /**
     * @brief How many samples a SURFACE pass draws with — a frame with no post
     *        chain draws straight to the backbuffer.
     * @details A WebGL canvas is created antialiased; a WebGPU surface texture
     *          never is, so the backbuffer gets a multisampled companion that
     *          resolves into it. The change lands on the next frame.
     */
    void setSurfaceSamples(u32 samples) override {
        surface_samples_ = samples > 1 ? kMsaaSamples : 1;
    }

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::WGSL;
    }

    /// WebGPU stores a texture from the top down.
    bool textureOriginTopLeft() const override { return true; }

    void setStencilReference(i32 reference) override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 indexByteOffset) override;
    void drawArrays(u32 firstVertex, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 indexByteOffset,
                               u32 instanceCount) override;

    void beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass() override;
    void resizeBackbuffer(u32 width, u32 height) override;

    ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) override;
    GfxReadbackStatus pollReadback(ReadbackHandle handle) override;
    bool takeReadback(ReadbackHandle handle, void* dest, usize destSize) override;
    void discardReadback(ReadbackHandle handle) override;

    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNs) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam param) override;

protected:
    void captureDeviceIdentity() override;
    bool recreateDevice() override;

    bool backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) override;
    void backendDeleteBuffer(u32 id) override;
    void backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) override;
    void backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) override;

    bool backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) override;
    bool backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                        const void* data, u32 byteLength, u32 mipLevels) override;
    /** A foreign surface (canvas, video frame) arrives as a WGPUTexture, never an integer. */
    bool backendAdoptTexture(u32, u32, const TextureDesc&) override { return false; }
    void backendDeleteTexture(u32 id) override;
    void backendMoveTexture(u32 into, u32 from) override;
    void backendUpdateTexture(u32 id, i32 x, i32 y, u32 width, u32 height,
                              const void* pixels, bool flipY) override;
    void backendSetTextureParams(u32 id, const TextureDesc& desc) override;
    void backendGenerateMipmaps(u32 id) override;

    bool backendCreateProgram(u32 id, const GfxShaderSource& source,
                              const GfxAttribBinding* bindings, u32 bindingCount,
                              std::string* outLog, GfxShaderStage* outFailedStage) override;
    void backendDeleteProgram(u32 id) override;
    // Programs bind through pipelines, uniforms through UBO bindings and blocks by
    // @group/@binding: the GL-shaped program state has nothing to reach here.
    void backendUseProgram(u32) override {}
    i32 backendUniformLocation(u32, const char*) override { return -1; }
    i32 backendAttribLocation(u32, const char*) override { return -1; }
    void backendSetUniform(i32, const GfxUniformValue&) override {}
    std::vector<GfxUniformInfo> backendActiveUniforms(u32) override { return {}; }
    u32 backendUniformBlockIndex(u32, const char*) override { return GFX_INVALID_UNIFORM_BLOCK; }
    void backendUniformBlockBinding(u32, u32, u32) override {}

    bool backendAcceptsVertexLayout(const VertexLayoutDesc& desc) override;
    void backendDeleteVertexLayout(u32) override {}
    void backendSetPipeline(u32 id, const PipelineDesc& desc) override;
    void backendInvalidatePipelineCache() override {}

    bool backendCreateFramebuffer(u32 id, const FramebufferDesc& desc) override;
    void backendDeleteFramebuffer(u32) override {}

    bool backendCreateTimerQuery(u32 id) override;
    u32 backendReadbackCount() const override { return static_cast<u32>(readbacks_.size()); }

public:
    // -------------------------------------------------------------------------
    // Bring-up introspection (tests / slice-2 plumbing)
    // -------------------------------------------------------------------------

    bool hasDevice() const { return device_ != nullptr; }

    /**
     * @brief Binds a canvas as the default render target (bring-up entry, not part
     *        of the GfxDevice interface). @p selector is a CSS selector the
     *        emscripten surface source resolves, e.g. "#canvas". The web build's
     *        surface source; a native Dawn build reaches the surface through the
     *        {@link NativeSurface} overload instead.
     */
#if defined(__EMSCRIPTEN__)
    bool configureSurface(const char* selector, u32 width, u32 height);
#endif

    /** The kind of native window a non-emscripten host draws into. */
    /** Linux is TWO kinds because a Linux desktop is two display servers, and
     *  which one a machine is running is not a build-time fact. */
    enum class NativeWindowKind { MetalLayer, AndroidWindow, Win32Hwnd, WaylandSurface, XlibWindow };

    /** A `CAMetalLayer*` / `ANativeWindow*` / `HWND` / `wl_surface*` for a
     *  native-C++ build; compiled out of the wasm build, where the host injects an
     *  already-built surface instead. */
    struct NativeSurface {
        NativeWindowKind kind;
        /** The window: an `HWND`, a `wl_surface*` — or, for Xlib, the `Window`
         *  XID, which is an integer and travels here as one. */
        void* handle;
        /** What the window belongs to, which the descriptor asks for beside it:
         *  the `HINSTANCE` on Win32, the `wl_display*` on Wayland, the `Display*`
         *  on Xlib. */
        void* instance = nullptr;
    };

#if !defined(__EMSCRIPTEN__)
    /** @brief Binds a native window as the render target; shares configureSwapchain
     *         with the web path. Native Dawn build only. */
    bool configureSurface(const NativeSurface& window, u32 width, u32 height);

    /** @brief Flips the swapchain to the display. The web path relies on the
     *         browser presenting the canvas after the frame callback; a native
     *         host must present the surface explicitly, once per frame after
     *         endRenderPass. No-op until a surface is configured. */
    void present();

#endif

    /**
     * @brief Whether bytes read back from the DEFAULT framebuffer are BGRA rather
     *        than RGBA.
     *
     * The format is the surface's choice (BGRA8 on Metal, RGBA8 on Vulkan), so
     * anyone writing an image has to ask rather than assume.
     */
    bool surfaceBytesAreBGRA() const;

    bool frameCaptureIsBGRA() const override { return surfaceBytesAreBGRA(); }

    /**
     * @brief The surface format the host says its canvas prefers.
     *
     * Only the page can answer it (`navigator.gpu.getPreferredCanvasFormat()`),
     * and configuring anything else costs a full-frame copy per present. Must be
     * set BEFORE the surface is configured.
     */
    void setPreferredSurfaceBGRA(bool bgra) { prefer_surface_bgra_ = bgra; }

    /**
     * @brief Configure the swapchain with CopySrc, so {@link captureNextFrame}
     *        can read it. Must be set BEFORE the surface is configured.
     *
     * Off by default: a surface is entitled not to support the usage, and every
     * shipped frame would pay for a check nobody asked for.
     */
    void setSurfaceReadback(bool enabled) { surface_readback_ = enabled; }

    /**
     * @brief Present as fast as the surface allows instead of waiting for the
     *        display. Set BEFORE the surface is configured; off by default.
     *
     * For MEASUREMENT only: under Fifo every frame reads as the refresh interval
     * or a multiple of one, and a cost quantised to the panel is not a cost.
     * Best effort — Mailbox, then Immediate, then Fifo.
     */
    void setPresentUncapped(bool enabled) { present_uncapped_ = enabled; }

    /**
     * @brief Copy the next completed frame's swapchain image into a readback.
     *
     * Books the copy; endFrame performs it, because the renderer gives the
     * swapchain image back there and every caller outside runs too late. This is
     * the whole reason the seam is virtual: a GL default framebuffer can be read
     * on demand, and this one cannot.
     *
     * Invalid without {@link setSurfaceReadback}, or with a capture in flight.
     */
    ReadbackHandle captureNextFrame(u32 w, u32 h) override;

    void endFrame() override;

private:
    /** Match the backbuffer's depth-stencil companion to @p width x @p height. */
    bool ensureSurfaceDepth(u32 width, u32 height);

    /**
     * @brief Takes up a replacement device: every object of the old one is released
     *        and the surface is re-made, leaving the registry to rebuild the rest.
     */
    bool adoptDevice(WGPUDevice device);

    /** A GL-style rect's y (origin bottom-left) in this pass' coordinates
     *  (origin top-left). See the definition. */
    i32 flipRectY(i32 y, i32 height) const;

    struct BufferRec {
        WGPUBuffer buffer = nullptr;
        u32 size = 0;
        GfxBufferUsage usage = GfxBufferUsage::Vertex;
    };
    struct TextureRec {
        WGPUTexture texture = nullptr;
        WGPUTextureView view = nullptr;  ///< Default full view, created with the texture.
        /// The view a SAMPLE binds. Depth-stencil textures cannot be sampled
        /// through an all-aspects view, so theirs is depth-only; for every other
        /// format this is `view` and is not released twice.
        WGPUTextureView sampleView = nullptr;
        u32 width = 0;
        u32 height = 0;
        WGPUTextureFormat format = WGPUTextureFormat_RGBA8Unorm;
        /// The RHI format the texture was created with — the layout an upload reads
        /// the caller's pixels in. WebGPU has no 3-channel format, so RGB8 sources
        /// land in an RGBA8 texture and `format` alone cannot size the source rows.
        GfxPixelFormat srcFormat = GfxPixelFormat::RGBA8;
        u8 samplerKey = 0;  ///< Packed filter/wrap params (sampler cache key).
        /// 1, or kMsaaSamples for an attachment drawn into and resolved out of.
        u32 samples = 1;
    };
    struct ProgramRec {
        WGPUShaderModule vertex = nullptr;
        WGPUShaderModule fragment = nullptr;
        /** @brief `@group(0/1) @binding(i)` masks scanned from the WGSL (both
         *         stages). They drive the program's EXPLICIT bind-group and
         *         pipeline layouts: group 0 = which UBO slots the program
         *         declares, group 1 = which texture/sampler bindings. Declared
         *         bindings with no bound resource are backfilled with dummies,
         *         so an unused declaration is as legal as in GLSL. */
        u32 group0Mask = 0;
        u32 group1Mask = 0;
        /// Which of group1Mask's bindings the VERTEX stage declares. A texture is
        /// fragment-visible by default here; one the vertex stage names has to say
        /// so, and the layout it produces is a different layout.
        u32 group1VertexMask = 0;
        /// Which of group1Mask's bindings are `texture_depth_2d`.
        u32 group1DepthMask = 0;
    };
    struct PipelineRec {
        /// Lazily built per pass shape: [(ds * kColorVariantCount + color) * kSampleVariantCount + samples].
        WGPURenderPipeline variants[static_cast<u32>(kDsVariantCount) * static_cast<u32>(kColorVariantCount)
                                    * static_cast<u32>(kSampleVariantCount)] = {};
    };
    struct ReadbackRec {
        WGPUBuffer buffer = nullptr;  ///< CopyDst|MapRead staging buffer.
        u32 width = 0;
        u32 height = 0;
        u32 paddedBytesPerRow = 0;  ///< Row stride in the buffer (256-aligned).
        GfxReadbackStatus status = GfxReadbackStatus::Pending;
    };

    /** @brief Logs a not-yet-implemented path once per entry point. */
    void stubOnce(const char* what);

    /** @brief (Re)configures the surface swapchain + companion depth-stencil
     *         at @p width x @p height (configureSurface's second half; also the
     *         resizeBackbuffer implementation). */
    bool configureSwapchain(u32 width, u32 height);

    /** @brief Builds (once) and returns the WGPURenderPipeline for a handle,
     *         in the variant matching the current pass's depth-stencil shape. */
    WGPURenderPipeline ensurePipeline(u32 id);

    WGPUBuffer makeBuffer(GfxBufferUsage usage, u32 size, const void* data);
    /** @brief A texture and its views; false with @p out untouched when creation fails. */
    bool makeTexture(const TextureDesc& desc, const void* pixels, TextureRec& out);
    void writeTexture(const TextureRec& rec, i32 x, i32 y, u32 width, u32 height,
                      const void* pixels, bool flipY);
    /** @brief Releases a texture's views and storage, dropping bind groups that name them. */
    void releaseTexture(TextureRec& rec);
    /** @brief Returns the cached explicit bind-group layout for a binding mask.
     *         Group 0 entries are uniform buffers at their slot; group 1 entries
     *         are texture_2d/sampler pairs per the WebGPUMappings unit→binding
     *         convention (engine units 0..7 at 0..7/8..15, material units 8..15
     *         at 16..23/24..31). */
    WGPUBindGroupLayout groupLayoutFor(u32 group, u32 mask, u32 depthMask = 0,
                                       u32 vertexMask = 0);
    /** @brief Returns the cached explicit pipeline layout for a program's masks.
     *         A program with group-1 bindings but an empty group 0 still gets a
     *         (zero-entry) group-0 layout, so group indices stay positional. */
    WGPUPipelineLayout pipelineLayoutFor(u32 group0Mask, u32 group1Mask, u32 group1DepthMask = 0,
                                        u32 group1VertexMask = 0);
    /** @brief Lazily creates the dummy backfill resources: a zeroed uniform
     *         buffer and a 1x1 white texture, standing in for declared-but-
     *         unbound bindings (GL reads an unbound block/unit without
     *         validation errors; here it reads zeros/white). */
    void ensureDummies();
    /** @brief (Re)creates the bind groups against the program's explicit
     *         layouts: group 0 = UBO slots, group 1 = texture units mapped
     *         through the unit→binding convention, sampler i carrying texture
     *         i's filter/wrap params (GL's combined texture+sampler state
     *         de-combined). Every declared binding gets an entry — bound
     *         resource or dummy — so the groups always match the layouts. */
    void flushBindGroup();
    /** @brief Returns the cached sampler for packed filter/wrap params. */
    WGPUSampler samplerFor(u8 key);
    /** @brief Builds (once) an internal clear pipeline: fullscreen triangle at
     *         z=1, color from the internal UBO. Keyed on which attachments it
     *         writes (color/depth/stencil masks) plus the pass DS shape. */
    WGPURenderPipeline ensureClearPipeline(bool color, bool depth, bool stencil);
    /** @brief Draws the internal clear triangle mid-pass. Restores scissor (when
     *         @p region is given), the user's stencil reference, and forces
     *         pipeline + bind groups to re-establish on the next user draw. */
    void drawInternalClear(bool color, bool depth, bool stencil,
                           const f32 rgba[4], i32 stencilValue, const RenderPassDesc* region);
    /** @brief True while inside beginRenderPass/endRenderPass. */
    bool inPass() const { return pass_ != nullptr; }

    WGPUDevice device_ = nullptr;
    WGPUQueue queue_ = nullptr;
    WGPUDevice pending_device_ = nullptr;  ///< Replacement a host handed over, not yet adopted.
    WGPUInstance instance_ = nullptr;
    WGPUAdapter adapter_ = nullptr;  ///< Native only, host-owned: surface capability queries.
    bool owns_instance_ = true;  ///< False when a native host injected its instance (don't release it).

    // Surface (the Default framebuffer target). The companion depth-stencil
    // texture mirrors the WebGL canvas's depth+stencil planes — engine stencil
    // masks and depth-tested draws target the backbuffer and expect them.
    WGPUSurface surface_ = nullptr;
    WGPUTextureFormat surface_format_ = WGPUTextureFormat_RGBA8Unorm;
    /** Whether the host's canvas prefers BGRA8 (see setPreferredSurfaceBGRA). */
    bool prefer_surface_bgra_ = false;
    /** Whether the surface was configured with CopySrc — see setSurfaceReadback. */
    bool surface_readback_ = false;
    /** Whether the surface should present unthrottled — see setPresentUncapped. */
    bool present_uncapped_ = false;
    /** The fastest mode this surface advertises, for setPresentUncapped. */
    WGPUPresentMode pickUncappedPresentMode() const;
    /** The pass being recorded draws to the surface, so a capture rides its encoder. */
    bool pass_is_surface_ = false;
    /** A booked capture was already copied by a pass; endFrame only maps it. */
    bool capture_copied_ = false;
    /** A capture booked by captureNextFrame, served by endFrame. 0 = none. */
    u32 capture_id_ = 0;
    u32 surface_width_ = 0;
    u32 surface_height_ = 0;
    /** The canvas the surface was made for, so a replacement device can re-make it. */
    std::string surface_selector_;
    WGPUTexture surface_depth_texture_ = nullptr;
    WGPUTextureView surface_depth_view_ = nullptr;

    // In-flight readbacks: staging buffers whose mapAsync callback flips status.
    std::unordered_map<u32, ReadbackRec> readbacks_;
    u32 next_readback_id_ = 1;

    /** @brief mapAsync completion: flips the readback's status by id (userdata2).
     *         A discarded/taken readback simply misses the lookup and no-ops. */
    static void onReadbackMapped(WGPUMapAsyncStatus status, WGPUStringView message,
                                 void* userdata1, void* userdata2);
    /** @brief Erases + releases a readback record (aborts a still-pending map). */
    void releaseReadback(u32 id);

    /** Frees everything the device owns, keeping the instance and surface shape. */
    void releaseDeviceObjects();
    /** A staging buffer + record with no copy submitted yet; 0 on failure. */
    u32 allocReadback(u32 w, u32 h);
    void submitReadbackCopy(u32 id, WGPUTexture source);
    void encodeReadbackCopy(WGPUCommandEncoder encoder, u32 id, WGPUTexture source);
    void mapReadback(u32 id);

    // Internal clear family (region-scoped clears + mid-pass clearStencil).
    // Explicit layout so ONE bind group serves every write-mask variant.
    std::unordered_map<u32, WGPURenderPipeline> clear_pipelines_;
    WGPUBindGroupLayout clear_bgl_ = nullptr;
    WGPUPipelineLayout clear_layout_ = nullptr;
    WGPUBindGroup clear_bind_group_ = nullptr;
    WGPUBuffer clear_color_buffer_ = nullptr;

    // Per-pass state.
    u32 pass_width_ = 0;   ///< Current pass target size (scissor-off rectangle).
    u32 pass_height_ = 0;
    WGPUTextureFormat pass_ds_format_ = WGPUTextureFormat_Undefined;
    WGPUTextureFormat pass_color_format_ = WGPUTextureFormat_RGBA8Unorm;
    /// Samples of the pass's colour attachment — what its pipelines must declare.
    u32 pass_samples_ = 1;
    /// The multisampled depth attachment of the pass being ended, and the
    /// single-sample texture it owes its contents to. Both 0 unless resolving.
    u32 pass_depth_msaa_ = 0;
    u32 pass_depth_resolve_ = 0;
    /// Samples the backbuffer is drawn with (see setSurfaceSamples).
    u32 surface_samples_ = 1;
    /// The multisampled companion the backbuffer resolves out of, and the depth
    /// beside it. Rebuilt whenever the surface size or sample count changes.
    WGPUTexture surface_msaa_texture_ = nullptr;
    WGPUTextureView surface_msaa_view_ = nullptr;
    u32 surface_msaa_width_ = 0;
    u32 surface_msaa_height_ = 0;
    u32 surface_msaa_samples_ = 0;
    /// Samples the backbuffer's depth companion was built with.
    u32 surface_depth_samples_ = 1;
    bool ensureSurfaceMsaa(u32 width, u32 height);

    /** @brief Copies sample 0 of a multisampled depth attachment into its
     *         single-sample twin, so an effect can sample scene depth on a
     *         multisampled target. WebGPU has no depth resolve of its own. */
    void resolveDepthAttachment(u32 msaaDepth, u32 resolveDepth);
    WGPURenderPipeline ensureDepthResolvePipeline(WGPUTextureFormat format);
    WGPUShaderModule depth_resolve_vs_ = nullptr;
    WGPUShaderModule depth_resolve_fs_ = nullptr;
    WGPUBindGroupLayout depth_resolve_bgl_ = nullptr;
    WGPUPipelineLayout depth_resolve_layout_ = nullptr;
    std::unordered_map<u32, WGPURenderPipeline> depth_resolve_pipelines_;
    /// What this pass draws INTO, so flushBindGroup can refuse to also sample it.
    /// 0 = none (the surface, which nothing can hold as a texture anyway).
    u32 pass_color_texture_ = 0;
    u32 pass_depth_texture_ = 0;
    WGPUCommandEncoder encoder_ = nullptr;
    WGPURenderPassEncoder pass_ = nullptr;
    void* surface_window_ = nullptr;        ///< Native window the surface was made for.
    u32 surface_depth_width_ = 0;           ///< Size the depth companion was built for.
    u32 surface_depth_height_ = 0;
    WGPUTexture frame_texture_ = nullptr;   ///< The frame's swapchain texture (released at endFrame).
    WGPUTextureView frame_view_ = nullptr;
    u32 bound_pipeline_ = 0;
    u32 bound_index_buffer_ = 0;
    i32 stencil_ref_ = 0;  ///< Last user-set reference (re-applied after internal quads).
    /// Nine: the eight the engine had, plus where a draw's objects start in the
    /// frame's record texture. WebGPU grants 12 uniform buffers a stage and
    /// WebGL2 grants 12 blocks a stage, so nine is inside both.
    static constexpr u32 kUniformSlots = 9;
    u32 uniform_slots_[kUniformSlots] = {};  ///< BufferHandle id per UBO binding slot.
    /// Engine units 0..7 (batch multi-texture) + material-param units 8..15
    /// (== webgpu::kGroup1TextureUnits, static_asserted in the .cpp).
    static constexpr u32 kTextureSlots = 16;
    u32 texture_slots_[kTextureSlots] = {};  ///< TextureHandle id per sampler unit.
    bool bind_group_dirty_ = true;
    WGPUBindGroup bind_group_ = nullptr;    ///< Currently bound group 0 (points INTO the cache; not owned).
    WGPUBindGroup texture_group_ = nullptr; ///< Currently bound group 1 (points INTO the cache; not owned).

    // Bind-group cache. WebGPU bind groups are immutable, so rebuilding one per
    // draw (release + create) is pure churn — a static scene rebuilds the same
    // groups every frame. Cache by exact binding contents (group + mask + the
    // WGPU resource pointers, in binding order): a hit means the identical
    // bindings were used before (bind_group_dirty_ is set on every binding
    // change, so the key always reflects the live state). Entries own live WGPU
    // objects, which internally ref their resources — but a DELETED resource's
    // entries must be evicted immediately (deleteBuffer/deleteTexture call
    // evictBindGroups): emscripten WGPU "pointers" are JS-table handle indices
    // that are reused right after release, so a new resource can inherit a dead
    // one's id and silently hit the dead one's cached group.
    struct BindGroupCacheEntry {
        u32 group;
        u32 mask;
        std::vector<u64> ids;   ///< WGPU resource pointers (buffers, or view+sampler), binding order.
        WGPUBindGroup bg;
    };
    static constexpr u32 kBindGroupCacheCap = 256;
    std::vector<BindGroupCacheEntry> bind_group_cache_;
    /// Reuse a cached group with these exact contents, else create + insert one.
    WGPUBindGroup cachedBindGroup(u32 group, u32 mask, const u64* ids, u32 idCount,
                                  const WGPUBindGroupDescriptor& desc);
    /// Drop every cached group referencing a dying resource id (see cache note).
    void evictBindGroups(u64 id);

    /// The single WriteBuffer call site. Its size must be a 4-byte multiple and the
    /// caller's allocation is only @p size bytes, so a short tail is staged through a
    /// zero-padded copy rather than over-read. @p offset must already be aligned.
    void writeBufferPadded(WGPUBuffer buffer, u32 offset, const void* data, u32 size);

    // GPU timing — the WebGPU analog of GLDevice's GL_TIME_ELAPSED timer, so the
    // profiler's gpuMs/gpuScopes populate on both backends. Active only when the
    // device has the timestamp-query feature; otherwise createTimerQuery returns 0
    // and timing stays off (unchanged behavior). The surface (present) pass writes
    // a begin/end timestamp; endRenderPass resolves them into a ring of readback
    // buffers mapped asynchronously, and getTimerQueryNs drains the elapsed ns into
    // the engine's GpuTimer (whose ring already tolerates a few frames of latency).
    bool timestamp_supported_ = false;
    bool timestamp_init_done_ = false;
    WGPUQuerySet timestamp_qset_ = nullptr;   ///< 2 slots: begin/end of the timed pass.
    WGPUBuffer timestamp_resolve_ = nullptr;  ///< QueryResolve target (16 bytes).
    static constexpr u32 kGpuTimeRing = 4;
    struct GpuTimeSlot { WGPUBuffer buf = nullptr; bool pending = false; };
    GpuTimeSlot gpu_time_ring_[kGpuTimeRing] = {};
    u32 gpu_time_next_ = 0;                ///< Round-robin cursor into the ring.
    u32 gpu_time_slot_ = kGpuTimeRing;     ///< Slot reserved for the in-flight timed pass (== kGpuTimeRing: none).
    bool pass_timed_ = false;              ///< Did the current pass attach timestampWrites?
    std::vector<u64> gpu_time_results_;    ///< Resolved elapsed-ns, FIFO, drained by getTimerQueryNs.
    void ensureTimestamps();               ///< Lazily create the query set + buffers (feature-gated).
    static void onGpuTimeMapped(WGPUMapAsyncStatus status, WGPUStringView message,
                                void* userdata1, void* userdata2);

    std::unordered_map<u8, WGPUSampler> samplers_;  ///< Keyed by packed filter/wrap params.

    // Explicit layouts, cached by binding mask (key = group << 32 | mask for
    // bind-group layouts, group1Mask << 32 | group0Mask for pipeline layouts).
    // Pipelines and bind groups share the cached objects, so group
    // compatibility holds by identity.
    std::unordered_map<u64, WGPUBindGroupLayout> group_layouts_;
    std::unordered_map<u64, WGPUPipelineLayout> pipeline_layouts_;
    // Backfill belongs to this backend, not to the registry: nothing above it can
    // name these, so they are made again lazily rather than recovered.
    BufferRec dummy_ubo_;         ///< Zeroed backfill for declared-but-unbound UBO slots.
    TextureRec dummy_texture_;    ///< 1x1 white backfill for declared-but-unbound units.
    /// The same for a depth unit: an RGBA8 dummy under a `sampleType = Depth`
    /// entry is a validation error, so a declared-but-unbound depth binding
    /// needs a depth texture to stand in.
    TextureRec dummy_depth_texture_;

    /** This device's objects by registry id. */
    std::unordered_map<u32, BufferRec> buffers_;
    std::unordered_map<u32, TextureRec> textures_;
    std::unordered_map<u32, ProgramRec> programs_;
    std::unordered_map<u32, PipelineRec> pipelines_;
    std::vector<std::string> stub_logged_;
};

}  // namespace esengine
