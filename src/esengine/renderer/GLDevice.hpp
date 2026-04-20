/**
 * @file    GLDevice.hpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 * @details Implements all GfxDevice virtual methods using OpenGL ES 3.0 calls.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "GfxDevice.hpp"

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

    void bindTexture(u32 slot, u32 textureId) override;

    void useProgram(u32 programId) override;
    i32 getUniformLocation(u32 programId, const char* name) override;
    void setUniform1i(i32 location, i32 value) override;
    void setUniform1f(i32 location, f32 value) override;
    void setUniform2f(i32 location, f32 x, f32 y) override;
    void setUniform3f(i32 location, f32 x, f32 y, f32 z) override;
    void setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w) override;
    void setUniformMat3(i32 location, const f32* data) override;
    void setUniformMat4(i32 location, const f32* data) override;

    std::vector<GfxUniformInfo> getActiveUniforms(u32 programId) override;

    u32 createBuffer() override;
    void deleteBuffer(u32 bufferId) override;
    void bindVertexBuffer(u32 bufferId) override;
    void bindIndexBuffer(u32 bufferId) override;
    void bufferData(GfxBufferTarget target, const void* data, u32 sizeBytes, bool dynamic) override;
    void bufferSubData(GfxBufferTarget target, u32 offset, const void* data, u32 sizeBytes) override;

    u32 createVertexArray() override;
    void deleteVertexArray(u32 vaoId) override;
    void bindVertexArray(u32 vaoId) override;
    void enableVertexAttrib(u32 index) override;
    void vertexAttribPointer(u32 index, i32 size, GfxDataType type,
                             bool normalized, i32 stride, u32 offset) override;
    void vertexAttribDivisor(u32 index, u32 divisor) override;

    void drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) override;
    void drawArrays(u32 first, u32 vertexCount) override;
    void drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) override;

    u32 createTexture() override;
    void deleteTexture(u32 textureId) override;
    void texImage2D(u32 textureId, u32 width, u32 height,
                    GfxPixelFormat format, const void* data) override;
    void texSubImage2D(u32 textureId, i32 xoffset, i32 yoffset,
                       u32 width, u32 height,
                       GfxPixelFormat format, const void* data) override;
    void setTextureParams(u32 textureId, TextureFilter min, TextureFilter mag,
                          TextureWrap wrapS, TextureWrap wrapT) override;
    void generateMipmaps(u32 textureId) override;
    void pixelStorei(u32 pname, i32 param) override;

    u32 createFramebuffer() override;
    void deleteFramebuffer(u32 fboId) override;
    void bindFramebuffer(u32 fboId) override;
    void framebufferTexture2D(u32 fboId, GfxAttachment attachment, u32 textureId) override;
    bool checkFramebufferStatus() override;

    void readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) override;

    void setWireframe(bool enabled) override;
    u32 getError() override;
};

}  // namespace esengine
