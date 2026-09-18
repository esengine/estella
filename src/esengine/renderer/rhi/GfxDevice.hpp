// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GfxDevice.hpp
 * @brief   Abstract graphics device interface
 * @details The render backend boundary (RHI). Upper-layer code (DrawList,
 *          RenderFrame, plugins) depends only on this interface: typed resource
 *          handles created from descriptors, immutable pipelines, and draw
 *          submission. Concrete backends (GLDevice today; WebGPU and native APIs
 *          later) own every API-specific concept behind it.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"
#include "../draw/BlendMode.hpp"
#include "./GfxContent.hpp"
#include "./GfxEnums.hpp"
#include "./GfxResourceRegistry.hpp"
#include "./PipelineState.hpp"

#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace esengine {

// =============================================================================
// GfxDevice Interface
// =============================================================================

/** @brief Sentinel returned by getUniformBlockIndex when a program has no such block (GL_INVALID_INDEX). */
static constexpr u32 GFX_INVALID_UNIFORM_BLOCK = 0xFFFFFFFFu;

/**
 * @brief GPU objects the device has created and not yet destroyed.
 *
 * @details ResourceManager reports a strict subset — render targets, the
 *          transient pool and plugin-created textures bypass it.
 * @note    Conserved: buffers, textures, programs, renderTargets. Caches that
 *          plateau: layouts, pipelines. `readbacks` is a queue, empty at rest.
 */
struct GfxLiveObjects {
    u32 buffers = 0;
    u32 textures = 0;
    u32 programs = 0;
    u32 layouts = 0;
    u32 pipelines = 0;
    u32 renderTargets = 0;
    u32 readbacks = 0;
};

/**
 * @brief Abstract graphics device interface
 *
 * @details The device owns its state: setPipeline binds an immutable pipeline and skips
 *          re-applying it when unchanged, so the renderer no longer micro-manages GL state
 *          through an external tracker. Per-draw dynamic state (scissor, stencil ref,
 *          textures) is applied directly; sorted+merged draws already group it coarsely.
 */
class GfxDevice {
public:
    virtual ~GfxDevice() = default;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /** @brief Initializes the graphics device */
    virtual void init() = 0;

    /** @brief Shuts down the graphics device */
    virtual void shutdown() = 0;

    // =========================================================================
    // Device Loss
    // =========================================================================

    // The state machine lives here, not in each backend: a backend only has to
    // DETECT its own kind of loss and call markDeviceLost. What "lost" then MEANS
    // — one report, one transition, submission stopped — stays identical.

    /** @brief Whether the device can be drawn to (see {@link GfxDeviceStatus}). */
    GfxDeviceStatus deviceStatus() const { return device_status_; }

    /** @brief Strictly Live: recovered but still-refilling counts as false. */
    bool isDeviceLive() const { return device_status_ == GfxDeviceStatus::Live; }

    /**
     * @brief Whether work may be submitted — the one check the guards make.
     * @details True while Recovering as well as Live. A device that has been
     *          rebuilt but whose textures are still being re-uploaded must draw:
     *          refusing would leave the screen frozen for the whole reload
     *          instead of filling in as the content lands.
     */
    bool isDeviceUsable() const {
        return device_status_ == GfxDeviceStatus::Live ||
               device_status_ == GfxDeviceStatus::Recovering;
    }

    /**
     * @brief Which generation of the device the live GPU objects belong to.
     * @details Bumped by every successful rebuild. A resource can record the
     *          generation it was realized on, so a diagnostic can say whether it
     *          truly came back — a non-zero handle only looks like it did.
     */
    u64 deviceGeneration() const { return device_generation_; }

    /** @brief The loss report, or null while the device is Live. */
    const GfxDeviceLostInfo* deviceLostInfo() const {
        return device_status_ == GfxDeviceStatus::Live ? nullptr : &device_info_;
    }

    /**
     * @brief Who this device is — available WHILE it is alive, unlike the loss report.
     * @details The identity was always captured at init; it was only reachable
     *          through a report that exists after a loss, so a healthy session
     *          could not say which GPU it was running on.
     */
    const GfxDeviceIdentity& deviceIdentity() const { return identity_; }

    /**
     * @brief The clip volume this device keeps along z.
     * @details Pure: a backend that does not state this is a backend whose
     *          projections silently mean something else, which is the bug this
     *          exists to make impossible. It is not read off `deviceIdentity`,
     *          whose backend name is a label rather than a capability.
     */
    virtual ClipDepthRange clipDepthRange() const = 0;

    /**
     * @brief Declares the device lost from outside the backend.
     * @details The host observes losses the backend cannot: a browser firing
     *          `webglcontextlost`, a shell told by the OS that the adapter is
     *          gone. Idempotent — the FIRST reason wins, because it is the one
     *          that explains the rest.
     */
    void notifyDeviceLost(GfxDeviceLostReason reason, std::string message = {},
                          std::string context = {}) {
        markDeviceLost(reason, std::move(message), std::move(context));
    }

    /**
     * @brief Rebuilds the device and every object it issued, behind the same handles.
     * @details Runs once per loss. Retained content is uploaded again and Sourced
     *          content becomes owed; the device turns Live when nothing is owed.
     * @return True when the device is usable (Recovering or Live).
     */
    bool recoverDevice();

    /** @brief Sourced objects that have storage again and are waiting for their contents. */
    std::vector<GfxOwedContent> owedContent() const { return registry_.owed(); }

    /**
     * @brief Gives up on one owed object's contents: it keeps its placeholder.
     * @details For a provider that no longer exists. Logged by the caller, never silent.
     */
    void forgoContent(const GfxOwedContent& owed);

    /**
     * @brief Settles one owed object whose provider wrote its contents itself.
     * @details For content the device cannot upload: a JS-side path that draws a
     *          canvas or a video frame straight into the native texture behind the
     *          handle. The provider says so, because the device never saw the write.
     */
    void restoreContent(const GfxOwedContent& owed);

    /**
     * @brief CPU bytes the device holds to put content back after a loss.
     * @details Retained content, plus the initial bytes of objects created while
     *          lost until the recovery uploads them. A cost the GPU figures never show.
     */
    usize retainedBytes() const { return retained_bytes_; }

    /**
     * @brief Warns once when retainedBytes() grows past `bytes`; 0 never warns.
     * @details Falling back under it re-arms the warning.
     */
    void setRetainedBudget(usize bytes) {
        retained_budget_ = bytes;
        over_retained_budget_ = false;
    }

    /**
     * @brief Gives up on the device: no further recovery will be attempted.
     * @details The clean end of a loss that could not be recovered from. The
     *          report is kept; what changes is that the renderer stops waiting.
     */
    void markDeviceDead() {
        if (device_status_ == GfxDeviceStatus::Dead) return;
        if (device_status_ == GfxDeviceStatus::Live) {
            markDeviceLost(GfxDeviceLostReason::Unknown, {}, {});
        }
        device_status_ = GfxDeviceStatus::Dead;
    }

    /**
     * @brief Takes a replacement device from the host, for backends that cannot
     *        make their own.
     * @details A WebGPU device is created by the page, so only the page can
     *          replace a lost one; GL rebuilds itself and has no use for this.
     *          The next recovery attempt picks up whatever was handed over.
     */
    virtual bool provideReplacementDevice(void* nativeDevice) {
        (void)nativeDevice;
        return false;
    }

    /**
     * @brief Pumps backend-native loss detection.
     * @details Backends whose loss arrives as a callback (WebGPU) or a status
     *          query (GL robustness) surface it here. Default: the backend
     *          cannot detect loss itself and depends entirely on
     *          notifyDeviceLost.
     * @return True when THIS call is the one that observed the loss.
     */
    virtual bool pollDeviceLost() { return false; }

    /**
     * @brief Opens a frame: polls for loss, and numbers the frame a report is stamped with.
     * @details The one place the renderer asks "may I draw at all". Everything a
     *          frame does afterwards — passes, post-process, readbacks — is
     *          predicated on this having returned true, which is why it is a
     *          single question at the top rather than a check per submission.
     * @return True when the frame may proceed (see {@link isDeviceUsable}).
     */
    bool beginDeviceFrame() {
        ++device_frame_;
        if (isDeviceUsable()) pollDeviceLost();
        return isDeviceUsable();
    }

    /**
     * @brief Called once per loss, with the completed report.
     * @details One observer, not a list: the renderer owns the device and fans
     *          the report out to whoever else needs it.
     */
    void setDeviceLostHandler(std::function<void(const GfxDeviceLostInfo&)> handler) {
        device_lost_handler_ = std::move(handler);
    }

    // =========================================================================
    // Viewport & Clear
    // =========================================================================

    /** @brief Sets the rendering viewport */
    virtual void setViewport(i32 x, i32 y, u32 w, u32 h) = 0;

    /**
     * @brief The viewport last set, so a pass that borrows the device can give it back.
     * @details Mirrored here because neither API this wraps reads it back cheaply, and
     *          a pass rendering elsewhere cannot recompute what to restore: a
     *          split-screen camera owns only part of the target. Set in setViewport.
     */
    struct Viewport { i32 x = 0, y = 0; u32 w = 0, h = 0; };
    const Viewport& viewport() const { return viewport_; }

    // Clears are pass-scoped: RenderPassDesc carries the load-ops AND their values
    // (color / stencil / optional region). There is no public clear entry point and
    // no sticky clear state a pass could inherit by accident.

    // =========================================================================
    // Dynamic Per-Draw State (deliberately outside the pipeline; see PipelineState.hpp)
    // =========================================================================

    /**
     * @brief Mid-pass stencil reset (the one clear that isn't a pass load-op).
     * @details The mask pass wipes the stencil attachment of the CURRENT target
     *          before rebuilding mask refs — it must not restart the pass (the
     *          scene may be rendering into a post-process capture). GL clears the
     *          attachment; a WebGPU backend emulates with a stencil-write quad.
     */
    virtual void clearStencil(i32 value) = 0;

    /** @brief Enables or disables scissor test */
    virtual void setScissorTest(bool enabled) = 0;

    /** @brief Sets the scissor rectangle */
    virtual void setScissor(i32 x, i32 y, i32 w, i32 h) = 0;

    // =========================================================================
    // Buffers
    // =========================================================================

    /**
     * @brief Creates a buffer with fixed capacity and optional initial contents.
     * @param content Who restores the contents after a loss.
     * @param initialData When non-null, `desc.size` bytes uploaded at creation.
     */
    BufferHandle createBuffer(const BufferDesc& desc, GfxContent content, const void* initialData);

    /** @brief Deletes a buffer */
    void deleteBuffer(BufferHandle buffer);

    /** @brief Updates a sub-range of a buffer; must fit within its capacity. */
    void updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes);

    /**
     * @brief Re-specifies a buffer's store with a new capacity, discarding prior contents.
     * @details The handle stays valid (streaming growth without re-wiring vertex
     *          layouts). `data` may be null to allocate uninitialized storage.
     */
    void resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data);

    /** @brief A buffer's description as it stands, or null for a handle that names none. */
    const BufferDesc* bufferDesc(BufferHandle buffer) const;

    /** @brief Binds a buffer to a uniform binding slot (the block index shaders are linked to). */
    virtual void setUniformBuffer(u32 slot, BufferHandle buffer) = 0;

    // =========================================================================
    // Vertex Input (layout in the pipeline, buffers bound per draw)
    // =========================================================================

    /** @brief Registers an immutable vertex layout; pipelines reference it by handle. */
    VertexLayoutHandle createVertexLayout(const VertexLayoutDesc& desc);

    /** @brief Deletes a vertex layout (no pipeline may reference it afterwards) */
    void deleteVertexLayout(VertexLayoutHandle layout);

    /** @brief A layout's description, or null for a handle that names none. */
    const VertexLayoutDesc* vertexLayoutDesc(VertexLayoutHandle layout) const;

    /**
     * @brief Binds a vertex buffer to a layout slot for subsequent draws.
     * @param offsetBytes Byte offset of element 0 — how an instanced draw rebases
     *        its per-instance stream (GLES3 has no baseInstance).
     */
    virtual void setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) = 0;

    /** @brief Binds the index buffer for subsequent indexed draws */
    virtual void setIndexBuffer(BufferHandle buffer) = 0;

    // =========================================================================
    // Textures
    // =========================================================================

    /**
     * @brief Creates a 2D texture; uploads `pixels` (tightly packed, desc-sized) when non-null.
     * @details Storage is allocated either way. `desc.mipmaps` generates mipmaps
     *          after the initial upload.
     */
    TextureHandle createTexture(const TextureDesc& desc, GfxContent content, const void* pixels);

    /**
     * @brief Creates a texture from pre-compressed GPU block data.
     * @details The caller must first confirm the backend supports `format`
     *          (see supportsCompressedFormat) and fall back to an uncompressed
     *          createTexture otherwise. Data is uploaded as-is; no CPU-side decode.
     * @param data All @p mipLevels concatenated, level 0 (base) first, each block-
     *             aligned (`gfxCompressedPyramidBytes`). Level i has size
     *             `max(1, width>>i) x max(1, height>>i)`.
     * @param mipLevels Number of mip levels present (1 = base only).
     */
    TextureHandle createCompressedTexture(const TextureDesc& desc, GfxContent content,
                                          GfxCompressedFormat format, const void* data,
                                          u32 byteLength, u32 mipLevels);

    /** @brief Puts compressed contents back behind an owed texture's handle. */
    bool restoreCompressedTexture(TextureHandle texture, GfxCompressedFormat format,
                                  const void* data, u32 byteLength, u32 mipLevels);

    /**
     * @brief Adopts a texture a host created with the device's own API (a JS-side WebGL upload).
     * @details The device owns it from here and, after a loss, recreates storage of
     *          `desc` behind the same handle for the provider in @p content to refill.
     */
    TextureHandle importExternalTexture(u32 nativeId, const TextureDesc& desc, GfxContent content);

    /** @brief Replaces the native texture behind @p texture with one the host created again. */
    bool restoreTextureFromNative(TextureHandle texture, u32 nativeId);

    /**
     * @brief Moves @p from's storage and description behind @p into, and ends @p from.
     * @details How a provider pays an owed texture: it loads the content the way it
     *          always does, into a texture of its own, and hands that over. @p into
     *          keeps its handle and content policy; @p from names nothing afterwards.
     */
    bool adoptTextureContent(TextureHandle into, TextureHandle from);

    /** @brief Deletes a texture */
    void deleteTexture(TextureHandle texture);

    /**
     * @brief Uploads pixels to a sub-rectangle of a texture (transfer format from its desc).
     * @param flipY Vertical flip on upload (WebGL upload state; no-op on native backends).
     */
    void updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                       const void* pixels, bool flipY);

    /** @brief Sets texture filtering and wrap parameters */
    void setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                          TextureWrap wrapS, TextureWrap wrapT);

    /** @brief Generates mipmaps for a texture */
    void generateMipmaps(TextureHandle texture);

    /** @brief A texture's description as it stands, or null for a handle that names none. */
    const TextureDesc* textureDesc(TextureHandle texture) const;

    /** @brief Activates a texture slot and binds a 2D texture */
    virtual void bindTexture(u32 slot, TextureHandle texture) = 0;

    /**
     * @brief Reports whether the backend can sample the given compressed format.
     * @details ETC2/EAC is always true on a WebGL2/GLES3 backend (core spec);
     *          ASTC and S3TC depend on driver extensions. Probe this before
     *          calling createCompressedTexture with a non-core format.
     */
    virtual bool supportsCompressedFormat(GfxCompressedFormat format) = 0;

    /**
     * @brief Whether RGBA16F color attachments are renderable.
     * @details WebGL2 gates float-target rendering behind EXT_color_buffer_float
     *          (sampling half-float textures is core); WebGPU always supports it.
     *          Probe this before creating an HDR framebuffer and fall back to
     *          SRGB8_ALPHA8/RGBA8.
     */
    virtual bool supportsFloatTargets() = 0;

    /**
     * @brief Most samples an offscreen colour attachment may carry; 1 = none.
     * @details The engine owns its own multisampling: a target the scene draws
     *          into is created with this many samples and resolves itself. Ask
     *          before requesting samples — a backend answering 1 has no MSAA to
     *          give, and a target that asks anyway would resolve from nothing.
     */
    virtual u32 maxSamples() = 0;

    // =========================================================================
    // Shader Programs
    // =========================================================================

    /**
     * @brief Compiles and links a GPU program from GLSL sources.
     * @param vertexSrc   Vertex shader GLSL source (null-terminated).
     * @param fragmentSrc Fragment shader GLSL source (null-terminated).
     * @param bindings    Attribute location bindings applied before link (may be null if count==0).
     * @param bindingCount Number of entries in @p bindings.
     * @param outLog      Optional; receives the driver info log on failure.
     * @param outFailedStage Optional; receives the stage that rejected the source.
     * @return The linked program handle, or Invalid on failure.
     */
    ShaderHandle createProgram(const GfxShaderSource& source,
                               const GfxAttribBinding* bindings, u32 bindingCount,
                               std::string* outLog, GfxShaderStage* outFailedStage);

    /** @brief Whether this backend compiles @p language (GL: GLSL ES 300; WebGPU: WGSL). */
    virtual bool supportsShaderLanguage(GfxShaderLanguage language) const = 0;

    /**
     * @brief Whether texel (0,0) of a rendered texture is its TOP-left corner.
     *
     * @details GL stores a framebuffer bottom-up and WebGPU top-down, so one geometry
     *          through one matrix lands in opposite rows. A shader sampling a target
     *          this frame rendered cannot ask — one source serves both backends — so
     *          the answer travels as data.
     */
    virtual bool textureOriginTopLeft() const = 0;

    /** @brief Deletes a shader program */
    void deleteProgram(ShaderHandle program);

    /**
     * @brief Binds a program directly, for setup-time uniform seeding.
     * @details Per-frame rendering binds programs through setPipeline.
     */
    void useProgram(ShaderHandle program);

    /**
     * @brief Gets a uniform location by name, -1 when the linked program has none.
     * @details The location belongs to the device, not the backend: it stays valid
     *          across a relink, and the value last set through it is set again.
     */
    i32 getUniformLocation(ShaderHandle program, const char* name);

    /** @brief Gets a vertex attribute location by name (-1 if not found) */
    i32 getAttribLocation(ShaderHandle program, const char* name);

    /** @brief Sets an integer uniform of the bound program */
    void setUniform1i(i32 location, i32 value);

    /** @brief Sets a float uniform */
    void setUniform1f(i32 location, f32 value);

    /** @brief Sets a vec2 uniform */
    void setUniform2f(i32 location, f32 x, f32 y);

    /** @brief Sets a vec3 uniform */
    void setUniform3f(i32 location, f32 x, f32 y, f32 z);

    /** @brief Sets a vec4 uniform */
    void setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w);

    /** @brief Sets a mat3 uniform */
    void setUniformMat3(i32 location, const f32* data);

    /** @brief Sets a mat4 uniform */
    void setUniformMat4(i32 location, const f32* data);

    /** @brief Enumerates all active uniforms of a linked shader program */
    std::vector<GfxUniformInfo> getActiveUniforms(ShaderHandle program);

    /** @brief Returns a program's uniform-block index by name, or GFX_INVALID_UNIFORM_BLOCK if absent. */
    u32 getUniformBlockIndex(ShaderHandle program, const char* name);

    /** @brief Links a program's uniform block to an indexed binding slot. */
    void uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint);

    // =========================================================================
    // Pipeline State (immutable "how to draw"; see PipelineState.hpp)
    // =========================================================================

    /** @brief Resolves a pipeline description to a cached handle (creating it on first use). */
    PipelineHandle createPipeline(const PipelineDesc& desc);

    /** @brief A pipeline's description, or null for a handle that names none. */
    const PipelineDesc* pipelineDesc(PipelineHandle handle) const;

    /** @brief Binds a pipeline: applies its program, blend, depth, stencil compare/op and culling. */
    void setPipeline(PipelineHandle handle);

    /** @brief Sets the dynamic stencil reference for the bound pipeline's stencil mode (no-op if Off). */
    virtual void setStencilReference(i32 ref) = 0;

    /**
     * @brief Forces the next setPipeline to re-apply, dropping the cached current pipeline.
     * @details Call at the start of a render phase (frame flush, immediate-draw begin) so a
     *          pipeline left bound by a prior phase — or by a direct-state path like custom
     *          geometry — is not mistaken for the current one.
     */
    void invalidatePipelineCache();

    // =========================================================================
    // Draw Calls
    // =========================================================================

    /** @brief Draws indexed triangles */
    virtual void drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) = 0;

    /** @brief Draws non-indexed triangles */
    virtual void drawArrays(u32 first, u32 vertexCount) = 0;

    /** @brief Draws indexed triangles with instancing */
    virtual void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) = 0;

    // =========================================================================
    // Framebuffers
    // =========================================================================

    /**
     * @brief Creates a framebuffer from its attachments and validates completeness.
     * @return The framebuffer handle, or Default (0) when incomplete — the default
     *         framebuffer can never be created, so 0 unambiguously means failure.
     */
    FramebufferHandle createFramebuffer(const FramebufferDesc& desc);

    /** @brief Deletes a framebuffer (its attachment textures are owned by the caller) */
    void deleteFramebuffer(FramebufferHandle framebuffer);

    /** @brief A framebuffer's description, or null for Default and unknown handles. */
    const FramebufferDesc* framebufferDesc(FramebufferHandle framebuffer) const;

    // =========================================================================
    // Render Pass
    // =========================================================================

    /**
     * @brief Targets a framebuffer for subsequent draws and applies the pass's clears.
     * @details Beginning a pass while another is open retargets directly (the GL
     *          model has no explicit pass object); endRenderPass returns to the
     *          backbuffer. A WebGPU backend maps this to real pass boundaries.
     */
    virtual void beginRenderPass(const RenderPassDesc& desc) = 0;

    /** @brief Ends the current pass, restoring the default framebuffer */
    virtual void endRenderPass() = 0;

    /**
     * @brief The frame is over — everything drawn for it has been submitted.
     * @details A backend that borrows the swapchain image for the duration of a
     *          frame gives it back here (WebGPU hands one out per frame and takes
     *          it back at present), which is why the boundary has to be stated
     *          rather than inferred from the last pass: a frame may open several
     *          passes on the swapchain — a post-process blit over the captured
     *          scene, a second camera — and each of those is NOT the end.
     *          Default: nothing to do (GL presents through the platform).
     */
    virtual void endFrame() {}

    /**
     * @brief Resizes the default backbuffer to the viewport size.
     * @details GL tracks the canvas drawing buffer implicitly (default no-op);
     *          WebGPU swapchains are fixed-size, so its backend reconfigures
     *          the surface + companion depth-stencil when the size changes.
     *          Called once per frame with the current viewport (cheap when
     *          unchanged); must not be called inside a render pass.
     */
    virtual void resizeBackbuffer(u32 width, u32 height) {
        (void)width;
        (void)height;
    }

    // =========================================================================
    // Readback (asynchronous seam — the one backend-neutral pixel-return path)
    // =========================================================================

    /**
     * @brief Requests an RGBA8 readback of a framebuffer's color attachment.
     * @details Backend-neutral contract: GL reads synchronously (the first poll
     *          reports Ready); WebGPU records a texture→staging copy and resolves
     *          when the buffer map lands, so callers must poll across event-loop
     *          turns. Must be called OUTSIDE a render pass. Rows land bottom-up
     *          (the GL convention every capture consumer assumes). The WebGPU
     *          backend reads offscreen targets only — the surface texture is not
     *          copyable — so a Default-target request returns Invalid there.
     * @return A handle to poll, or Invalid when the request cannot be issued.
     */
    virtual ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) = 0;

    /** @brief The state of an in-flight readback; pumps backend completion events.
     *         A Failed readback is released by the poll that reported it. */
    virtual GfxReadbackStatus pollReadback(ReadbackHandle handle) = 0;

    /**
     * @brief Copies a Ready readback's pixels (w*h*4 bytes) into @p dest and releases it.
     * @return False when the handle is unknown, still Pending, or @p destSize is short —
     *         a Pending readback stays alive.
     */
    virtual bool takeReadback(ReadbackHandle handle, void* dest, usize destSize) = 0;

    /** @brief Abandons a readback (any state); its resources are released. */
    virtual void discardReadback(ReadbackHandle handle) = 0;

    /**
     * @brief Requests the next completed frame's on-screen image as a readback.
     * @details One question, whichever backend answers it: a default framebuffer
     *          is read directly, a swapchain image only inside its own frame.
     *          Poll and take it like any other readback.
     */
    virtual ReadbackHandle captureNextFrame(u32 w, u32 h) {
        return requestReadback(FramebufferHandle::Default, w, h);
    }

    /** @brief Whether a captured frame's bytes are BGRA rather than RGBA — the
     *         surface's choice on a backend that has one, and never GL's. */
    virtual bool frameCaptureIsBGRA() const { return false; }

    // =========================================================================
    // GPU Timing (optional; EXT_disjoint_timer_query on WebGL2)
    // =========================================================================

    /** @brief Creates a GPU elapsed-time query, or 0 when the backend cannot time GPU work. */
    u32 createTimerQuery();

    /** @brief Starts timing GPU work into a query; one query may be active at a time. */
    virtual void beginTimerQuery(u32 query) = 0;

    /** @brief Stops the active timer query */
    virtual void endTimerQuery() = 0;

    /**
     * @brief True when GPU timing was disturbed since the last check.
     * @details In-flight query results are then meaningless and must be discarded.
     */
    virtual bool timerDisjoint() = 0;

    /** @brief Fetches a completed query's elapsed nanoseconds; false while still pending. */
    virtual bool getTimerQueryNs(u32 query, u64* outNanoseconds) = 0;

    // =========================================================================
    // Debug
    // =========================================================================

    /** @brief Enables or disables wireframe rendering (desktop only) */
    virtual void setWireframe(bool enabled) = 0;

    /** @brief Queries the last error */
    virtual u32 getError() = 0;

    /** @brief Queries a backend identification string (diagnostics) */
    virtual std::string getString(GfxStringName name) = 0;

    /** @brief Queries a backend integer capability/limit */
    virtual i32 getInt(GfxIntParam name) = 0;

    /** @brief GPU objects alive right now (see {@link GfxLiveObjects}), read off the registry. */
    GfxLiveObjects liveObjects() const;

    /**
     * @brief The backend's own name for the object behind `texture`, or 0.
     * @details For a host that writes the contents itself — a JS video frame or
     *          canvas going straight into the texture. It is only valid until the
     *          next device loss, which is why it is asked for at every write.
     */
    virtual u32 nativeTextureName(TextureHandle texture) const { (void)texture; return 0; }

protected:
    // =========================================================================
    // Backend primitives. `id` is the handle's value; the backend maps it to its
    // own object for the current generation and nothing else.
    // =========================================================================

    virtual bool backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) = 0;
    virtual void backendDeleteBuffer(u32 id) = 0;
    virtual void backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) = 0;
    virtual void backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) = 0;

    virtual bool backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) = 0;
    virtual bool backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                                const void* data, u32 byteLength, u32 mipLevels) = 0;
    /** @brief Takes over a native texture the host created; false when this backend cannot. */
    virtual bool backendAdoptTexture(u32 id, u32 nativeId, const TextureDesc& desc) = 0;
    virtual void backendDeleteTexture(u32 id) = 0;
    /** @brief Re-keys @p from's native texture under @p into; @p into holds none on entry. */
    virtual void backendMoveTexture(u32 into, u32 from) = 0;
    virtual void backendUpdateTexture(u32 id, i32 x, i32 y, u32 width, u32 height,
                                      const void* pixels, bool flipY) = 0;
    virtual void backendSetTextureParams(u32 id, const TextureDesc& desc) = 0;
    virtual void backendGenerateMipmaps(u32 id) = 0;

    virtual bool backendCreateProgram(u32 id, const GfxShaderSource& source,
                                      const GfxAttribBinding* bindings, u32 bindingCount,
                                      std::string* outLog, GfxShaderStage* outFailedStage) = 0;
    virtual void backendDeleteProgram(u32 id) = 0;
    virtual void backendUseProgram(u32 id) = 0;
    /** @brief The backend's own location this generation, -1 when absent. */
    virtual i32 backendUniformLocation(u32 program, const char* name) = 0;
    virtual i32 backendAttribLocation(u32 program, const char* name) = 0;
    virtual void backendSetUniform(i32 nativeLocation, const GfxUniformValue& value) = 0;
    virtual std::vector<GfxUniformInfo> backendActiveUniforms(u32 program) = 0;
    virtual u32 backendUniformBlockIndex(u32 program, const char* name) = 0;
    virtual void backendUniformBlockBinding(u32 program, u32 nativeBlockIndex, u32 bindingPoint) = 0;

    /** @brief False for a layout this backend has no way to express. */
    virtual bool backendAcceptsVertexLayout(const VertexLayoutDesc& desc) { (void)desc; return true; }
    /** @brief Drops what the backend derived from a layout (a GL VAO); the desc stays here. */
    virtual void backendDeleteVertexLayout(u32 id) = 0;
    virtual void backendSetPipeline(u32 id, const PipelineDesc& desc) = 0;
    virtual void backendInvalidatePipelineCache() = 0;

    virtual bool backendCreateFramebuffer(u32 id, const FramebufferDesc& desc) = 0;
    virtual void backendDeleteFramebuffer(u32 id) = 0;

    virtual bool backendCreateTimerQuery(u32 id) = 0;

    /** @brief Readbacks in flight, the one live object the registry does not hold. */
    virtual u32 backendReadbackCount() const = 0;

    /** @brief The pipeline most recently bound, whose program uniforms are set on. */
    PipelineHandle currentPipeline() const { return current_pipeline_; }
    /// Backends record what they were last handed; see @ref viewport.
    Viewport viewport_;

    /**
     * @brief Records who this backend is, so a later loss report can name it.
     * @details Called from init() while the backend still answers, and again
     *          after a recovery: a rebuilt device can be a DIFFERENT GPU, and a
     *          report naming the one that is gone sends the reader hunting the
     *          wrong hardware. Implementations call setDeviceIdentity.
     */
    virtual void captureDeviceIdentity() {}

    /**
     * @brief Backend half of {@link recoverDevice}: a working device again, with
     *        every id-to-native map and derived cache emptied.
     * @details The registry then rebuilds each object through the primitives above.
     *          Default: this backend cannot rebuild itself, so a loss is final.
     */
    virtual bool recreateDevice() { return false; }

    /** @brief Records the backend identity; see {@link captureDeviceIdentity}. */
    void setDeviceIdentity(std::string backend, std::string vendor,
                           std::string renderer, std::string version) {
        identity_.backend = std::move(backend);
        identity_.vendor = std::move(vendor);
        identity_.renderer = std::move(renderer);
        identity_.version = std::move(version);
    }

    /**
     * @brief The single transition into Lost. Backends call this on detection.
     * @details Idempotent: a lost device usually produces a burst of secondary
     *          failures, and the first reason is the one that explains them.
     * @return True when this call performed the transition.
     */
    bool markDeviceLost(GfxDeviceLostReason reason, std::string message = {},
                        std::string context = {});

    /**
     * @brief Release what only this backend can name, while the dead device is
     *        still the current one.
     * @details The window matters: on a lost device these releases are silent
     *          no-ops, whereas after the rebuild the same calls hand a NEW
     *          device objects belonging to the old one.
     */
    virtual void onDeviceLost() {}

private:
    /** @brief Builds every recorded object on the current device, in dependency order. */
    void realizeRegistry();
    void realizeProgramState(u32 id, GfxProgramRecord& record);
    /** @brief Recovering becomes Live once nothing is owed. */
    void settleRecovery();
    void payTexture(u32 id, GfxTextureRecord& record);
    void keepBytes(std::vector<u8>& slot, std::vector<u8> bytes);
    void dropBytes(std::vector<u8>& slot);
    std::vector<u8> takeBytes(std::vector<u8>& slot);
    void judgeRetainedBudget(usize grownBy);
    void eraseBuffer(u32 id);
    void eraseTexture(u32 id);
    i32 nativeUniformLocation(GfxProgramRecord& record, u32 id, i32 location);
    void setUniformValue(i32 location, const GfxUniformValue& value);

    GfxDeviceStatus device_status_ = GfxDeviceStatus::Live;
    GfxDeviceIdentity identity_;
    GfxDeviceLostInfo device_info_;
    u64 device_frame_ = 0;
    u64 device_generation_ = 0;
    std::function<void(const GfxDeviceLostInfo&)> device_lost_handler_;

    GfxResourceRegistry registry_;
    u32 owed_count_ = 0;
    usize retained_bytes_ = 0;
    usize retained_budget_ = 0;
    bool over_retained_budget_ = false;
    ShaderHandle current_program_ = ShaderHandle::Invalid;
    PipelineHandle current_pipeline_ = PipelineHandle::Invalid;
    /// Native uniform locations per program for the current generation; -2 = not asked yet.
    std::map<u32, std::vector<i32>> native_locations_;
};

}  // namespace esengine
