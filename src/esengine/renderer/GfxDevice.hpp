/**
 * @file    GfxDevice.hpp
 * @brief   Abstract graphics device interface
 * @details Thin abstraction layer over graphics APIs (OpenGL ES, WebGPU, Vulkan).
 *          Upper-layer code (DrawList, RenderFrame, plugins) depends only on this
 *          interface, isolating all API-specific calls into concrete implementations.
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

#include "../core/Types.hpp"
#include "BlendMode.hpp"
#include "GfxEnums.hpp"
#include "Texture.hpp"

#include <vector>

namespace esengine {

// =============================================================================
// GfxDevice Interface
// =============================================================================

/**
 * @brief Abstract graphics device interface
 *
 * @details Stateless command interface — each method maps 1:1 to a GPU API call.
 *          StateTracker wraps this with caching to eliminate redundant state changes.
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

    /** @brief Sets the clear color */
    virtual void setClearColor(f32 r, f32 g, f32 b, f32 a) = 0;

    /** @brief Clears framebuffer attachments */
    virtual void clear(bool color, bool depth, bool stencil) = 0;

    // =========================================================================
    // Blend State
    // =========================================================================

    /** @brief Enables or disables blending */
    virtual void setBlendEnabled(bool enabled) = 0;

    /** @brief Sets blend mode using predefined BlendMode */
    virtual void setBlendMode(BlendMode mode) = 0;

    // =========================================================================
    // Depth State
    // =========================================================================

    /** @brief Enables or disables depth testing */
    virtual void setDepthTest(bool enabled) = 0;

    /** @brief Enables or disables depth buffer writes */
    virtual void setDepthWrite(bool enabled) = 0;

    // =========================================================================
    // Stencil State
    // =========================================================================

    /** @brief Enables or disables stencil testing */
    virtual void setStencilTest(bool enabled) = 0;

    /** @brief Sets stencil function */
    virtual void setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask) = 0;

    /** @brief Sets stencil operations */
    virtual void setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass) = 0;

    /** @brief Sets stencil write mask */
    virtual void setStencilMask(u32 mask) = 0;

    /** @brief Sets color write mask */
    virtual void setColorMask(bool r, bool g, bool b, bool a) = 0;

    // =========================================================================
    // Scissor State
    // =========================================================================

    /** @brief Enables or disables scissor test */
    virtual void setScissorTest(bool enabled) = 0;

    /** @brief Sets the scissor rectangle */
    virtual void setScissor(i32 x, i32 y, i32 w, i32 h) = 0;

    // =========================================================================
    // Culling
    // =========================================================================

    /** @brief Enables or disables face culling */
    virtual void setCulling(bool enabled) = 0;

    /** @brief Sets which face to cull (true = front, false = back) */
    virtual void setCullFace(bool front) = 0;

    // =========================================================================
    // Texture Binding
    // =========================================================================

    /** @brief Activates a texture slot and binds a 2D texture */
    virtual void bindTexture(u32 slot, u32 textureId) = 0;

    // =========================================================================
    // Shader Program
    // =========================================================================

    /** @brief Binds a shader program */
    virtual void useProgram(u32 programId) = 0;

    /** @brief Gets a uniform location by name */
    virtual i32 getUniformLocation(u32 programId, const char* name) = 0;

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
    virtual std::vector<GfxUniformInfo> getActiveUniforms(u32 programId) = 0;

    // =========================================================================
    // Buffer Operations
    // =========================================================================

    /** @brief Creates a new buffer and returns its ID */
    virtual u32 createBuffer() = 0;

    /** @brief Deletes a buffer */
    virtual void deleteBuffer(u32 bufferId) = 0;

    /** @brief Binds a buffer to the vertex (array) target */
    virtual void bindVertexBuffer(u32 bufferId) = 0;

    /** @brief Binds a buffer to the index (element) target */
    virtual void bindIndexBuffer(u32 bufferId) = 0;

    /** @brief Uploads data to a buffer target */
    virtual void bufferData(GfxBufferTarget target, const void* data, u32 sizeBytes, bool dynamic) = 0;

    /** @brief Updates a sub-region of a buffer target */
    virtual void bufferSubData(GfxBufferTarget target, u32 offset, const void* data, u32 sizeBytes) = 0;

    // =========================================================================
    // VAO Operations
    // =========================================================================

    /** @brief Creates a vertex array object */
    virtual u32 createVertexArray() = 0;

    /** @brief Deletes a vertex array object */
    virtual void deleteVertexArray(u32 vaoId) = 0;

    /** @brief Binds a vertex array object */
    virtual void bindVertexArray(u32 vaoId) = 0;

    /** @brief Enables a vertex attribute */
    virtual void enableVertexAttrib(u32 index) = 0;

    /** @brief Configures a vertex attribute pointer */
    virtual void vertexAttribPointer(u32 index, i32 size, GfxDataType type,
                                     bool normalized, i32 stride, u32 offset) = 0;

    /** @brief Sets vertex attribute divisor for instanced rendering */
    virtual void vertexAttribDivisor(u32 index, u32 divisor) = 0;

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
    // Texture Creation
    // =========================================================================

    /** @brief Creates a new texture and returns its ID */
    virtual u32 createTexture() = 0;

    /** @brief Deletes a texture */
    virtual void deleteTexture(u32 textureId) = 0;

    /** @brief Allocates texture storage with optional initial data */
    virtual void texImage2D(u32 textureId, u32 width, u32 height,
                            GfxPixelFormat format, const void* data) = 0;

    /** @brief Updates a sub-region of a texture */
    virtual void texSubImage2D(u32 textureId, i32 xoffset, i32 yoffset,
                               u32 width, u32 height,
                               GfxPixelFormat format, const void* data) = 0;

    /** @brief Sets texture filtering and wrap parameters */
    virtual void setTextureParams(u32 textureId, TextureFilter min, TextureFilter mag,
                                  TextureWrap wrapS, TextureWrap wrapT) = 0;

    /** @brief Generates mipmaps for a texture */
    virtual void generateMipmaps(u32 textureId) = 0;

    /** @brief Sets pixel store parameter */
    virtual void pixelStorei(u32 pname, i32 param) = 0;

    // =========================================================================
    // Framebuffer
    // =========================================================================

    /** @brief Creates a framebuffer and returns its ID */
    virtual u32 createFramebuffer() = 0;

    /** @brief Deletes a framebuffer */
    virtual void deleteFramebuffer(u32 fboId) = 0;

    /** @brief Binds a framebuffer (0 = default) */
    virtual void bindFramebuffer(u32 fboId) = 0;

    /** @brief Attaches a texture to a framebuffer */
    virtual void framebufferTexture2D(u32 fboId, GfxAttachment attachment, u32 textureId) = 0;

    /** @brief Checks framebuffer completeness */
    virtual bool checkFramebufferStatus() = 0;

    // =========================================================================
    // Readback
    // =========================================================================

    /** @brief Reads pixels from the current framebuffer */
    virtual void readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) = 0;

    // =========================================================================
    // Debug
    // =========================================================================

    /** @brief Enables or disables wireframe rendering (desktop only) */
    virtual void setWireframe(bool enabled) = 0;

    /** @brief Queries the last error */
    virtual u32 getError() = 0;
};

}  // namespace esengine
