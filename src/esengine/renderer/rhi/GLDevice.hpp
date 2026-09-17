// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GLDevice.hpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 * @details Implements the backend primitives with OpenGL ES 3.0 calls. A handle is
 *          the registry's id; the GL name behind it belongs to one generation of
 *          the context and lives only in this backend's maps.
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

    void setViewport(i32 x, i32 y, u32 w, u32 h) override;
    void clearStencil(i32 value) override;

    void setScissorTest(bool enabled) override;
    void setScissor(i32 x, i32 y, i32 w, i32 h) override;

    void setUniformBuffer(u32 slot, BufferHandle buffer) override;
    void setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) override;
    void setIndexBuffer(BufferHandle buffer) override;

    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;
    bool supportsFloatTargets() override;
    u32 maxSamples() override;

    bool supportsShaderLanguage(GfxShaderLanguage language) const override {
        return language == GfxShaderLanguage::GLSL_ES300;
    }

    /// GL reads a framebuffer from the bottom up.
    bool textureOriginTopLeft() const override { return false; }

    void setStencilReference(i32 ref) override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) override;
    void drawArrays(u32 first, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) override;

    void beginRenderPass(const RenderPassDesc& desc) override;
    void endRenderPass() override;

    ReadbackHandle requestReadback(FramebufferHandle target, u32 w, u32 h) override;
    GfxReadbackStatus pollReadback(ReadbackHandle handle) override;
    bool takeReadback(ReadbackHandle handle, void* dest, usize destSize) override;
    void discardReadback(ReadbackHandle handle) override;

    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNanoseconds) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam name) override;

    /** @brief This generation's GL name behind a texture, for a host uploading into it. */
    u32 nativeTextureName(TextureHandle texture) const { return nameOf(texture_names_, static_cast<u32>(texture)); }

protected:
    void captureDeviceIdentity() override;
    bool recreateDevice() override;
    void onDeviceLost() override;

    bool backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) override;
    void backendDeleteBuffer(u32 id) override;
    void backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) override;
    void backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) override;

    bool backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) override;
    bool backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                        const void* data, u32 byteLength, u32 mipLevels) override;
    bool backendAdoptTexture(u32 id, u32 nativeId, const TextureDesc& desc) override;
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
    void backendUseProgram(u32 id) override;
    i32 backendUniformLocation(u32 program, const char* name) override;
    i32 backendAttribLocation(u32 program, const char* name) override;
    void backendSetUniform(i32 nativeLocation, const GfxUniformValue& value) override;
    std::vector<GfxUniformInfo> backendActiveUniforms(u32 program) override;
    u32 backendUniformBlockIndex(u32 program, const char* name) override;
    void backendUniformBlockBinding(u32 program, u32 nativeBlockIndex, u32 bindingPoint) override;

    void backendDeleteVertexLayout(u32 id) override;
    void backendSetPipeline(u32 id, const PipelineDesc& desc) override;
    void backendInvalidatePipelineCache() override;

    bool backendCreateFramebuffer(u32 id, const FramebufferDesc& desc) override;
    void backendDeleteFramebuffer(u32 id) override;

    bool backendCreateTimerQuery(u32 id) override;
    u32 backendReadbackCount() const override { return static_cast<u32>(readbacks_.size()); }

private:
    static u32 nameOf(const std::vector<u32>& names, u32 id) {
        return id < names.size() ? names[id] : 0u;
    }
    static void setName(std::vector<u32>& names, u32 id, u32 name) {
        if (id >= names.size()) names.resize(static_cast<usize>(id) + 1, 0u);
        names[id] = name;
    }
    /** A multisampled texture is a renderbuffer in WebGL2, in its own GL namespace. */
    bool isRenderbuffer(u32 textureId) const;

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
    void setDepthBias(i16 bias);

    void applyStencilMode(GfxStencilMode mode);

    void uploadBufferStore(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes, bool respec);

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
    void bindTextureForEdit(u32 name);

    // Detach a texture from every sampler slot it lingers in, keeping the sampler
    // cache coherent. Used by beginRenderPass to break feedback loops: a render
    // target's own attachment must not stay bound to a sampler while it is drawn to.
    void evictSamplerBinding(u32 name);

    /** GL names by registry id for this generation; 0 = none. */
    std::vector<u32> buffer_names_;
    std::vector<u32> texture_names_;
    std::vector<u32> program_names_;
    std::vector<u32> framebuffer_names_;
    std::vector<u32> query_names_;
    /** Buffer id per uniform binding slot, as the renderer set it. */
    std::vector<u32> uniform_slots_;

    u32 current_pipeline_id_ = 0;
    GfxStencilMode current_stencil_mode_ = GfxStencilMode::Off;
    // Redundant-state caches: a pipeline switch sharing the program or blend func
    // skips the FFI-crossing GL call. 0xFF is an out-of-range BlendMode, so the
    // first real set always issues.
    u32 current_program_name_ = 0;
    BlendMode current_blend_ = static_cast<BlendMode>(0xFF);

    // Redundant-state caches for the two per-draw hot paths. glActiveTexture is
    // the only site that moves the active unit, so active_texture_unit_ is
    // authoritative; bound_texture_[unit] mirrors the sampler bindings by GL name.
    static constexpr u32 kTextureSlots = 16;
    u32 active_texture_unit_ = 0;
    u32 bound_texture_[kTextureSlots] = {};
    i16 current_depth_bias_ = 0;
    int scissor_test_ = -1;  // tri-state: -1 unknown, 0 disabled, 1 enabled

    struct VaoCache {
        u32 vao = 0;
        bool configured = false;
        u32 bakedVbo[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedOffset[MAX_VERTEX_BUFFER_SLOTS] = {};
        u32 bakedIbo = 0;
    };
    std::unordered_map<u32, VaoCache> vaos_;
    u32 current_layout_ = 0;
    u32 pending_vbo_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_vbo_offset_[MAX_VERTEX_BUFFER_SLOTS] = {};
    u32 pending_ibo_ = 0;
    u32 bound_vao_ = 0;

    // Where a multisampled framebuffer resolves to, and how big, by framebuffer id.
    // The blit runs whenever the target is left, which is the only reason anything
    // above the RHI can sample a target it drew into multisampled.
    struct ResolvePair {
        u32 destFbo = 0;
        u32 width = 0;
        u32 height = 0;
        bool depth = false;
    };
    std::unordered_map<u32, ResolvePair> framebuffer_resolve_;
    /// Blit a multisampled target into the single-sample one it owns; no-op for
    /// a target that owns none. Called whenever a target is left.
    void resolveFramebuffer(u32 framebufferId);
    /// The framebuffer id a pass is currently drawing into (0 = default).
    u32 current_framebuffer_ = 0;
    /// 0 = unprobed; otherwise GL_MAX_SAMPLES, floored at 1.
    u32 max_samples_ = 0;

    // Completed readbacks parked until taken: GL reads synchronously at request
    // time, so the async contract resolves on the caller's first poll.
    std::unordered_map<u32, std::vector<u8>> readbacks_;
    u32 next_readback_id_ = 1;

    // 0 = unprobed, 1 = timer queries available, 2 = unavailable.
    int timer_query_state_ = 0;
    bool timer_disjoint_pending_ = false;
};

}  // namespace esengine
