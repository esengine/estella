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

#ifndef GL_DEPTH_STENCIL
    #define GL_DEPTH_STENCIL 0x84F9
#endif
#ifndef GL_UNSIGNED_INT_24_8
    #define GL_UNSIGNED_INT_24_8 0x84FA
#endif
#ifndef GL_DEPTH_STENCIL_ATTACHMENT
    #define GL_DEPTH_STENCIL_ATTACHMENT 0x821A
#endif
#ifndef GL_UNPACK_FLIP_Y_WEBGL
    #define GL_UNPACK_FLIP_Y_WEBGL 0x9240
#endif

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

GLenum toGLBufferTarget(GfxBufferTarget target) {
    switch (target) {
    case GfxBufferTarget::Vertex: return GL_ARRAY_BUFFER;
    case GfxBufferTarget::Index:  return GL_ELEMENT_ARRAY_BUFFER;
    default: return GL_ARRAY_BUFFER;
    }
}

GLenum toGLDataType(GfxDataType type) {
    switch (type) {
    case GfxDataType::Float:         return GL_FLOAT;
    case GfxDataType::Int:           return GL_INT;
    case GfxDataType::UnsignedByte:  return GL_UNSIGNED_BYTE;
    case GfxDataType::UnsignedShort: return GL_UNSIGNED_SHORT;
    case GfxDataType::UnsignedInt:   return GL_UNSIGNED_INT;
    default: return GL_FLOAT;
    }
}

GLenum toGLStencilFunc(GfxStencilFunc func) {
    switch (func) {
    case GfxStencilFunc::Never:    return GL_NEVER;
    case GfxStencilFunc::Less:     return GL_LESS;
    case GfxStencilFunc::Equal:    return GL_EQUAL;
    case GfxStencilFunc::LEqual:   return GL_LEQUAL;
    case GfxStencilFunc::Greater:  return GL_GREATER;
    case GfxStencilFunc::NotEqual: return GL_NOTEQUAL;
    case GfxStencilFunc::GEqual:   return GL_GEQUAL;
    case GfxStencilFunc::Always:   return GL_ALWAYS;
    default: return GL_ALWAYS;
    }
}

GLenum toGLStencilOp(GfxStencilOp op) {
    switch (op) {
    case GfxStencilOp::Keep:     return GL_KEEP;
    case GfxStencilOp::Zero:     return GL_ZERO;
    case GfxStencilOp::Replace:  return GL_REPLACE;
    case GfxStencilOp::Incr:     return GL_INCR;
    case GfxStencilOp::Decr:     return GL_DECR;
    case GfxStencilOp::Invert:   return GL_INVERT;
    case GfxStencilOp::IncrWrap: return GL_INCR_WRAP;
    case GfxStencilOp::DecrWrap: return GL_DECR_WRAP;
    default: return GL_KEEP;
    }
}

struct GLPixelFormatInfo {
    GLenum internalFormat;
    GLenum format;
    GLenum type;
};

GLPixelFormatInfo toGLPixelFormat(GfxPixelFormat fmt) {
    switch (fmt) {
    case GfxPixelFormat::RGB8:             return { GL_RGB8,              GL_RGB,             GL_UNSIGNED_BYTE };
    case GfxPixelFormat::RGBA8:            return { GL_RGBA8,             GL_RGBA,            GL_UNSIGNED_BYTE };
    case GfxPixelFormat::DepthComponent24: return { GL_DEPTH_COMPONENT24, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT };
    case GfxPixelFormat::Depth24Stencil8:  return { GL_DEPTH24_STENCIL8,  GL_DEPTH_STENCIL,   GL_UNSIGNED_INT_24_8 };
    default:                               return { GL_RGBA8,             GL_RGBA,            GL_UNSIGNED_BYTE };
    }
}

GLenum toGLAttachment(GfxAttachment attachment) {
    switch (attachment) {
    case GfxAttachment::Color0:       return GL_COLOR_ATTACHMENT0;
    case GfxAttachment::Depth:        return GL_DEPTH_ATTACHMENT;
    case GfxAttachment::DepthStencil: return GL_DEPTH_STENCIL_ATTACHMENT;
    default: return GL_COLOR_ATTACHMENT0;
    }
}

std::string readShaderInfoLog(GLuint shader) {
    GLint logLength = 0;
    glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &logLength);
    if (logLength <= 0) return {};
    std::string log(static_cast<size_t>(logLength), '\0');
    glGetShaderInfoLog(shader, logLength, nullptr, log.data());
    // Drop the trailing NUL glGetShaderInfoLog writes inside the buffer.
    if (!log.empty() && log.back() == '\0') log.pop_back();
    return log;
}

std::string readProgramInfoLog(GLuint program) {
    GLint logLength = 0;
    glGetProgramiv(program, GL_INFO_LOG_LENGTH, &logLength);
    if (logLength <= 0) return {};
    std::string log(static_cast<size_t>(logLength), '\0');
    glGetProgramInfoLog(program, logLength, nullptr, log.data());
    if (!log.empty() && log.back() == '\0') log.pop_back();
    return log;
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

void GLDevice::setClearStencil(i32 value) {
    glClearStencil(value);
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
    case BlendMode::Lighten:
        glBlendEquation(GL_MAX);
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE);
        break;
    case BlendMode::Darken:
        glBlendEquation(GL_MIN);
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE);
        break;
    case BlendMode::Overlay:
        glBlendFuncSeparate(GL_DST_COLOR, GL_SRC_COLOR, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
        break;
    }

    if (mode != BlendMode::Lighten && mode != BlendMode::Darken) {
        glBlendEquation(GL_FUNC_ADD);
    }
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

void GLDevice::setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask) {
    glStencilFunc(toGLStencilFunc(func), ref, mask);
}

void GLDevice::setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass) {
    glStencilOp(toGLStencilOp(sfail), toGLStencilOp(dpfail), toGLStencilOp(dppass));
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

u32 GLDevice::createProgram(const char* vertexSrc, const char* fragmentSrc,
                            const GfxAttribBinding* bindings, u32 bindingCount,
                            std::string* outLog, GfxShaderStage* outFailedStage) {
    auto setFailure = [&](GfxShaderStage stage, std::string&& log) {
        if (outLog) *outLog = std::move(log);
        if (outFailedStage) *outFailedStage = stage;
    };

    GLuint vertexShader = glCreateShader(GL_VERTEX_SHADER);
    glShaderSource(vertexShader, 1, &vertexSrc, nullptr);
    glCompileShader(vertexShader);

    GLint success = 0;
    glGetShaderiv(vertexShader, GL_COMPILE_STATUS, &success);
    if (!success) {
        std::string log = readShaderInfoLog(vertexShader);
        ES_LOG_ERROR("Vertex shader compilation failed: {}", log);
        setFailure(GfxShaderStage::Vertex, std::move(log));
        glDeleteShader(vertexShader);
        return 0;
    }

    GLuint fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(fragmentShader, 1, &fragmentSrc, nullptr);
    glCompileShader(fragmentShader);

    glGetShaderiv(fragmentShader, GL_COMPILE_STATUS, &success);
    if (!success) {
        std::string log = readShaderInfoLog(fragmentShader);
        ES_LOG_ERROR("Fragment shader compilation failed: {}", log);
        setFailure(GfxShaderStage::Fragment, std::move(log));
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        return 0;
    }

    GLuint program = glCreateProgram();
    glAttachShader(program, vertexShader);
    glAttachShader(program, fragmentShader);

    for (u32 i = 0; i < bindingCount; ++i) {
        glBindAttribLocation(program, bindings[i].index, bindings[i].name);
    }

    glLinkProgram(program);

    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        std::string log = readProgramInfoLog(program);
        ES_LOG_ERROR("Shader program linking failed: {}", log);
        setFailure(GfxShaderStage::Link, std::move(log));
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        glDeleteProgram(program);
        return 0;
    }

    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    if (outFailedStage) *outFailedStage = GfxShaderStage::None;
    return static_cast<u32>(program);
}

void GLDevice::deleteProgram(u32 programId) {
    if (programId != 0) glDeleteProgram(programId);
}

void GLDevice::useProgram(u32 programId) {
    glUseProgram(programId);
}

i32 GLDevice::getUniformLocation(u32 programId, const char* name) {
    return glGetUniformLocation(programId, name);
}

i32 GLDevice::getAttribLocation(u32 programId, const char* name) {
    return glGetAttribLocation(programId, name);
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

namespace {

GfxUniformType fromGLUniformType(GLenum type) {
    switch (type) {
    case GL_FLOAT:        return GfxUniformType::Float;
    case GL_FLOAT_VEC2:   return GfxUniformType::Vec2;
    case GL_FLOAT_VEC3:   return GfxUniformType::Vec3;
    case GL_FLOAT_VEC4:   return GfxUniformType::Vec4;
    case GL_INT:          return GfxUniformType::Int;
    case GL_INT_VEC2:     return GfxUniformType::IVec2;
    case GL_INT_VEC3:     return GfxUniformType::IVec3;
    case GL_INT_VEC4:     return GfxUniformType::IVec4;
    case GL_BOOL:         return GfxUniformType::Bool;
    case GL_FLOAT_MAT2:   return GfxUniformType::Mat2;
    case GL_FLOAT_MAT3:   return GfxUniformType::Mat3;
    case GL_FLOAT_MAT4:   return GfxUniformType::Mat4;
    case GL_SAMPLER_2D:   return GfxUniformType::Sampler2D;
    case GL_SAMPLER_CUBE: return GfxUniformType::SamplerCube;
    default:              return GfxUniformType::Unknown;
    }
}

}  // namespace

std::vector<GfxUniformInfo> GLDevice::getActiveUniforms(u32 programId) {
    std::vector<GfxUniformInfo> result;
    if (programId == 0) return result;

    GLint count = 0;
    glGetProgramiv(programId, GL_ACTIVE_UNIFORMS, &count);
    if (count <= 0) return result;

    GLint maxNameLen = 0;
    glGetProgramiv(programId, GL_ACTIVE_UNIFORM_MAX_LENGTH, &maxNameLen);
    if (maxNameLen <= 0) maxNameLen = 64;

    std::string nameBuf(static_cast<size_t>(maxNameLen), '\0');
    result.reserve(static_cast<size_t>(count));

    for (GLint i = 0; i < count; ++i) {
        GLsizei nameLen = 0;
        GLint size = 0;
        GLenum type = 0;
        glGetActiveUniform(programId, static_cast<GLuint>(i),
                           static_cast<GLsizei>(maxNameLen), &nameLen,
                           &size, &type, nameBuf.data());

        std::string name(nameBuf.data(), static_cast<size_t>(nameLen));
        // Strip "[0]" suffix so callers look up arrays by their declared name.
        const auto bracket = name.find('[');
        if (bracket != std::string::npos) {
            name.erase(bracket);
        }

        GfxUniformInfo info;
        info.name = std::move(name);
        info.type = fromGLUniformType(type);
        info.location = glGetUniformLocation(programId, info.name.c_str());
        info.arraySize = size > 0 ? static_cast<u32>(size) : 1u;
        result.push_back(std::move(info));
    }

    return result;
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

void GLDevice::bufferData(GfxBufferTarget target, const void* data, u32 sizeBytes, bool dynamic) {
    glBufferData(toGLBufferTarget(target), sizeBytes, data, dynamic ? GL_DYNAMIC_DRAW : GL_STATIC_DRAW);
}

void GLDevice::bufferSubData(GfxBufferTarget target, u32 offset, const void* data, u32 sizeBytes) {
    glBufferSubData(toGLBufferTarget(target), offset, sizeBytes, data);
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

void GLDevice::vertexAttribPointer(u32 index, i32 size, GfxDataType type,
                                   bool normalized, i32 stride, u32 offset) {
    glVertexAttribPointer(index, size, toGLDataType(type), normalized ? GL_TRUE : GL_FALSE,
                          stride, reinterpret_cast<const void*>(static_cast<uintptr_t>(offset)));
}

void GLDevice::vertexAttribDivisor(u32 index, u32 divisor) {
    glVertexAttribDivisor(index, divisor);
}

// =============================================================================
// Draw Calls
// =============================================================================

void GLDevice::drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) {
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indexCount), toGLDataType(indexType),
                   reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)));
}

void GLDevice::drawArrays(u32 first, u32 vertexCount) {
    glDrawArrays(GL_TRIANGLES, static_cast<GLint>(first), static_cast<GLsizei>(vertexCount));
}

void GLDevice::drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) {
    glDrawElementsInstanced(GL_TRIANGLES, static_cast<GLsizei>(indexCount), toGLDataType(indexType),
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
                          GfxPixelFormat format, const void* data) {
    auto gl = toGLPixelFormat(format);
    glBindTexture(GL_TEXTURE_2D, textureId);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(gl.internalFormat),
                 static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                 0, gl.format, gl.type, data);
}

void GLDevice::texSubImage2D(u32 textureId, i32 xoffset, i32 yoffset,
                             u32 width, u32 height,
                             GfxPixelFormat format, const void* data) {
    auto gl = toGLPixelFormat(format);
    glBindTexture(GL_TEXTURE_2D, textureId);
    glTexSubImage2D(GL_TEXTURE_2D, 0, xoffset, yoffset,
                    static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                    gl.format, gl.type, data);
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

void GLDevice::setUnpackFlipY(bool enabled) {
    glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, enabled ? GL_TRUE : GL_FALSE);
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

void GLDevice::framebufferTexture2D(u32 fboId, GfxAttachment attachment, u32 textureId) {
    glBindFramebuffer(GL_FRAMEBUFFER, fboId);
    glFramebufferTexture2D(GL_FRAMEBUFFER, toGLAttachment(attachment), GL_TEXTURE_2D, textureId, 0);
}

bool GLDevice::checkFramebufferStatus() {
    return glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
}

// =============================================================================
// Readback
// =============================================================================

void GLDevice::readPixels(i32 x, i32 y, u32 w, u32 h, GfxPixelFormat format, void* data) {
    auto gl = toGLPixelFormat(format);
    glReadPixels(x, y, static_cast<GLsizei>(w), static_cast<GLsizei>(h), gl.format, gl.type, data);
}

// =============================================================================
// Debug
// =============================================================================

void GLDevice::setWireframe(bool enabled) {
    // glPolygonMode is not available in WebGL2 / GLES3; wireframe is a no-op.
    (void)enabled;
}

u32 GLDevice::getError() {
    return static_cast<u32>(glGetError());
}

std::string GLDevice::getString(GfxStringName name) {
    GLenum e = GL_VERSION;
    switch (name) {
    case GfxStringName::Version:                e = GL_VERSION; break;
    case GfxStringName::Renderer:               e = GL_RENDERER; break;
    case GfxStringName::Vendor:                 e = GL_VENDOR; break;
    case GfxStringName::ShadingLanguageVersion: e = GL_SHADING_LANGUAGE_VERSION; break;
    }
    const char* s = reinterpret_cast<const char*>(glGetString(e));
    return s ? std::string(s) : std::string();
}

i32 GLDevice::getInt(GfxIntParam name) {
    GLenum e = GL_MAX_TEXTURE_SIZE;
    switch (name) {
    case GfxIntParam::MaxTextureSize:       e = GL_MAX_TEXTURE_SIZE; break;
    case GfxIntParam::MaxTextureImageUnits: e = GL_MAX_TEXTURE_IMAGE_UNITS; break;
    case GfxIntParam::MaxVertexAttribs:     e = GL_MAX_VERTEX_ATTRIBS; break;
    }
    GLint v = 0;
    glGetIntegerv(e, &v);
    return static_cast<i32>(v);
}

}  // namespace esengine
