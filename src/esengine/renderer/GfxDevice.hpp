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

#include "../core/Types.hpp"
#include "BlendMode.hpp"
#include "GfxEnums.hpp"
#include "PipelineState.hpp"

#include <string>
#include <vector>

namespace esengine {

// =============================================================================
// GfxDevice Interface
// =============================================================================

/** @brief Sentinel returned by getUniformBlockIndex when a program has no such block (GL_INVALID_INDEX). */
static constexpr u32 GFX_INVALID_UNIFORM_BLOCK = 0xFFFFFFFFu;

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
    // Viewport & Clear
    // =========================================================================

    /** @brief Sets the rendering viewport */
    virtual void setViewport(i32 x, i32 y, u32 w, u32 h) = 0;

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
     * @param initialData When non-null, `desc.size` bytes uploaded at creation.
     */
    virtual BufferHandle createBuffer(const BufferDesc& desc, const void* initialData) = 0;

    /** @brief Deletes a buffer */
    virtual void deleteBuffer(BufferHandle buffer) = 0;

    /** @brief Updates a sub-range of a buffer; must fit within its capacity. */
    virtual void updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes) = 0;

    /**
     * @brief Re-specifies a buffer's store with a new capacity, discarding prior contents.
     * @details The handle stays valid (streaming growth without re-wiring vertex
     *          layouts). `data` may be null to allocate uninitialized storage.
     */
    virtual void resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data) = 0;

    /** @brief Binds a buffer to a uniform binding slot (the block index shaders are linked to). */
    virtual void setUniformBuffer(u32 slot, BufferHandle buffer) = 0;

    // =========================================================================
    // Vertex Input (layout in the pipeline, buffers bound per draw)
    // =========================================================================

    /** @brief Registers an immutable vertex layout; pipelines reference it by handle. */
    virtual VertexLayoutHandle createVertexLayout(const VertexLayoutDesc& desc) = 0;

    /** @brief Deletes a vertex layout (no pipeline may reference it afterwards) */
    virtual void deleteVertexLayout(VertexLayoutHandle layout) = 0;

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
    virtual TextureHandle createTexture(const TextureDesc& desc, const void* pixels) = 0;

    /**
     * @brief Creates a texture from pre-compressed GPU block data.
     * @details The caller must first confirm the backend supports `format`
     *          (see supportsCompressedFormat) and fall back to an uncompressed
     *          createTexture otherwise. Data is uploaded as-is; no CPU-side decode.
     */
    virtual TextureHandle createCompressedTexture(const TextureDesc& desc, GfxCompressedFormat format,
                                                  const void* data, u32 byteLength) = 0;

    /**
     * @brief Wraps a texture created outside the device (e.g. a JS-side WebGL upload).
     * @details Registers the metadata updates/binds need; ownership stays external,
     *          so the wrapper must not delete it.
     */
    virtual TextureHandle importExternalTexture(u32 nativeId, const TextureDesc& desc) = 0;

    /** @brief Deletes a texture */
    virtual void deleteTexture(TextureHandle texture) = 0;

    /**
     * @brief Uploads pixels to a sub-rectangle of a texture (transfer format from its desc).
     * @param flipY Vertical flip on upload (WebGL upload state; no-op on native backends).
     */
    virtual void updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                               const void* pixels, bool flipY) = 0;

    /** @brief Sets texture filtering and wrap parameters */
    virtual void setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                                  TextureWrap wrapS, TextureWrap wrapT) = 0;

    /** @brief Generates mipmaps for a texture */
    virtual void generateMipmaps(TextureHandle texture) = 0;

    /** @brief Activates a texture slot and binds a 2D texture */
    virtual void bindTexture(u32 slot, TextureHandle texture) = 0;

    /**
     * @brief Reports whether the backend can sample the given compressed format.
     * @details ETC2/EAC is always true on a WebGL2/GLES3 backend (core spec);
     *          ASTC and S3TC depend on driver extensions. Probe this before
     *          calling createCompressedTexture with a non-core format.
     */
    virtual bool supportsCompressedFormat(GfxCompressedFormat format) = 0;

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
    virtual ShaderHandle createProgram(const GfxShaderSource& source,
                                       const GfxAttribBinding* bindings, u32 bindingCount,
                                       std::string* outLog, GfxShaderStage* outFailedStage) = 0;

    /** @brief Whether this backend compiles @p language (GL: GLSL ES 300; WebGPU: WGSL). */
    virtual bool supportsShaderLanguage(GfxShaderLanguage language) const = 0;

    /** @brief Deletes a shader program */
    virtual void deleteProgram(ShaderHandle program) = 0;

    /**
     * @brief Binds a program directly, for setup-time uniform seeding.
     * @details Per-frame rendering binds programs through setPipeline.
     */
    virtual void useProgram(ShaderHandle program) = 0;

    /** @brief Gets a uniform location by name */
    virtual i32 getUniformLocation(ShaderHandle program, const char* name) = 0;

    /** @brief Gets a vertex attribute location by name (-1 if not found) */
    virtual i32 getAttribLocation(ShaderHandle program, const char* name) = 0;

    /** @brief Sets an integer uniform */
    virtual void setUniform1i(i32 location, i32 value) = 0;

    /** @brief Sets a float uniform */
    virtual void setUniform1f(i32 location, f32 value) = 0;

    /** @brief Sets a vec2 uniform */
    virtual void setUniform2f(i32 location, f32 x, f32 y) = 0;

    /** @brief Sets a vec3 uniform */
    virtual void setUniform3f(i32 location, f32 x, f32 y, f32 z) = 0;

    /** @brief Sets a vec4 uniform */
    virtual void setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w) = 0;

    /** @brief Sets a mat3 uniform */
    virtual void setUniformMat3(i32 location, const f32* data) = 0;

    /** @brief Sets a mat4 uniform */
    virtual void setUniformMat4(i32 location, const f32* data) = 0;

    /** @brief Enumerates all active uniforms of a linked shader program */
    virtual std::vector<GfxUniformInfo> getActiveUniforms(ShaderHandle program) = 0;

    /** @brief Returns a program's uniform-block index by name, or GFX_INVALID_UNIFORM_BLOCK if absent. */
    virtual u32 getUniformBlockIndex(ShaderHandle program, const char* name) = 0;

    /** @brief Links a program's uniform block to an indexed binding slot. */
    virtual void uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint) = 0;

    // =========================================================================
    // Pipeline State (immutable "how to draw"; see PipelineState.hpp)
    // =========================================================================

    /** @brief Resolves a pipeline description to a cached handle (creating it on first use). */
    virtual PipelineHandle createPipeline(const PipelineDesc& desc) = 0;

    /** @brief Binds a pipeline: applies its program, blend, depth, stencil compare/op and culling. */
    virtual void setPipeline(PipelineHandle handle) = 0;

    /** @brief Sets the dynamic stencil reference for the bound pipeline's stencil mode (no-op if Off). */
    virtual void setStencilReference(i32 ref) = 0;

    /**
     * @brief Forces the next setPipeline to re-apply, dropping the cached current pipeline.
     * @details Call at the start of a render phase (frame flush, immediate-draw begin) so a
     *          pipeline left bound by a prior phase — or by a direct-state path like custom
     *          geometry — is not mistaken for the current one.
     */
    virtual void invalidatePipelineCache() = 0;

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
    virtual FramebufferHandle createFramebuffer(const FramebufferDesc& desc) = 0;

    /** @brief Deletes a framebuffer (its attachment textures are owned by the caller) */
    virtual void deleteFramebuffer(FramebufferHandle framebuffer) = 0;

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

    // =========================================================================
    // Readback
    // =========================================================================

    /** @brief Reads pixels from the current framebuffer */
    virtual void readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) = 0;

    // =========================================================================
    // GPU Timing (optional; EXT_disjoint_timer_query on WebGL2)
    // =========================================================================

    /** @brief Creates a GPU elapsed-time query, or 0 when the backend cannot time GPU work. */
    virtual u32 createTimerQuery() = 0;

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
};

}  // namespace esengine
