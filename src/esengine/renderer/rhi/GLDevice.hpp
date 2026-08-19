// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GLDevice.hpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 * @details Implements all GfxDevice virtual methods using OpenGL ES 3.0 calls.
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

#include "./GfxDevice.hpp"

#include <unordered_map>
#include <vector>

namespace esengine {

// =============================================================================
// GLDevice Class
// =============================================================================

/**
 * @brief OpenGL ES 3.0 / WebGL 2.0 implementation of GfxDevice
 */
class GLDevice final : public GfxDevice {
public:
    GLDevice() = default;
    ~GLDevice() override = default;

    ClipDepthRange clipDepthRange() const override { return ClipDepthRange::MinusOneToOne; }

    void init() override;
    void shutdown() override;

    bool pollDeviceLost() override;

protected:
    void captureDeviceIdentity() override;
    bool recreateDevice() override;
    void onDeviceLost() override;

public:

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
                                          const void* data, u32 byteLength, u32 mipLevels) override;
    TextureHandle importExternalTexture(u32 nativeId, const TextureDesc& desc) override;
    void deleteTexture(TextureHandle texture) override;
    void updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                       const void* pixels, bool flipY) override;
    void setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                          TextureWrap wrapS, TextureWrap wrapT) override;
    void generateMipmaps(TextureHandle texture) override;
    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;
    bool supportsFloatTargets() override;

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::GLSL_ES300;
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
    void setUniformMat3(i32 location, const f32* data) override;
    void setUniformMat4(i32 location, const f32* data) override;

    std::vector<GfxUniformInfo> getActiveUniforms(ShaderHandle program) override;

    u32 getUniformBlockIndex(ShaderHandle program, const char* name) override;
    void uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint) override;

    PipelineHandle createPipeline(const PipelineDesc& desc) override;
    void setPipeline(PipelineHandle handle) override;
    void setStencilReference(i32 ref) override;
    void invalidatePipelineCache() override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) override;
    void drawArrays(u32 first, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) override;

    FramebufferHandle createFramebuffer(const FramebufferDesc& desc) override;
    void deleteFramebuffer(FramebufferHandle framebuffer) override;
    void beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass() override;

    ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) override;
    GfxReadbackStatus pollReadback(ReadbackHandle handle) override;
    bool takeReadback(ReadbackHandle handle, void* dest, usize destSize) override;
    void discardReadback(ReadbackHandle handle) override;

    u32 createTimerQuery() override;
    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNanoseconds) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam name) override;
    GfxLiveObjects liveObjects() const override;

private:
    // Clear machinery: backend-internal since RenderPassDesc became the only way
    // to request clears (it carries the values; beginRenderPass applies them).
    void setClearColor(f32 r, f32 g, f32 b, f32 a);
    void setClearStencil(i32 value);
    void clear(bool color, bool depth, bool stencil);

    // The loose state setters a pipeline bundles (blend/depth/stencil/cull/masks):
    // backend-internal since the pipeline became the only way to set them.
    void setBlendEnabled(bool enabled);
    void setBlendMode(BlendMode mode);
    void setDepthTest(bool enabled);
    void setDepthWrite(bool enabled);
    void setStencilTest(bool enabled);
    void setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask);
    void setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass);
    void setStencilMask(u32 mask);
    void setColorMask(bool r, bool g, bool b, bool a);
    void setCulling(bool enabled);
    void setCullFace(bool front);

    // Pipeline cache: a handle is (index + 1) into pipelines_; PipelineHandle::Invalid is 0.
    // WebGL2 has no native pipeline object, so a pipeline is applied as a bundle of GL
    // state, deduped by comparing handles (same pipeline -> skip the whole state apply).
    void applyStencilMode(GfxStencilMode mode);

    void uploadBufferStore(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes, bool respec);

    // Drops every "what is currently bound" cache. Those answers are only valid
    // for the context that was asked; after a restore they would suppress the
    // very binds that re-establish state.
    void resetStateCache();

    // Applies the current pipeline's vertex layout to the pending buffer bindings:
    // the layout's lazily-created VAO is bound, and any slot whose buffer/offset
    // differs from what the VAO has baked is re-pointed. WebGL2 has no explicit
    // vertex-input object, so the VAO is purely a backend cache here.
    void prepareVertexState();

    // Binds a texture on the active unit for a create/update/mipmap edit while
    // keeping the sampler-binding cache coherent, so bindTexture() can skip
    // redundant per-draw binds (every gl* call is a WASM→JS FFI crossing).
    void bindTextureForEdit(u32 id);

    // Detach a texture from every sampler slot it lingers in, keeping the sampler
    // cache coherent. Used by beginRenderPass to break feedback loops: a render
    // target's own attachment must not stay bound to a sampler while it is drawn to.
    void evictSamplerBinding(u32 textureId);

    std::vector<PipelineDesc> pipelines_;
    PipelineHandle current_pipeline_ = PipelineHandle::Invalid;
    GfxStencilMode current_stencil_mode_ = GfxStencilMode::Off;
    // Redundant-state caches for setPipeline: the program and blend func are only
    // ever set through useProgram / setBlendMode, so caching the last value lets a
    // pipeline switch that shares them skip the (FFI-crossing) GL call. Reset in
    // invalidatePipelineCache. 0xFF is an out-of-range BlendMode sentinel so the
    // first real set always issues (init sets the GL blend directly, not via here).
    ShaderHandle current_program_ = ShaderHandle::Invalid;
    BlendMode current_blend_ = static_cast<BlendMode>(0xFF);

    // Redundant-state caches for the two per-draw hot paths. glActiveTexture is
    // the only site that moves the active unit, so active_texture_unit_ is
    // authoritative; bound_texture_[unit] mirrors the sampler bindings.
    static constexpr u32 kTextureSlots = 16;
    u32 active_texture_unit_ = 0;
    u32 bound_texture_[kTextureSlots] = {};
    int scissor_test_ = -1;  // tri-state: -1 unknown, 0 disabled, 1 enabled

    struct LayoutRecord {
        VertexLayoutDesc desc;
        u32 vao = 0;
        bool alive = false;
        bool configured = false;
        u32 bakedVbo[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedOffset[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedIbo = 0;
    };
    std::vector<LayoutRecord> layouts_;
    VertexLayoutHandle current_layout_ = VertexLayoutHandle::Invalid;
    u32 pending_vbo_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_vbo_offset_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_ibo_ = 0;
    u32 bound_vao_ = 0;

    // Per-handle metadata the GL bind-to-edit protocol needs but the interface no
    // longer carries: buffer target/usage for uploads, texture transfer format for
    // sub-image updates.
    struct BufferMeta {
        GfxBufferUsage usage;
        bool dynamic;
    };
    std::unordered_map<u32, BufferMeta> buffer_meta_;
    std::unordered_map<u32, GfxPixelFormat> texture_formats_;

    // The textures a framebuffer owns (color + depth/stencil attachment ids),
    // recorded at createFramebuffer. beginRenderPass consults this to detach the
    // target's own attachments from any sampler slot before drawing into it — the
    // GL feedback-loop guard. 0 = no such attachment.
    struct FramebufferTextures {
        u32 color = 0;
        u32 depthStencil = 0;
    };
    std::unordered_map<u32, FramebufferTextures> framebuffer_textures_;

    // Completed readbacks parked until taken: GL reads synchronously at request
    // time, so the async contract resolves on the caller's first poll.
    std::unordered_map<u32, std::vector<u8>> readbacks_;
    u32 next_readback_id_ = 1;

    // 0 = unprobed, 1 = timer queries available, 2 = unavailable.
    int timer_query_state_ = 0;

    // Linked programs alive. Unlike buffers and textures, programs have no
    // per-handle metadata map whose size would answer this, and a program leaked
    // by shader hot reload is the exact failure the census exists to catch.
    u32 live_programs_ = 0;
};

}  // namespace esengine
