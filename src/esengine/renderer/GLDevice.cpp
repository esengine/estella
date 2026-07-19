// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GLDevice.cpp
 * @brief   OpenGL ES / WebGL implementation of GfxDevice
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "GLDevice.hpp"
#include "OpenGLHeaders.hpp"
#include "../core/Log.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/html5.h>
#endif

#include <cstring>

#ifndef GL_DEPTH_STENCIL
    #define GL_DEPTH_STENCIL 0x84F9
#endif
#ifndef GL_NUM_EXTENSIONS
    #define GL_NUM_EXTENSIONS 0x821D
#endif
// Compressed-texture internal formats. ETC2/EAC is core in GLES3/WebGL2; ASTC and
// S3TC are extension tokens that may be absent from the core gl3.h, so fall back to
// the literal enum values.
#ifndef GL_COMPRESSED_RGB8_ETC2
    #define GL_COMPRESSED_RGB8_ETC2 0x9274
#endif
#ifndef GL_COMPRESSED_RGBA8_ETC2_EAC
    #define GL_COMPRESSED_RGBA8_ETC2_EAC 0x9278
#endif
#ifndef GL_COMPRESSED_RGBA_ASTC_4x4_KHR
    #define GL_COMPRESSED_RGBA_ASTC_4x4_KHR 0x93B0
#endif
#ifndef GL_COMPRESSED_RGBA_ASTC_8x8_KHR
    #define GL_COMPRESSED_RGBA_ASTC_8x8_KHR 0x93B7
#endif
#ifndef GL_COMPRESSED_RGBA_S3TC_DXT1_EXT
    #define GL_COMPRESSED_RGBA_S3TC_DXT1_EXT 0x83F1
#endif
#ifndef GL_COMPRESSED_RGBA_S3TC_DXT5_EXT
    #define GL_COMPRESSED_RGBA_S3TC_DXT5_EXT 0x83F3
#endif
#ifndef GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
    #define GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC 0x9279
#endif
#ifndef GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR
    #define GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR 0x93D0
#endif
#ifndef GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT
    #define GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT 0x8C4F
#endif
#ifndef GL_SRGB8_ALPHA8
    #define GL_SRGB8_ALPHA8 0x8C43
#endif
#ifndef GL_RGBA16F
    #define GL_RGBA16F 0x881A
#endif
#ifndef GL_HALF_FLOAT
    #define GL_HALF_FLOAT 0x140B
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
// EXT_disjoint_timer_query_webgl2 enums — not guaranteed in <GLES3/gl3.h>.
#ifndef GL_TIME_ELAPSED_EXT
    #define GL_TIME_ELAPSED_EXT 0x88BF
#endif
#ifndef GL_GPU_DISJOINT_EXT
    #define GL_GPU_DISJOINT_EXT 0x8FBB
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

GLenum toGLBufferTarget(GfxBufferUsage usage) {
    switch (usage) {
    case GfxBufferUsage::Vertex:  return GL_ARRAY_BUFFER;
    case GfxBufferUsage::Index:   return GL_ELEMENT_ARRAY_BUFFER;
    case GfxBufferUsage::Uniform: return GL_UNIFORM_BUFFER;
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
    case GfxPixelFormat::SRGB8_ALPHA8:     return { GL_SRGB8_ALPHA8,      GL_RGBA,            GL_UNSIGNED_BYTE };
    case GfxPixelFormat::RGBA16F:          return { GL_RGBA16F,           GL_RGBA,            GL_HALF_FLOAT };
    case GfxPixelFormat::DepthComponent24: return { GL_DEPTH_COMPONENT24, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT };
    case GfxPixelFormat::Depth24Stencil8:  return { GL_DEPTH24_STENCIL8,  GL_DEPTH_STENCIL,   GL_UNSIGNED_INT_24_8 };
    default:                               return { GL_RGBA8,             GL_RGBA,            GL_UNSIGNED_BYTE };
    }
}

GLenum toGLCompressedFormat(GfxCompressedFormat fmt) {
    switch (fmt) {
    case GfxCompressedFormat::ETC2_RGB8:  return GL_COMPRESSED_RGB8_ETC2;
    case GfxCompressedFormat::ETC2_RGBA8: return GL_COMPRESSED_RGBA8_ETC2_EAC;
    case GfxCompressedFormat::ASTC_4x4:   return GL_COMPRESSED_RGBA_ASTC_4x4_KHR;
    case GfxCompressedFormat::ASTC_8x8:   return GL_COMPRESSED_RGBA_ASTC_8x8_KHR;
    case GfxCompressedFormat::S3TC_DXT1:  return GL_COMPRESSED_RGBA_S3TC_DXT1_EXT;
    case GfxCompressedFormat::S3TC_DXT5:  return GL_COMPRESSED_RGBA_S3TC_DXT5_EXT;
    case GfxCompressedFormat::ETC2_RGBA8_SRGB: return GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC;
    case GfxCompressedFormat::ASTC_4x4_SRGB:   return GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR;
    case GfxCompressedFormat::S3TC_DXT5_SRGB:  return GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT;
    default:                              return GL_COMPRESSED_RGBA8_ETC2_EAC;
    }
}

// GLES3-correct extension probe (glGetString(GL_EXTENSIONS) returns null on a
// core profile). Emscripten exposes WebGL extensions here under GL-style names.
bool glExtensionPresent(const char* name) {
    GLint count = 0;
    glGetIntegerv(GL_NUM_EXTENSIONS, &count);
    for (GLint i = 0; i < count; ++i) {
        const char* ext = reinterpret_cast<const char*>(glGetStringi(GL_EXTENSIONS, static_cast<GLuint>(i)));
        if (ext && std::strcmp(ext, name) == 0) return true;
    }
    return false;
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
    if (mask == 0) return;

    // Load-op semantics, same as beginRenderPass: glClear honors write masks, so a
    // restrictive mask left by the previous pipeline would silently veto the clear.
    // Force the cleared attachments' masks open and drop the cached pipeline (the
    // next setPipeline re-applies its own masks). The scissor rectangle is honored —
    // the TS multi-camera flow clears per-camera regions through it.
    if (color)   setColorMask(true, true, true, true);
    if (depth)   setDepthWrite(true);
    if (stencil) setStencilMask(0xFF);
    glClear(mask);
    invalidatePipelineCache();
}

// =============================================================================
// Blend State
// =============================================================================

void GLDevice::setBlendEnabled(bool enabled) {
    setCapability(GL_BLEND, enabled);
}

void GLDevice::setBlendMode(BlendMode mode) {
    if (mode == current_blend_) return;
    current_blend_ = mode;
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
    const int want = enabled ? 1 : 0;
    if (scissor_test_ == want) return;  // DrawList toggles this every draw; most are no-ops
    scissor_test_ = want;
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
// Shader Program
// =============================================================================

ShaderHandle GLDevice::createProgram(const GfxShaderSource& source,
                                     const GfxAttribBinding* bindings, u32 bindingCount,
                                     std::string* outLog, GfxShaderStage* outFailedStage) {
    if (source.language != GfxShaderLanguage::GLSL_ES300) {
        if (outLog) *outLog = "GLDevice compiles GLSL ES 300 only (got another language)";
        if (outFailedStage) *outFailedStage = GfxShaderStage::Vertex;
        ES_LOG_ERROR("GLDevice::createProgram: unsupported shader language");
        return ShaderHandle::Invalid;
    }
    const char* vertexSrc = source.vertexSrc;
    const char* fragmentSrc = source.fragmentSrc;
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
        return ShaderHandle::Invalid;
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
        return ShaderHandle::Invalid;
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
        return ShaderHandle::Invalid;
    }

    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    if (outFailedStage) *outFailedStage = GfxShaderStage::None;
    return ShaderHandle{program};
}

void GLDevice::deleteProgram(ShaderHandle program) {
    if (program != ShaderHandle::Invalid) glDeleteProgram(static_cast<GLuint>(program));
}

void GLDevice::useProgram(ShaderHandle program) {
    if (program == current_program_) return;
    glUseProgram(static_cast<GLuint>(program));
    current_program_ = program;
}

i32 GLDevice::getUniformLocation(ShaderHandle program, const char* name) {
    return glGetUniformLocation(static_cast<GLuint>(program), name);
}

i32 GLDevice::getAttribLocation(ShaderHandle program, const char* name) {
    return glGetAttribLocation(static_cast<GLuint>(program), name);
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

std::vector<GfxUniformInfo> GLDevice::getActiveUniforms(ShaderHandle program) {
    std::vector<GfxUniformInfo> result;
    if (program == ShaderHandle::Invalid) return result;
    const GLuint programId = static_cast<GLuint>(program);

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

void GLDevice::uploadBufferStore(BufferHandle buffer, u32 offsetBytes, const void* data,
                                 u32 sizeBytes, bool respec) {
    const u32 id = static_cast<u32>(buffer);
    auto it = buffer_meta_.find(id);
    if (it == buffer_meta_.end()) return;
    const BufferMeta& meta = it->second;

    // GL_ELEMENT_ARRAY_BUFFER binding is VAO state: uploading through it while some
    // VAO is bound would silently rewire that VAO's index buffer. Detach first.
    if (meta.usage == GfxBufferUsage::Index) {
        glBindVertexArray(0);
        bound_vao_ = 0;
    }

    const GLenum target = toGLBufferTarget(meta.usage);
    glBindBuffer(target, id);
    if (respec) {
        glBufferData(target, sizeBytes, data, meta.dynamic ? GL_DYNAMIC_DRAW : GL_STATIC_DRAW);
    } else {
        glBufferSubData(target, offsetBytes, sizeBytes, data);
    }
}

BufferHandle GLDevice::createBuffer(const BufferDesc& desc, const void* initialData) {
    GLuint id = 0;
    glGenBuffers(1, &id);
    buffer_meta_[id] = BufferMeta{desc.usage, desc.dynamic};
    uploadBufferStore(BufferHandle{id}, 0, initialData, desc.size, /*respec=*/true);
    return BufferHandle{id};
}

void GLDevice::deleteBuffer(BufferHandle buffer) {
    GLuint id = static_cast<GLuint>(buffer);
    glDeleteBuffers(1, &id);
    buffer_meta_.erase(static_cast<u32>(buffer));
}

void GLDevice::updateBuffer(BufferHandle buffer, u32 offsetBytes, const void* data, u32 sizeBytes) {
    uploadBufferStore(buffer, offsetBytes, data, sizeBytes, /*respec=*/false);
}

void GLDevice::resizeBuffer(BufferHandle buffer, u32 sizeBytes, const void* data) {
    uploadBufferStore(buffer, 0, data, sizeBytes, /*respec=*/true);
}

void GLDevice::setUniformBuffer(u32 slot, BufferHandle buffer) {
    glBindBufferBase(GL_UNIFORM_BUFFER, slot, static_cast<GLuint>(buffer));
}

// =============================================================================
// Vertex Input
// =============================================================================

VertexLayoutHandle GLDevice::createVertexLayout(const VertexLayoutDesc& desc) {
    LayoutRecord rec;
    rec.desc = desc;
    rec.alive = true;
    layouts_.push_back(rec);
    return static_cast<VertexLayoutHandle>(layouts_.size());  // 1-based; 0 == Invalid
}

void GLDevice::deleteVertexLayout(VertexLayoutHandle layout) {
    const u32 index = static_cast<u32>(layout);
    if (index == 0 || index > layouts_.size()) return;
    LayoutRecord& rec = layouts_[index - 1];
    if (rec.vao != 0) {
        if (bound_vao_ == rec.vao) {
            glBindVertexArray(0);
            bound_vao_ = 0;
        }
        glDeleteVertexArrays(1, &rec.vao);
        rec.vao = 0;
    }
    rec.alive = false;
}

void GLDevice::setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) {
    if (slot >= MAX_VERTEX_BUFFER_SLOTS) return;
    pending_vbo_[slot] = static_cast<u32>(buffer);
    pending_vbo_offset_[slot] = offsetBytes;
}

void GLDevice::setIndexBuffer(BufferHandle buffer) {
    pending_ibo_ = static_cast<u32>(buffer);
}

void GLDevice::prepareVertexState() {
    const u32 index = static_cast<u32>(current_layout_);
    if (index == 0 || index > layouts_.size()) return;
    LayoutRecord& rec = layouts_[index - 1];
    if (!rec.alive) return;

    if (rec.vao == 0) {
        glGenVertexArrays(1, &rec.vao);
        rec.configured = false;
    }
    if (bound_vao_ != rec.vao) {
        glBindVertexArray(rec.vao);
        bound_vao_ = rec.vao;
    }

    if (!rec.configured || rec.bakedIbo != pending_ibo_) {
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, pending_ibo_);
        rec.bakedIbo = pending_ibo_;
    }

    for (u32 slot = 0; slot < MAX_VERTEX_BUFFER_SLOTS; ++slot) {
        bool slotUsed = false;
        for (u32 a = 0; a < rec.desc.attributeCount; ++a) {
            if (rec.desc.attributes[a].bufferSlot == slot) { slotUsed = true; break; }
        }
        if (!slotUsed) continue;
        if (rec.configured && rec.bakedVbo[slot] == pending_vbo_[slot]
            && rec.bakedOffset[slot] == pending_vbo_offset_[slot]) {
            continue;
        }

        glBindBuffer(GL_ARRAY_BUFFER, pending_vbo_[slot]);
        for (u32 a = 0; a < rec.desc.attributeCount; ++a) {
            const GfxVertexAttribute& attr = rec.desc.attributes[a];
            if (attr.bufferSlot != slot) continue;
            glEnableVertexAttribArray(attr.location);
            glVertexAttribPointer(
                attr.location, attr.components, toGLDataType(attr.type),
                attr.normalized ? GL_TRUE : GL_FALSE,
                static_cast<GLsizei>(rec.desc.strides[slot]),
                reinterpret_cast<const void*>(
                    static_cast<uintptr_t>(pending_vbo_offset_[slot] + attr.offset)));
            glVertexAttribDivisor(attr.location, rec.desc.instanceStep[slot] ? 1 : 0);
        }
        rec.bakedVbo[slot] = pending_vbo_[slot];
        rec.bakedOffset[slot] = pending_vbo_offset_[slot];
    }
    rec.configured = true;
}

u32 GLDevice::getUniformBlockIndex(ShaderHandle program, const char* name) {
    return static_cast<u32>(glGetUniformBlockIndex(static_cast<GLuint>(program), name));
}

void GLDevice::uniformBlockBinding(ShaderHandle program, u32 blockIndex, u32 bindingPoint) {
    glUniformBlockBinding(static_cast<GLuint>(program), blockIndex, bindingPoint);
}

// =============================================================================
// Pipeline State
// =============================================================================

PipelineHandle GLDevice::createPipeline(const PipelineDesc& desc) {
    for (u32 i = 0; i < pipelines_.size(); ++i) {
        if (pipelines_[i] == desc) {
            return static_cast<PipelineHandle>(i + 1);
        }
    }
    pipelines_.push_back(desc);
    return static_cast<PipelineHandle>(pipelines_.size());  // 1-based; 0 == Invalid
}

void GLDevice::applyStencilMode(GfxStencilMode mode) {
    // Mirrors the former StateTracker stencil sequences. The reference value is applied
    // separately by setStencilReference (it is dynamic, not pipeline state).
    switch (mode) {
    case GfxStencilMode::Off:
        setStencilTest(false);
        setStencilMask(0xFF);
        setColorMask(true, true, true, true);
        break;
    case GfxStencilMode::Write:
        setStencilTest(true);
        setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep, GfxStencilOp::Replace);
        setColorMask(false, false, false, false);
        setStencilMask(0xFF);
        break;
    case GfxStencilMode::Test:
        setStencilTest(true);
        setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep, GfxStencilOp::Keep);
        setColorMask(true, true, true, true);
        setStencilMask(0x00);
        break;
    }
}

void GLDevice::setPipeline(PipelineHandle handle) {
    if (handle == current_pipeline_ || handle == PipelineHandle::Invalid) return;

    u32 index = static_cast<u32>(handle) - 1;
    if (index >= pipelines_.size()) return;
    const PipelineDesc& desc = pipelines_[index];

    useProgram(desc.program);
    setBlendEnabled(desc.blendEnabled);
    setBlendMode(desc.blend);
    setDepthTest(desc.depthTest);
    setDepthWrite(desc.depthWrite);
    setCulling(desc.cullEnabled);
    if (desc.cullEnabled) setCullFace(desc.cullFront);
    applyStencilMode(desc.stencil);

    current_pipeline_ = handle;
    current_stencil_mode_ = desc.stencil;
    current_layout_ = desc.vertexLayout;
}

void GLDevice::setStencilReference(i32 ref) {
    switch (current_stencil_mode_) {
    case GfxStencilMode::Write:
        setStencilFunc(GfxStencilFunc::Always, ref, 0xFF);
        break;
    case GfxStencilMode::Test:
        setStencilFunc(GfxStencilFunc::Equal, ref, 0xFF);
        break;
    case GfxStencilMode::Off:
        break;
    }
}

void GLDevice::invalidatePipelineCache() {
    current_pipeline_ = PipelineHandle::Invalid;
    current_stencil_mode_ = GfxStencilMode::Off;
    current_program_ = ShaderHandle::Invalid;
    current_blend_ = static_cast<BlendMode>(0xFF);
}

// =============================================================================
// Draw Calls
// =============================================================================

void GLDevice::drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) {
    prepareVertexState();
    glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indexCount), toGLDataType(indexType),
                   reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)));
}

void GLDevice::drawArrays(u32 first, u32 vertexCount) {
    prepareVertexState();
    glDrawArrays(GL_TRIANGLES, static_cast<GLint>(first), static_cast<GLsizei>(vertexCount));
}

void GLDevice::drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) {
    prepareVertexState();
    glDrawElementsInstanced(GL_TRIANGLES, static_cast<GLsizei>(indexCount), toGLDataType(indexType),
                            reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)),
                            static_cast<GLsizei>(instanceCount));
}

// =============================================================================
// Textures
// =============================================================================

void GLDevice::bindTexture(u32 slot, TextureHandle texture) {
    if (slot >= kTextureSlots) {  // beyond the cache — bind directly
        glActiveTexture(GL_TEXTURE0 + slot);
        glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture));
        return;
    }
    const u32 id = static_cast<u32>(texture);
    if (bound_texture_[slot] == id) return;  // already bound to this sampler unit
    if (active_texture_unit_ != slot) {
        glActiveTexture(GL_TEXTURE0 + slot);
        active_texture_unit_ = slot;
    }
    glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(texture));
    bound_texture_[slot] = id;
}

void GLDevice::bindTextureForEdit(u32 id) {
    glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(id));
    if (active_texture_unit_ < kTextureSlots) bound_texture_[active_texture_unit_] = id;
}

TextureHandle GLDevice::createTexture(const TextureDesc& desc, const void* pixels) {
    GLuint id = 0;
    glGenTextures(1, &id);
    texture_formats_[id] = desc.format;

    auto gl = toGLPixelFormat(desc.format);
    bindTextureForEdit(id);
    if (pixels && desc.flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_TRUE);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(gl.internalFormat),
                 static_cast<GLsizei>(desc.width), static_cast<GLsizei>(desc.height),
                 0, gl.format, gl.type, pixels);
    if (pixels && desc.flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_FALSE);

    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLFilter(desc.minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));

    if (desc.mipmaps) {
        glGenerateMipmap(GL_TEXTURE_2D);
    }
    return TextureHandle{id};
}

TextureHandle GLDevice::createCompressedTexture(const TextureDesc& desc, GfxCompressedFormat format,
                                                const void* data, u32 byteLength) {
    GLuint id = 0;
    glGenTextures(1, &id);
    texture_formats_[id] = desc.format;

    bindTextureForEdit(id);
    glCompressedTexImage2D(GL_TEXTURE_2D, 0, toGLCompressedFormat(format),
                           static_cast<GLsizei>(desc.width), static_cast<GLsizei>(desc.height),
                           0, static_cast<GLsizei>(byteLength), data);

    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLFilter(desc.minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));
    return TextureHandle{id};
}

TextureHandle GLDevice::importExternalTexture(u32 nativeId, const TextureDesc& desc) {
    texture_formats_[nativeId] = desc.format;
    return TextureHandle{nativeId};
}

void GLDevice::deleteTexture(TextureHandle texture) {
    GLuint id = static_cast<GLuint>(texture);
    glDeleteTextures(1, &id);
    texture_formats_.erase(static_cast<u32>(texture));
}

void GLDevice::updateTexture(TextureHandle texture, i32 x, i32 y, u32 width, u32 height,
                             const void* pixels, bool flipY) {
    auto it = texture_formats_.find(static_cast<u32>(texture));
    auto gl = toGLPixelFormat(it != texture_formats_.end() ? it->second : GfxPixelFormat::RGBA8);
    bindTextureForEdit(static_cast<u32>(texture));
    if (flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_TRUE);
    glTexSubImage2D(GL_TEXTURE_2D, 0, x, y,
                    static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                    gl.format, gl.type, pixels);
    if (flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_FALSE);
}

void GLDevice::setTextureParams(TextureHandle texture, TextureFilter min, TextureFilter mag,
                                TextureWrap wrapS, TextureWrap wrapT) {
    bindTextureForEdit(static_cast<u32>(texture));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLFilter(min));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(mag));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(wrapT));
}

void GLDevice::generateMipmaps(TextureHandle texture) {
    bindTextureForEdit(static_cast<u32>(texture));
    glGenerateMipmap(GL_TEXTURE_2D);
}

// =============================================================================
// Framebuffer
// =============================================================================

FramebufferHandle GLDevice::createFramebuffer(const FramebufferDesc& desc) {
    GLuint id = 0;
    glGenFramebuffers(1, &id);
    glBindFramebuffer(GL_FRAMEBUFFER, id);

    if (desc.color0 != TextureHandle::Invalid) {
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D,
                               static_cast<GLuint>(desc.color0), 0);
    }
    if (desc.depthStencil != TextureHandle::Invalid) {
        // Attach point follows the texture's pixel format (depth-only vs packed depth+stencil).
        auto it = texture_formats_.find(static_cast<u32>(desc.depthStencil));
        const bool depthOnly = it != texture_formats_.end()
                            && it->second == GfxPixelFormat::DepthComponent24;
        glFramebufferTexture2D(GL_FRAMEBUFFER,
                               depthOnly ? GL_DEPTH_ATTACHMENT : GL_DEPTH_STENCIL_ATTACHMENT,
                               GL_TEXTURE_2D, static_cast<GLuint>(desc.depthStencil), 0);
    }

    const bool complete = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if (!complete) {
        glDeleteFramebuffers(1, &id);
        return FramebufferHandle::Default;
    }
    return FramebufferHandle{id};
}

void GLDevice::deleteFramebuffer(FramebufferHandle framebuffer) {
    GLuint id = static_cast<GLuint>(framebuffer);
    if (id != 0) glDeleteFramebuffers(1, &id);
}

void GLDevice::clearStencil(i32 value) {
    setClearStencil(value);
    clear(false, false, true);
}

void GLDevice::beginRenderPass(const RenderPassDesc& desc) {
    glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(desc.target));
    if (!desc.clearColor && !desc.clearDepth && !desc.clearStencil) return;

    // Load-op values ride the pass — no sticky device clear state to drift.
    if (desc.clearColor) {
        setClearColor(desc.clearColorValue[0], desc.clearColorValue[1],
                      desc.clearColorValue[2], desc.clearColorValue[3]);
    }
    if (desc.clearStencil) setClearStencil(desc.clearStencilValue);

    // Load-op clears are self-contained: a scoped clear rides its OWN scissor
    // rect, an unscoped one forces the scissor OFF (a real load-op covers the
    // whole attachment — it must not be vetoed by whatever scissor the previous
    // frame's last draw left enabled). Scissor ends disabled either way; the
    // next draw's command state re-applies its own.
    const bool scoped = desc.clearW != 0;
    if (scoped) {
        setScissorTest(true);
        setScissor(desc.clearX, desc.clearY,
                   static_cast<i32>(desc.clearW), static_cast<i32>(desc.clearH));
    } else {
        setScissorTest(false);
    }
    clear(desc.clearColor, desc.clearDepth, desc.clearStencil);
    if (scoped) setScissorTest(false);
}

void GLDevice::endRenderPass() {
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

// =============================================================================
// Readback (async seam; GL resolves at request time)
// =============================================================================

ReadbackHandle GLDevice::requestReadback(FramebufferHandle target, u32 w, u32 h) {
    if (w == 0 || h == 0) return ReadbackHandle::Invalid;
    std::vector<u8> pixels(static_cast<usize>(w) * h * 4);
    // Called outside a pass (framebuffer 0 bound); bind the source, read, restore.
    glBindFramebuffer(GL_FRAMEBUFFER, static_cast<GLuint>(target));
    auto gl = toGLPixelFormat(GfxPixelFormat::RGBA8);
    glReadPixels(0, 0, static_cast<GLsizei>(w), static_cast<GLsizei>(h), gl.format, gl.type,
                 pixels.data());
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    const u32 id = next_readback_id_++;
    readbacks_[id] = std::move(pixels);
    return static_cast<ReadbackHandle>(id);
}

GfxReadbackStatus GLDevice::pollReadback(ReadbackHandle handle) {
    return readbacks_.count(static_cast<u32>(handle)) ? GfxReadbackStatus::Ready
                                                      : GfxReadbackStatus::Failed;
}

bool GLDevice::takeReadback(ReadbackHandle handle, void* dest, usize destSize) {
    auto it = readbacks_.find(static_cast<u32>(handle));
    if (it == readbacks_.end() || destSize < it->second.size()) return false;
    std::memcpy(dest, it->second.data(), it->second.size());
    readbacks_.erase(it);
    return true;
}

void GLDevice::discardReadback(ReadbackHandle handle) {
    readbacks_.erase(static_cast<u32>(handle));
}

// =============================================================================
// GPU Timing
// =============================================================================

u32 GLDevice::createTimerQuery() {
    if (timer_query_state_ == 0) {
#ifdef __EMSCRIPTEN__
        // Must ENABLE the extension (not just check presence) so emscripten routes the
        // TIME_ELAPSED query entry points.
        EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();
        timer_query_state_ =
            (ctx && emscripten_webgl_enable_extension(ctx, "EXT_disjoint_timer_query_webgl2")) ? 1 : 2;
#else
        timer_query_state_ = 2;
#endif
    }
    if (timer_query_state_ != 1) return 0;
    GLuint id = 0;
    glGenQueries(1, &id);
    return static_cast<u32>(id);
}

void GLDevice::beginTimerQuery(u32 query) {
    glBeginQuery(GL_TIME_ELAPSED_EXT, query);
}

void GLDevice::endTimerQuery() {
    glEndQuery(GL_TIME_ELAPSED_EXT);
}

bool GLDevice::timerDisjoint() {
    GLint disjoint = 0;
    glGetIntegerv(GL_GPU_DISJOINT_EXT, &disjoint);
    return disjoint != 0;
}

bool GLDevice::getTimerQueryNs(u32 query, u64* outNanoseconds) {
    GLuint available = 0;
    glGetQueryObjectuiv(query, GL_QUERY_RESULT_AVAILABLE, &available);
    if (!available) return false;
    GLuint ns = 0;
    glGetQueryObjectuiv(query, GL_QUERY_RESULT, &ns);
    if (outNanoseconds) *outNanoseconds = ns;
    return true;
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

bool GLDevice::supportsCompressedFormat(GfxCompressedFormat format) {
    switch (format) {
    case GfxCompressedFormat::ETC2_RGB8:
    case GfxCompressedFormat::ETC2_RGBA8:
        return true;  // ETC2/EAC is core in GLES3 / WebGL2 — no extension needed
    case GfxCompressedFormat::ASTC_4x4:
    case GfxCompressedFormat::ASTC_8x8:
        return glExtensionPresent("GL_KHR_texture_compression_astc_ldr")
            || glExtensionPresent("WEBGL_compressed_texture_astc");
    case GfxCompressedFormat::S3TC_DXT1:
    case GfxCompressedFormat::S3TC_DXT5:
        return glExtensionPresent("GL_EXT_texture_compression_s3tc")
            || glExtensionPresent("WEBGL_compressed_texture_s3tc");
    case GfxCompressedFormat::ETC2_RGBA8_SRGB:
        return true;  // sRGB ETC2/EAC is core alongside the UNORM variant
    case GfxCompressedFormat::ASTC_4x4_SRGB:
        return glExtensionPresent("GL_KHR_texture_compression_astc_ldr")
            || glExtensionPresent("WEBGL_compressed_texture_astc");
    case GfxCompressedFormat::S3TC_DXT5_SRGB:
        // Desktop GL ships sRGB DXT via EXT_texture_sRGB; WebGL splits it out.
        return glExtensionPresent("GL_EXT_texture_sRGB")
            || glExtensionPresent("WEBGL_compressed_texture_s3tc_srgb");
    }
    return false;
}

bool GLDevice::supportsFloatTargets() {
    // Rendering INTO RGBA16F needs EXT_color_buffer_float on WebGL2 (sampling
    // half-float textures is core; only attachment renderability is gated).
    return glExtensionPresent("GL_EXT_color_buffer_float")
        || glExtensionPresent("EXT_color_buffer_float");
}

}  // namespace esengine
