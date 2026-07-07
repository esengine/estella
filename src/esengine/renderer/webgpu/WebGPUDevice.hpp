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
 *          bind groups (group 0 = UBO slots, group 1 = texture/sampler pairs with
 *          a per-params sampler cache), indexed/instanced draw recording, and an
 *          internal clear-triangle family that emulates region-scoped clears and
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

#include "../GfxDevice.hpp"

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

    /** @brief @p device may be null for bookkeeping-only use (tests, bring-up). */
    explicit WebGPUDevice(WGPUDevice device = nullptr);
    ~WebGPUDevice() override;

    void init() override;
    void shutdown() override;

    void setViewport(i32 x, i32 y, u32 w, u32 h) override;
    void clearStencil(i32 value) override;

    void setScissorTest(bool enabled) override;
    void setScissor(i32 x, i32 y, i32 w, i32 h) override;

    BufferHandle createBuffer(const BufferDesc& desc, const void* initialData) override;
    void deleteBuffer(BufferHandle buffer) override;
    void updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes) override;
    void resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data) override;
    void setUniformBuffer(u32 slot, BufferHandle buffer) override;

    VertexLayoutHandle createVertexLayout(const VertexLayoutDesc& desc) override;
    void deleteVertexLayout(VertexLayoutHandle layout) override;
    void setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) override;
    void setIndexBuffer(BufferHandle buffer) override;

    TextureHandle createTexture(const TextureDesc& desc, const void* pixels) override;
    TextureHandle createCompressedTexture(const TextureDesc& desc, GfxCompressedFormat format,
                                          const void* data, u32 byteLength) override;
    TextureHandle importExternalTexture(u32 nativeId, const TextureDesc& desc) override;
    void deleteTexture(TextureHandle texture) override;
    void updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                       const void* pixels, bool flipY) override;
    void setTextureParams(TextureHandle texture, TextureFilter minFilter, TextureFilter magFilter,
                          TextureWrap wrapS, TextureWrap wrapT) override;
    void generateMipmaps(TextureHandle texture) override;
    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::WGSL;
    }
    ShaderHandle createProgram(const GfxShaderSource& source,
                               const GfxAttribBinding* bindings, u32 bindingCount,
                               std::string* outLog, GfxShaderStage* outFailedStage) override;
    void deleteProgram(ShaderHandle program) override;
    void useProgram(ShaderHandle program) override;
    i32 getUniformLocation(ShaderHandle program, const char* name) override;
    i32 getAttribLocation(ShaderHandle program, const char* name) override;
    void setUniform1i(i32 location, i32 value) override;
    void setUniform1f(i32 location, f32 value) override;
    void setUniform2f(i32 location, f32 x, f32 y) override;
    void setUniform3f(i32 location, f32 x, f32 y, f32 z) override;
    void setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w) override;
    void setUniformMat3(i32 location, const f32* value) override;
    void setUniformMat4(i32 location, const f32* value) override;
    std::vector<GfxUniformInfo> getActiveUniforms(ShaderHandle program) override;

    u32 getUniformBlockIndex(ShaderHandle program, const char* blockName) override;
    void uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint) override;

    PipelineHandle createPipeline(const PipelineDesc& desc) override;
    void setPipeline(PipelineHandle pipeline) override;
    void setStencilReference(i32 reference) override;
    void invalidatePipelineCache() override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 indexByteOffset) override;
    void drawArrays(u32 firstVertex, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 indexByteOffset,
                               u32 instanceCount) override;

    FramebufferHandle createFramebuffer(const FramebufferDesc& desc) override;
    void deleteFramebuffer(FramebufferHandle framebuffer) override;
    void beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass() override;

    void readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) override;

    u32 createTimerQuery() override;
    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNs) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam param) override;

    // -------------------------------------------------------------------------
    // Bring-up introspection (tests / slice-2 plumbing)
    // -------------------------------------------------------------------------

    bool hasDevice() const { return device_ != nullptr; }

    /**
     * @brief Binds a canvas as the default render target (bring-up entry, not part
     *        of the GfxDevice interface). @p selector is a CSS selector the
     *        emscripten surface source resolves, e.g. "#canvas".
     */
    bool configureSurface(const char* selector, u32 width, u32 height);
    usize bufferCount() const { return buffers_.size(); }
    usize textureCount() const { return textures_.size(); }
    usize layoutCount() const { return layouts_.size(); }
    usize pipelineDescCount() const { return pipelines_.size(); }
    const VertexLayoutDesc* layoutDesc(VertexLayoutHandle handle) const;
    const PipelineDesc* pipelineDesc(PipelineHandle handle) const;

private:
    struct BufferRec {
        WGPUBuffer buffer = nullptr;
        u32 size = 0;
        GfxBufferUsage usage = GfxBufferUsage::Vertex;
    };
    struct TextureRec {
        WGPUTexture texture = nullptr;
        WGPUTextureView view = nullptr;  ///< Default full view, created with the texture.
        u32 width = 0;
        u32 height = 0;
        WGPUTextureFormat format = WGPUTextureFormat_RGBA8Unorm;
        u8 samplerKey = 0;  ///< Packed filter/wrap params (sampler cache key).
    };
    struct ProgramRec {
        WGPUShaderModule vertex = nullptr;
        WGPUShaderModule fragment = nullptr;
        /** @brief `@group(0/1) @binding(i)` masks scanned from the WGSL (both
         *         stages). Bind groups must match a pipeline's auto layout
         *         exactly, so the device filters its bound state through these:
         *         group 0 = which UBO slots the program declares, group 1 =
         *         which texture/sampler bindings. Zero group-1 mask means the
         *         program must never have the texture group set at all. */
        u32 group0Mask = 0;
        u32 group1Mask = 0;
    };
    struct PipelineRec {
        PipelineDesc desc;
        WGPURenderPipeline variants[kDsVariantCount] = {};  ///< Lazily built per pass DS shape.
    };
    struct FramebufferRec {
        u32 color0 = 0;        ///< TextureHandle id of the color attachment.
        u32 depthStencil = 0;  ///< TextureHandle id (0 = none).
    };

    /** @brief Logs a not-yet-implemented path once per entry point. */
    void stubOnce(const char* what);

    /** @brief Builds (once) and returns the WGPURenderPipeline for a handle,
     *         in the variant matching the current pass's depth-stencil shape. */
    WGPURenderPipeline ensurePipeline(u32 id);
    /** @brief (Re)creates the bind groups: group 0 = UBO slots, group 1 = the
     *         texture units (8 texture_2d at bindings 0..7 + their 8 samplers at
     *         bindings 8..15 — the WGSL twin convention for u_textures[8]; GL's
     *         combined texture+sampler state arrives de-combined, sampler i
     *         carrying texture i's filter/wrap params). Group 1 is set only when
     *         the pass bound any texture, so shaders without samplers (shape)
     *         never see a mismatched group. */
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
    WGPUInstance instance_ = nullptr;

    // Surface (the Default framebuffer target). The companion depth-stencil
    // texture mirrors the WebGL canvas's depth+stencil planes — engine stencil
    // masks and depth-tested draws target the backbuffer and expect them.
    WGPUSurface surface_ = nullptr;
    WGPUTextureFormat surface_format_ = WGPUTextureFormat_RGBA8Unorm;
    u32 surface_width_ = 0;
    u32 surface_height_ = 0;
    WGPUTexture surface_depth_texture_ = nullptr;
    WGPUTextureView surface_depth_view_ = nullptr;

    // Offscreen targets.
    std::unordered_map<u32, FramebufferRec> framebuffers_;
    u32 next_framebuffer_id_ = 1;

    // Internal clear family (region-scoped clears + mid-pass clearStencil).
    // Explicit layout so ONE bind group serves every write-mask variant.
    std::unordered_map<u32, WGPURenderPipeline> clear_pipelines_;
    WGPUBindGroupLayout clear_bgl_ = nullptr;
    WGPUPipelineLayout clear_layout_ = nullptr;
    WGPUBindGroup clear_bind_group_ = nullptr;
    BufferHandle clear_color_ubo_{};

    // Per-pass state.
    u32 pass_width_ = 0;   ///< Current pass target size (scissor-off rectangle).
    u32 pass_height_ = 0;
    WGPUTextureFormat pass_ds_format_ = WGPUTextureFormat_Undefined;
    WGPUCommandEncoder encoder_ = nullptr;
    WGPURenderPassEncoder pass_ = nullptr;
    WGPUTexture frame_texture_ = nullptr;   ///< Acquired surface texture (released at end).
    WGPUTextureView frame_view_ = nullptr;
    u32 current_pipeline_ = 0;
    u32 bound_index_buffer_ = 0;
    i32 stencil_ref_ = 0;  ///< Last user-set reference (re-applied after internal quads).
    static constexpr u32 kUniformSlots = 8;
    u32 uniform_slots_[kUniformSlots] = {};  ///< BufferHandle id per UBO binding slot.
    static constexpr u32 kTextureSlots = 8;
    u32 texture_slots_[kTextureSlots] = {};  ///< TextureHandle id per sampler unit.
    bool any_texture_bound_ = false;
    bool bind_group_dirty_ = true;
    WGPUBindGroup bind_group_ = nullptr;
    WGPUBindGroup texture_group_ = nullptr;
    std::unordered_map<u8, WGPUSampler> samplers_;  ///< Keyed by packed filter/wrap params.

    u32 next_id_ = 1;
    std::unordered_map<u32, BufferRec> buffers_;
    std::unordered_map<u32, TextureRec> textures_;
    std::unordered_map<u32, ProgramRec> programs_;
    std::unordered_map<u32, VertexLayoutDesc> layouts_;
    std::unordered_map<u32, PipelineRec> pipelines_;
    std::vector<std::string> stub_logged_;
};

}  // namespace esengine
