// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUDevice.hpp
 * @brief   WebGPU (Dawn / emdawnwebgpu) backend skeleton for GfxDevice (REARCH_WGSL Phase 2).
 * @details Slice 1 implemented resource creation against the real Dawn C API;
 *          slice 2 adds the live render path: a canvas surface (configureSurface),
 *          per-pass command encoding (beginRenderPass acquires the surface texture
 *          and applies the RenderPassDesc load-ops; endRenderPass submits), lazy
 *          WGPURenderPipeline builds from the retained PipelineDesc + layout +
 *          shader modules, a minimal group-0 bind group over the UBO slots
 *          (setUniformBuffer), and indexed/instanced draw recording. The class
 *          stays null-device safe: constructed without a WGPUDevice it degrades
 *          every entry point to a logged no-op, so handle bookkeeping and the
 *          language gate are testable without an adapter.
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
    };
    struct ProgramRec {
        WGPUShaderModule vertex = nullptr;
        WGPUShaderModule fragment = nullptr;
    };
    struct PipelineRec {
        PipelineDesc desc;
        WGPURenderPipeline pipeline = nullptr;  ///< Lazily built on first setPipeline.
    };
    struct FramebufferRec {
        u32 color0 = 0;        ///< TextureHandle id of the color attachment.
        u32 depthStencil = 0;  ///< TextureHandle id (0 = none; slice 5 wires it).
    };

    /** @brief Logs a not-yet-implemented path once per entry point. */
    void stubOnce(const char* what);

    /** @brief Builds (once) and returns the WGPURenderPipeline for a handle. */
    WGPURenderPipeline ensurePipeline(u32 id);
    /** @brief (Re)creates the bind groups: group 0 = UBO slots, group 1 = the
     *         texture units (8 texture_2d at bindings 0..7 + one shared sampler at
     *         binding 8 — the WGSL twin convention for the batch sampler array).
     *         Group 1 is set only when the pass bound any texture, so shaders
     *         without samplers (shape) never see a mismatched group. */
    void flushBindGroup();
    /** @brief The lazily created shared sampler (linear/clamp bring-up default). */
    WGPUSampler defaultSampler();
    /** @brief Emulates a region-scoped load-op clear: an internal fullscreen
     *         triangle drawn under the region's scissor (a real load-op covers the
     *         whole attachment — exactly the emulation the RenderPassDesc contract
     *         documents for WebGPU). Runs at pass start, before any user state. */
    void clearQuad(const RenderPassDesc& desc);
    /** @brief True while inside beginRenderPass/endRenderPass. */
    bool inPass() const { return pass_ != nullptr; }

    WGPUDevice device_ = nullptr;
    WGPUQueue queue_ = nullptr;
    WGPUInstance instance_ = nullptr;

    // Surface (the Default framebuffer target).
    WGPUSurface surface_ = nullptr;
    WGPUTextureFormat surface_format_ = WGPUTextureFormat_RGBA8Unorm;
    u32 surface_width_ = 0;
    u32 surface_height_ = 0;

    // Offscreen targets.
    std::unordered_map<u32, FramebufferRec> framebuffers_;
    u32 next_framebuffer_id_ = 1;

    // Internal clear-quad pipeline (region-scoped clear emulation).
    WGPURenderPipeline clear_pipeline_ = nullptr;
    WGPUBindGroup clear_bind_group_ = nullptr;
    BufferHandle clear_color_ubo_{};

    // Per-pass state.
    u32 pass_width_ = 0;   ///< Current pass target size (scissor-off rectangle).
    u32 pass_height_ = 0;
    WGPUCommandEncoder encoder_ = nullptr;
    WGPURenderPassEncoder pass_ = nullptr;
    WGPUTexture frame_texture_ = nullptr;   ///< Acquired surface texture (released at end).
    WGPUTextureView frame_view_ = nullptr;
    u32 current_pipeline_ = 0;
    u32 bound_index_buffer_ = 0;
    static constexpr u32 kUniformSlots = 8;
    u32 uniform_slots_[kUniformSlots] = {};  ///< BufferHandle id per UBO binding slot.
    static constexpr u32 kTextureSlots = 8;
    u32 texture_slots_[kTextureSlots] = {};  ///< TextureHandle id per sampler unit.
    bool any_texture_bound_ = false;
    bool bind_group_dirty_ = true;
    WGPUBindGroup bind_group_ = nullptr;
    WGPUBindGroup texture_group_ = nullptr;
    WGPUSampler sampler_ = nullptr;

    u32 next_id_ = 1;
    std::unordered_map<u32, BufferRec> buffers_;
    std::unordered_map<u32, TextureRec> textures_;
    std::unordered_map<u32, ProgramRec> programs_;
    std::unordered_map<u32, VertexLayoutDesc> layouts_;
    std::unordered_map<u32, PipelineRec> pipelines_;
    std::vector<std::string> stub_logged_;
};

}  // namespace esengine
