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

#include "GfxDevice.hpp"

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

    void init() override;
    void shutdown() override;

    void setViewport(i32 x, i32 y, u32 w, u32 h) override;
    void setClearColor(f32 r, f32 g, f32 b, f32 a) override;
    void setClearStencil(i32 value) override;
    void clear(bool color, bool depth, bool stencil) override;

    void setBlendEnabled(bool enabled) override;
    void setBlendMode(BlendMode mode) override;

    void setDepthTest(bool enabled) override;
    void setDepthWrite(bool enabled) override;

    void setStencilTest(bool enabled) override;
    void setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask) override;
    void setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass) override;
    void setStencilMask(u32 mask) override;
    void setColorMask(bool r, bool g, bool b, bool a) override;

    void setScissorTest(bool enabled) override;
    void setScissor(i32 x, i32 y, i32 w, i32 h) override;

    void setCulling(bool enabled) override;
    void setCullFace(bool front) override;

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
    void setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                          TextureWrap wrapS, TextureWrap wrapT) override;
    void generateMipmaps(TextureHandle texture) override;
    void bindTexture(u32 slot, TextureHandle texture) override;
    bool supportsCompressedFormat(GfxCompressedFormat format) override;

    ShaderHandle createProgram(const char* vertexSrc, const char* fragmentSrc,
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

    void readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) override;

    u32 createTimerQuery() override;
    void beginTimerQuery(u32 query) override;
    void endTimerQuery() override;
    bool timerDisjoint() override;
    bool getTimerQueryNs(u32 query, u64* outNanoseconds) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
    std::string getString(GfxStringName name) override;
    i32 getInt(GfxIntParam name) override;

private:
    // Pipeline cache: a handle is (index + 1) into pipelines_; PipelineHandle::Invalid is 0.
    // WebGL2 has no native pipeline object, so a pipeline is applied as a bundle of GL
    // state, deduped by comparing handles (same pipeline -> skip the whole state apply).
    void applyStencilMode(GfxStencilMode mode);

    void uploadBufferStore(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes, bool respec);

    // Applies the current pipeline's vertex layout to the pending buffer bindings:
    // the layout's lazily-created VAO is bound, and any slot whose buffer/offset
    // differs from what the VAO has baked is re-pointed. WebGL2 has no explicit
    // vertex-input object, so the VAO is purely a backend cache here.
    void prepareVertexState();

    std::vector<PipelineDesc> pipelines_;
    PipelineHandle current_pipeline_ = PipelineHandle::Invalid;
    GfxStencilMode current_stencil_mode_ = GfxStencilMode::Off;

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

    // 0 = unprobed, 1 = timer queries available, 2 = unavailable.
    int timer_query_state_ = 0;
};

}  // namespace esengine
