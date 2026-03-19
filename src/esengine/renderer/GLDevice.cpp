/**
 * @file    GLDevice.cpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "GLDevice.hpp"
#include "OpenGLHeaders.hpp"
#include "../core/Log.hpp"

namespace esengine {

// =============================================================================
// Helper Conversions
// =============================================================================

namespace {

GLenum toGLFilter(TextureFilter filter) {
    switch (filter) {
    case TextureFilter::Nearest: return GL_NEAREST;
    case TextureFilter::Linear:  return GL_LINEAR;
    default: return GL_LINEAR;
    }
}

GLenum toGLWrap(TextureWrap wrap) {
    switch (wrap) {
    case TextureWrap::Repeat:         return GL_REPEAT;
    case TextureWrap::ClampToEdge:    return GL_CLAMP_TO_EDGE;
    case TextureWrap::MirroredRepeat: return GL_MIRRORED_REPEAT;
    default: return GL_REPEAT;
    }
}

void setCapability(GLenum cap, bool enabled) {
    if (enabled) {
        glEnable(cap);
    } else {
        glDisable(cap);
    }
}

}  // namespace

// =============================================================================
// Lifecycle
// =============================================================================

void GLDevice::init() {
    glEnable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    ES_LOG_DEBUG("GLDevice initialized");
}

void GLDevice::shutdown() {
    ES_LOG_INFO("GLDevice shutdown");
}

// =============================================================================
// Viewport & Clear
// =============================================================================

void GLDevice::setViewport(i32 x, i32 y, u32 w, u32 h) {
    glViewport(x, y, static_cast<GLsizei>(w), static_cast<GLsizei>(h));
}

void GLDevice::setClearColor(f32 r, f32 g, f32 b, f32 a) {
    glClearColor(r, g, b, a);
}

void GLDevice::clear(bool color, bool depth, bool stencil) {
    GLbitfield mask = 0;
    if (color)   mask |= GL_COLOR_BUFFER_BIT;
    if (depth)   mask |= GL_DEPTH_BUFFER_BIT;
    if (stencil) mask |= GL_STENCIL_BUFFER_BIT;
    if (mask != 0) {
        glClear(mask);
    }
}

// =============================================================================
// Blend State
// =============================================================================

void GLDevice::setBlendEnabled(bool enabled) {
    setCapability(GL_BLEND, enabled);
}

void GLDevice::setBlendMode(BlendMode mode) {
    switch (mode) {
    case BlendMode::Normal:
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        break;
    case BlendMode::Additive:
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE, GL_ONE, GL_ONE);
        break;
    case BlendMode::Multiply:
        glBlendFuncSeparate(GL_DST_COLOR, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        break;
    case BlendMode::Screen:
        glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_COLOR, GL_ONE, GL_ONE_MINUS_SRC_COLOR);
        break;
    case BlendMode::PremultipliedAlpha:
        glBlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        break;
    case BlendMode::PmaAdditive:
        glBlendFuncSeparate(GL_ONE, GL_ONE, GL_ONE, GL_ONE);
        break;
    }
}

void GLDevice::setBlendFunc(u32 srcFactor, u32 dstFactor, u32 srcAlphaFactor, u32 dstAlphaFactor) {
    glBlendFuncSeparate(srcFactor, dstFactor, srcAlphaFactor, dstAlphaFactor);
}

// =============================================================================
// Depth State
// =============================================================================

void GLDevice::setDepthTest(bool enabled) {
    setCapability(GL_DEPTH_TEST, enabled);
}

void GLDevice::setDepthWrite(bool enabled) {
    glDepthMask(enabled ? GL_TRUE : GL_FALSE);
}

// =============================================================================
// Stencil State
// =============================================================================

void GLDevice::setStencilTest(bool enabled) {
    setCapability(GL_STENCIL_TEST, enabled);
}

void GLDevice::setStencilFunc(u32 func, i32 ref, u32 mask) {
    glStencilFunc(func, ref, mask);
}

void GLDevice::setStencilOp(u32 sfail, u32 dpfail, u32 dppass) {
    glStencilOp(sfail, dpfail, dppass);
}

void GLDevice::setStencilMask(u32 mask) {
    glStencilMask(mask);
}

void GLDevice::setColorMask(bool r, bool g, bool b, bool a) {
    glColorMask(r ? GL_TRUE : GL_FALSE, g ? GL_TRUE : GL_FALSE,
                b ? GL_TRUE : GL_FALSE, a ? GL_TRUE : GL_FALSE);
}

// =============================================================================
// Scissor State
// =============================================================================

void GLDevice::setScissorTest(bool enabled) {
    setCapability(GL_SCISSOR_TEST, enabled);
}

void GLDevice::setScissor(i32 x, i32 y, i32 w, i32 h) {
    glScissor(x, y, w, h);
}

// =============================================================================
// Culling
// =============================================================================

void GLDevice::setCulling(bool enabled) {
    setCapability(GL_CULL_FACE, enabled);
}

void GLDevice::setCullFace(bool front) {
    glCullFace(front ? GL_FRONT : GL_BACK);
}

// =============================================================================
// Texture Binding
// =============================================================================

void GLDevice::bindTexture(u32 slot, u32 textureId) {
    glActiveTexture(GL_TEXTURE0 + slot);
    glBindTexture(GL_TEXTURE_2D, textureId);
}

// =============================================================================
// Shader Program
// =============================================================================

void GLDevice::useProgram(u32 programId) {
    glUseProgram(programId);
}

i32 GLDevice::getUniformLocation(u32 programId, const char* name) {
    return glGetUniformLocation(programId, name);
}

void GLDevice::setUniform1i(i32 location, i32 value) {
    if (location >= 0) glUniform1i(location, value);
}

void GLDevice::setUniform1f(i32 location, f32 value) {
    if (location >= 0) glUniform1f(location, value);
}

void GLDevice::setUniform2f(i32 location, f32 x, f32 y) {
    if (location >= 0) glUniform2f(location, x, y);
}

void GLDevice::setUniform3f(i32 location, f32 x, f32 y, f32 z) {
    if (location >= 0) glUniform3f(location, x, y, z);
}

void GLDevice::setUniform4f(i32 location, f32 x, f32 y, f32 z, f32 w) {
    if (location >= 0) glUniform4f(location, x, y, z, w);
}

void GLDevice::setUniformMat3(i32 location, const f32* data) {
    if (location >= 0) glUniformMatrix3fv(location, 1, GL_FALSE, data);
}

void GLDevice::setUniformMat4(i32 location, const f32* data) {
    if (location >= 0) glUniformMatrix4fv(location, 1, GL_FALSE, data);
}

// =============================================================================
// Buffer Operations
// =============================================================================

u32 GLDevice::createBuffer() {
    GLuint id = 0;
    glGenBuffers(1, &id);
    return static_cast<u32>(id);
}

void GLDevice::deleteBuffer(u32 bufferId) {
    GLuint id = static_cast<GLuint>(bufferId);
    glDeleteBuffers(1, &id);
}

void GLDevice::bindVertexBuffer(u32 bufferId) {
    glBindBuffer(GL_ARRAY_BUFFER, bufferId);
}

void GLDevice::bindIndexBuffer(u32 bufferId) {
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, bufferId);
}

void GLDevice::bufferData(u32 target, const void* data, u32 sizeBytes, bool dynamic) {
    glBufferData(target, sizeBytes, data, dynamic ? GL_DYNAMIC_DRAW : GL_STATIC_DRAW);
}

void GLDevice::bufferSubData(u32 target, u32 offset, const void* data, u32 sizeBytes) {
    glBufferSubData(target, offset, sizeBytes, data);
}

// =============================================================================
// VAO Operations
// =============================================================================

u32 GLDevice::createVertexArray() {
    GLuint id = 0;
    glGenVertexArrays(1, &id);
    return static_cast<u32>(id);
}

void GLDevice::deleteVertexArray(u32 vaoId) {
    GLuint id = static_cast<GLuint>(vaoId);
    glDeleteVertexArrays(1, &id);
}

void GLDevice::bindVertexArray(u32 vaoId) {
    glBindVertexArray(vaoId);
}

void GLDevice::enableVertexAttrib(u32 index) {
    glEnableVertexAttribArray(index);
}

void GLDevice::vertexAttribPointer(u32 index, i32 size, u32 type,
                                   bool normalized, i32 stride, u32 offset) {
    glVertexAttribPointer(index, size, type, normalized ? GL_TRUE : GL_FALSE,
                          stride, reinterpret_cast<const void*>(static_cast<uintptr_t>(offset)));
}

void GLDevice::vertexAttribDivisor(u32 index, u32 divisor) {
    glVertexAttribDivisor(index, divisor);
}

// =============================================================================
// Draw Calls
// =============================================================================

void GLDevice::drawElements(u32 indexCount, u32 indexType, u32 byteOffset) {
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indexCount), indexType,
                   reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)));
}

void GLDevice::drawArrays(u32 first, u32 vertexCount) {
    glDrawArrays(GL_TRIANGLES, static_cast<GLint>(first), static_cast<GLsizei>(vertexCount));
}

void GLDevice::drawElementsInstanced(u32 indexCount, u32 indexType, u32 byteOffset, u32 instanceCount) {
    glDrawElementsInstanced(GL_TRIANGLES, static_cast<GLsizei>(indexCount), indexType,
                            reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)),
                            static_cast<GLsizei>(instanceCount));
}

// =============================================================================
// Texture Creation
// =============================================================================

u32 GLDevice::createTexture() {
    GLuint id = 0;
    glGenTextures(1, &id);
    return static_cast<u32>(id);
}

void GLDevice::deleteTexture(u32 textureId) {
    GLuint id = static_cast<GLuint>(textureId);
    glDeleteTextures(1, &id);
}

void GLDevice::texImage2D(u32 textureId, u32 width, u32 height,
                          u32 internalFormat, u32 format, u32 type,
                          const void* data) {
    glBindTexture(GL_TEXTURE_2D, textureId);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(internalFormat),
                 static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                 0, format, type, data);
}

void GLDevice::texSubImage2D(u32 textureId, i32 xoffset, i32 yoffset,
                             u32 width, u32 height,
                             u32 format, u32 type, const void* data) {
    glBindTexture(GL_TEXTURE_2D, textureId);
    glTexSubImage2D(GL_TEXTURE_2D, 0, xoffset, yoffset,
                    static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                    format, type, data);
}

void GLDevice::setTextureParams(u32 textureId, TextureFilter min, TextureFilter mag,
                                TextureWrap wrapS, TextureWrap wrapT) {
    glBindTexture(GL_TEXTURE_2D, textureId);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLFilter(min));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(mag));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(wrapT));
}

void GLDevice::generateMipmaps(u32 textureId) {
    glBindTexture(GL_TEXTURE_2D, textureId);
    glGenerateMipmap(GL_TEXTURE_2D);
}

void GLDevice::pixelStorei(u32 pname, i32 param) {
    glPixelStorei(pname, param);
}

// =============================================================================
// Framebuffer
// =============================================================================

u32 GLDevice::createFramebuffer() {
    GLuint id = 0;
    glGenFramebuffers(1, &id);
    return static_cast<u32>(id);
}

void GLDevice::deleteFramebuffer(u32 fboId) {
    GLuint id = static_cast<GLuint>(fboId);
    glDeleteFramebuffers(1, &id);
}

void GLDevice::bindFramebuffer(u32 fboId) {
    glBindFramebuffer(GL_FRAMEBUFFER, fboId);
}

void GLDevice::framebufferTexture2D(u32 fboId, u32 attachment, u32 textureId) {
    glBindFramebuffer(GL_FRAMEBUFFER, fboId);
    glFramebufferTexture2D(GL_FRAMEBUFFER, attachment, GL_TEXTURE_2D, textureId, 0);
}

bool GLDevice::checkFramebufferStatus() {
    return glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
}

// =============================================================================
// Readback
// =============================================================================

void GLDevice::readPixels(i32 x, i32 y, u32 w, u32 h, u32 format, u32 type, void* data) {
    glReadPixels(x, y, static_cast<GLsizei>(w), static_cast<GLsizei>(h), format, type, data);
}

// =============================================================================
// Debug
// =============================================================================

void GLDevice::setWireframe(bool enabled) {
#ifndef ES_PLATFORM_WEB
    glPolygonMode(GL_FRONT_AND_BACK, enabled ? GL_LINE : GL_FILL);
#else
    (void)enabled;
#endif
}

u32 GLDevice::getError() {
    return static_cast<u32>(glGetError());
}

}  // namespace esengine
