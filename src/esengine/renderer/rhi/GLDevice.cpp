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

#include "./GLDevice.hpp"
#include "./OpenGLHeaders.hpp"
#include "../../core/Log.hpp"

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
#ifndef GL_RGBA32F
    #define GL_RGBA32F 0x8814
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

/** A texture with a chain samples through it; GL ignores the chain otherwise. */
GLenum toGLMinFilter(const TextureDesc& desc) {
    if (!desc.mipmaps) return toGLFilter(desc.minFilter);
    return desc.minFilter == TextureFilter::Nearest ? GL_NEAREST_MIPMAP_NEAREST : GL_LINEAR_MIPMAP_LINEAR;
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

/** Whether a data type carries integers a shader reads as integers. */
bool isIntegerAttribute(GfxDataType type) {
    return type == GfxDataType::UnsignedByte || type == GfxDataType::UnsignedShort
        || type == GfxDataType::UnsignedInt || type == GfxDataType::Int;
}

GLPixelFormatInfo toGLPixelFormat(GfxPixelFormat fmt) {
    switch (fmt) {
    case GfxPixelFormat::RGB8:             return { GL_RGB8,              GL_RGB,             GL_UNSIGNED_BYTE };
    case GfxPixelFormat::RGBA8:            return { GL_RGBA8,             GL_RGBA,            GL_UNSIGNED_BYTE };
    case GfxPixelFormat::SRGB8_ALPHA8:     return { GL_SRGB8_ALPHA8,      GL_RGBA,            GL_UNSIGNED_BYTE };
    case GfxPixelFormat::RGBA16F:          return { GL_RGBA16F,           GL_RGBA,            GL_HALF_FLOAT };
    case GfxPixelFormat::RGBA32F:          return { GL_RGBA32F,           GL_RGBA,            GL_FLOAT };
    case GfxPixelFormat::DepthComponent24: return { GL_DEPTH_COMPONENT24, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT };
    case GfxPixelFormat::Depth24Stencil8:  return { GL_DEPTH24_STENCIL8,  GL_DEPTH_STENCIL,   GL_UNSIGNED_INT_24_8 };
    default:                               return { GL_RGBA8,             GL_RGBA,            GL_UNSIGNED_BYTE };
    }
}

/// GL reads each source row padded up to UNPACK_ALIGNMENT (4 by default) while
/// engine uploads are tightly packed, so a row whose byte count is not 4-aligned
/// has to drop it to 1 — otherwise GL reads past the end of the last row.
struct TightRowScope {
    bool tightened;
    TightRowScope(GfxPixelFormat fmt, u32 width)
        : tightened((static_cast<u64>(width) * gfxBytesPerPixel(fmt)) % 4u != 0) {
        if (tightened) glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    }
    ~TightRowScope() { if (tightened) glPixelStorei(GL_UNPACK_ALIGNMENT, 4); }
};

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
#ifdef __EMSCRIPTEN__
// OES_draw_buffers_indexed is not in Emscripten's GL layer: the one call it is needed for goes to the context directly.
EM_JS(void, es_gl_surface_blend, (int off), {
    var ctx = GLctx;
    var ext = ctx && (ctx.esIndexedBlend || (ctx.esIndexedBlend = ctx.getExtension('OES_draw_buffers_indexed')));
    if (!ext) return;
    if (off) ext.disableiOES(ctx.BLEND, 1); else ext.enableiOES(ctx.BLEND, 1);
});
#endif

bool glExtensionPresent(const char* name) {
    GLint count = 0;
    glGetIntegerv(GL_NUM_EXTENSIONS, &count);
    for (GLint i = 0; i < count; ++i) {
        const char* ext = reinterpret_cast<const char*>(glGetStringi(GL_EXTENSIONS, static_cast<GLuint>(i)));
        if (ext && std::strcmp(ext, name) == 0) return true;
    }
    return false;
}

/**
 * How far the bound texture is sharpened where it is seen at a slant. A mipmapped texture is averaged to the footprint's longer side, so a
 * floor, a hair card or a sleeve seen edge-on washes out; with this the sampler takes extra samples along the long side instead.
 * WebGL2 has it as an extension and an extension may be absent, so it is asked once and left alone where it is not there.
 */
void setAnisotropy(const TextureDesc& desc, bool mipped, GLenum target = GL_TEXTURE_2D) {
    static const GLfloat kMax = [] {
        constexpr GLenum kMaxAnisotropy = 0x84FF;  // GL_MAX_TEXTURE_MAX_ANISOTROPY_EXT
        if (!(glExtensionPresent("GL_EXT_texture_filter_anisotropic") || glExtensionPresent("EXT_texture_filter_anisotropic"))) return 1.0f;
        GLfloat v = 1.0f;
        glGetFloatv(kMaxAnisotropy, &v);
        return v < 1.0f ? 1.0f : v;
    }();
    if (kMax <= 1.0f) return;
    constexpr GLenum kTextureMaxAnisotropy = 0x84FE;  // GL_TEXTURE_MAX_ANISOTROPY_EXT
    const bool linear = desc.minFilter != TextureFilter::Nearest && desc.magFilter != TextureFilter::Nearest;
    glTexParameterf(target, kTextureMaxAnisotropy, (mipped && linear) ? (kMax < 16.0f ? kMax : 16.0f) : 1.0f);
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

void GLDevice::resetDrawStateCaches() {
    for (i8& state : cap_state_) state = -1;
    depth_mask_ = -1;
    color_mask_ = -1;
    stencil_mask_ = -1;
    uniform_bound_.clear();
}

void GLDevice::setCap(Cap cap, u32 glCap, bool enabled) {
    const i8 want = enabled ? 1 : 0;
    if (cap_state_[cap] == want) return;
    cap_state_[cap] = want;
    setCapability(static_cast<GLenum>(glCap), enabled);
}

void GLDevice::init() {
    float_targets_ = -1;
    glEnable(GL_DEPTH_TEST);
    // GL's own default, stated because the second backend states it too: a rule
    // one backend declares and the other inherits can drift with neither saying so.
    glDepthFunc(GL_LESS);
    glEnable(GL_BLEND);
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    // Depth test and blend were just turned on, but a new context knows nothing the old one was told: nothing is assumed held.
    resetDrawStateCaches();
    captureDeviceIdentity();
    ES_LOG_DEBUG("GLDevice initialized");
}

void GLDevice::captureDeviceIdentity() {
    std::string vendor = getString(GfxStringName::Vendor);
    std::string renderer = getString(GfxStringName::Renderer);
#ifdef __EMSCRIPTEN__
    // On the web GL_VENDOR/GL_RENDERER are MASKED — every Mac answers "WebKit
    // WebGL", which names a browser, not a GPU. The real strings sit behind an
    // extension that must be enabled before its enums resolve.
    constexpr GLenum UNMASKED_VENDOR = 0x9245;
    constexpr GLenum UNMASKED_RENDERER = 0x9246;
    // A composing draw (water, glass) writes the surface record unblended while it blends its colour: see applySurfaceBlend.
    indexed_blend_ = emscripten_webgl_enable_extension(emscripten_webgl_get_current_context(), "OES_draw_buffers_indexed") ? 1 : 0;
    if (emscripten_webgl_enable_extension(emscripten_webgl_get_current_context(),
                                          "WEBGL_debug_renderer_info")) {
        const char* v = reinterpret_cast<const char*>(glGetString(UNMASKED_VENDOR));
        const char* r = reinterpret_cast<const char*>(glGetString(UNMASKED_RENDERER));
        // Kept only when the driver actually answered: a browser that refuses
        // the extension leaves the masked pair, which is worse than nothing only
        // if it is silently replaced by an empty string.
        if (v && *v) vendor = v;
        if (r && *r) renderer = r;
    }
#endif
    // Asked while the answer still exists: glGetString returns null on a lost
    // context, so a report assembled after the loss would name no driver.
    setDeviceIdentity("WebGL2", std::move(vendor), std::move(renderer),
                      getString(GfxStringName::Version));
}

void GLDevice::onDeviceLost() {
#ifdef __EMSCRIPTEN__
    // Only where the context is CONFIRMED gone: on a lost one these are silent
    // no-ops that still free the host's wrapper — its tables are global, so a
    // dead context otherwise leaks every id it minted. On a live one they delete.
    const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();
    if (ctx == 0 || !emscripten_is_webgl_context_lost(ctx)) return;

    for (usize id = 0; id < buffer_names_.size(); ++id) {
        GLuint name = buffer_names_[id];
        if (name) glDeleteBuffers(1, &name);
    }
    for (usize id = 0; id < texture_names_.size(); ++id) {
        GLuint name = texture_names_[id];
        if (!name) continue;
        if (isRenderbuffer(static_cast<u32>(id))) glDeleteRenderbuffers(1, &name);
        else glDeleteTextures(1, &name);
    }
    for (usize id = 0; id < framebuffer_names_.size(); ++id) {
        GLuint name = framebuffer_names_[id];
        if (name) glDeleteFramebuffers(1, &name);
    }
    for (auto& [id, resolve] : framebuffer_resolve_) {
        if (resolve.destFbo) glDeleteFramebuffers(1, &resolve.destFbo);
    }
    for (auto& [id, shaders] : pending_programs_) {
        glDeleteShader(shaders.vertex);
        glDeleteShader(shaders.fragment);
    }
    for (usize id = 0; id < program_names_.size(); ++id) {
        if (program_names_[id]) glDeleteProgram(program_names_[id]);
    }
    for (usize id = 0; id < query_names_.size(); ++id) {
        GLuint name = query_names_[id];
        if (name) glDeleteQueries(1, &name);
    }
    for (auto& [id, cache] : vaos_) {
        if (cache.vao) glDeleteVertexArrays(1, &cache.vao);
    }
#endif
}

bool GLDevice::recreateDevice() {
#ifdef __EMSCRIPTEN__
    // There is no device to build: the browser restores the context on the same
    // handle, and until it does there is nothing to do but wait.
    const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();
    if (ctx == 0 || emscripten_is_webgl_context_lost(ctx)) return false;
#endif
    // Every name belonged to the old context. The registry rebuilds each object
    // behind its id; nothing here survives but the maps' shape.
    buffer_names_.clear();
    texture_names_.clear();
    array_names_.clear();
    program_names_.clear();
    pending_programs_.clear();
    failed_programs_.clear();
    framebuffer_names_.clear();
    query_names_.clear();
    framebuffer_resolve_.clear();
    vaos_.clear();
    readbacks_.clear();
    max_samples_ = 0;
    // A timer query in flight was begun on the old context, so the timings are
    // disjoint; the extension itself is enabled per context and must be again.
    timer_query_state_ = 0;
    timer_disjoint_pending_ = true;

    resetStateCache();
    init();
    return true;
}

void GLDevice::resetStateCache() {
    current_pipeline_id_ = 0;
    current_stencil_mode_ = GfxStencilMode::Off;
    current_program_name_ = 0;
    current_blend_ = static_cast<BlendMode>(0xFF);
    current_layout_ = 0;
    active_texture_unit_ = 0;
    for (u32 i = 0; i < kTextureSlots; ++i) bound_texture_[i] = 0;
    for (u32 slot = 0; slot < MAX_VERTEX_BUFFER_SLOTS; ++slot) {
        pending_vbo_[slot] = 0;
        pending_vbo_offset_[slot] = 0;
    }
    pending_ibo_ = 0;
    bound_vao_ = 0;
    scissor_test_ = -1;
    current_depth_bias_ = 0;
    alpha_to_coverage_ = -1;
    depth_equal_ = -1;
    surface_blend_off_ = false;
    current_framebuffer_ = 0;
    timer_query_state_ = 0;
    resetDrawStateCaches();
}

void GLDevice::shutdown() {
    // Timer queries belong to the device; the frame timer only keeps their ids.
    for (u32& query : query_names_) {
        if (query) glDeleteQueries(1, &query);
        query = 0;
    }
    query_names_.clear();
    readbacks_.clear();
    ES_LOG_INFO("GLDevice shutdown");
}

bool GLDevice::pollDeviceLost() {
    if (!isDeviceUsable()) return false;
#ifdef __EMSCRIPTEN__
    // Asked directly rather than waited for: a `webglcontextlost` listener
    // attached after the loss never fires, and a renderer that missed the event
    // would submit into a dead context forever.
    //
    // The handle has to be the CURRENT context, not 0. Zero is not "whichever
    // context is bound" — it is no context, which reports itself lost, and every
    // frame would then be thrown away as a loss that never happened.
    const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();
    if (ctx != 0 && emscripten_is_webgl_context_lost(ctx)) {
        markDeviceLost(GfxDeviceLostReason::ContextLost,
                       "WebGL reports the context is lost", "pollDeviceLost");
        return true;
    }
#endif
    return false;
}

bool GLDevice::isRenderbuffer(u32 textureId) const {
    const TextureDesc* desc = textureDesc(TextureHandle{textureId});
    return desc && desc->samples > 1;
}

// =============================================================================
// Viewport & Clear
// =============================================================================

void GLDevice::setViewport(i32 x, i32 y, u32 w, u32 h) {
    viewport_ = {x, y, w, h};
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
    // Enable/Disable without an index sets every draw buffer: the surface record's own state is gone with it. So while that record's blending is
    // off, asking for what the context holds still has to be made, and only the ask that changes nothing anywhere is skipped.
    if (cap_state_[kCapBlend] == (enabled ? 1 : 0) && !surface_blend_off_) return;
    setCapability(GL_BLEND, enabled);
    cap_state_[kCapBlend] = enabled ? 1 : 0;
    surface_blend_off_ = false;
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
    case BlendMode::None:
        // A pipeline asking for None disables GL_BLEND (PipelineDesc::blendEnabled),
        // so this function is never sampled. Setting the default anyway keeps the
        // cached state honest: current_blend_ is keyed on the mode, and a later
        // pipeline that re-enables blending must not inherit whatever was left here.
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
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
    setCap(kCapDepthTest, GL_DEPTH_TEST, enabled);
}

void GLDevice::setDepthWrite(bool enabled) {
    const i8 want = enabled ? 1 : 0;
    if (depth_mask_ == want) return;
    depth_mask_ = want;
    glDepthMask(enabled ? GL_TRUE : GL_FALSE);
}

// =============================================================================
// Stencil State
// =============================================================================

void GLDevice::setStencilTest(bool enabled) {
    setCap(kCapStencilTest, GL_STENCIL_TEST, enabled);
}

void GLDevice::setStencilFunc(GfxStencilFunc func, i32 ref, u32 mask) {
    glStencilFunc(toGLStencilFunc(func), ref, mask);
}

void GLDevice::setStencilOp(GfxStencilOp sfail, GfxStencilOp dpfail, GfxStencilOp dppass) {
    glStencilOp(toGLStencilOp(sfail), toGLStencilOp(dpfail), toGLStencilOp(dppass));
}

void GLDevice::setStencilMask(u32 mask) {
    if (stencil_mask_ == static_cast<i64>(mask)) return;
    stencil_mask_ = static_cast<i64>(mask);
    glStencilMask(mask);
}

void GLDevice::setColorMask(bool r, bool g, bool b, bool a) {
    const i16 bits = static_cast<i16>((r ? 1 : 0) | (g ? 2 : 0) | (b ? 4 : 0) | (a ? 8 : 0));
    if (color_mask_ == bits) return;
    color_mask_ = bits;
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
    setCap(kCapCull, GL_CULL_FACE, enabled);
}

void GLDevice::setCullFace(bool front) {
    glCullFace(front ? GL_FRONT : GL_BACK);
}

// =============================================================================
// Shader Program
// =============================================================================

bool GLDevice::backendCreateProgram(u32 id, const GfxShaderSource& source,
                                    const GfxAttribBinding* bindings, u32 bindingCount,
                                    std::string* outLog, GfxShaderStage* outFailedStage) {
    if (source.language != GfxShaderLanguage::GLSL_ES300) {
        if (outLog) *outLog = "GLDevice compiles GLSL ES 300 only (got another language)";
        if (outFailedStage) *outFailedStage = GfxShaderStage::Vertex;
        ES_LOG_ERROR("GLDevice::createProgram: unsupported shader language");
        return false;
    }
    const char* vertexSrc = source.vertexSrc;
    const char* fragmentSrc = source.fragmentSrc;
    auto setFailure = [&](GfxShaderStage stage, std::string&& log) {
        if (outLog) *outLog = std::move(log);
        if (outFailedStage) *outFailedStage = stage;
    };

    // Deferred: compile and link are queued with no question asked in between, and the first thing that needs the program asks. A driver that
    // compiles on its own threads (ANGLE does, once the page does not wait) then works on every program asked for in the meantime at once.
    const bool defer = source.deferLink;
    GLuint vertexShader = glCreateShader(GL_VERTEX_SHADER);
    glShaderSource(vertexShader, 1, &vertexSrc, nullptr);
    glCompileShader(vertexShader);

    GLint success = 0;
    if (!defer) glGetShaderiv(vertexShader, GL_COMPILE_STATUS, &success);
    if (!defer && !success) {
        std::string log = readShaderInfoLog(vertexShader);
        ES_LOG_ERROR("Vertex shader compilation failed: {}", log);
        setFailure(GfxShaderStage::Vertex, std::move(log));
        glDeleteShader(vertexShader);
        return false;
    }

    GLuint fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(fragmentShader, 1, &fragmentSrc, nullptr);
    glCompileShader(fragmentShader);

    if (!defer) glGetShaderiv(fragmentShader, GL_COMPILE_STATUS, &success);
    if (!defer && !success) {
        std::string log = readShaderInfoLog(fragmentShader);
        ES_LOG_ERROR("Fragment shader compilation failed: {}", log);
        setFailure(GfxShaderStage::Fragment, std::move(log));
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        return false;
    }

    GLuint program = glCreateProgram();
    glAttachShader(program, vertexShader);
    glAttachShader(program, fragmentShader);

    for (u32 i = 0; i < bindingCount; ++i) {
        glBindAttribLocation(program, bindings[i].index, bindings[i].name);
    }

    glLinkProgram(program);

    if (defer) {
        pending_programs_[id] = PendingProgram{vertexShader, fragmentShader};
        if (outFailedStage) *outFailedStage = GfxShaderStage::None;
        setName(program_names_, id, program);
        return true;
    }

    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        std::string log = readProgramInfoLog(program);
        ES_LOG_ERROR("Shader program linking failed: {}", log);
        setFailure(GfxShaderStage::Link, std::move(log));
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        glDeleteProgram(program);
        return false;
    }

    glDeleteShader(vertexShader);
    glDeleteShader(fragmentShader);

    if (outFailedStage) *outFailedStage = GfxShaderStage::None;
    setName(program_names_, id, program);
    return true;
}

u32 GLDevice::programName(u32 id) {
    if (!pending_programs_.empty() && pending_programs_.count(id)) backendFinishProgram(id);
    return nameOf(program_names_, id);
}

bool GLDevice::backendFinishProgram(u32 id) {
    auto it = pending_programs_.find(id);
    if (it == pending_programs_.end()) return nameOf(program_names_, id) != 0;
    const PendingProgram shaders = it->second;
    pending_programs_.erase(it);
    const GLuint program = nameOf(program_names_, id);
    GLint success = 0;
    glGetProgramiv(program, GL_LINK_STATUS, &success);
    if (!success) {
        // Only now does anyone ask why: the stage that refused, then the link.
        GLint vertexOk = 0, fragmentOk = 0;
        glGetShaderiv(shaders.vertex, GL_COMPILE_STATUS, &vertexOk);
        glGetShaderiv(shaders.fragment, GL_COMPILE_STATUS, &fragmentOk);
        std::string why;
        if (!vertexOk) why += "vertex: " + readShaderInfoLog(shaders.vertex) + " ";
        if (!fragmentOk) why += "fragment: " + readShaderInfoLog(shaders.fragment) + " ";
        why += readProgramInfoLog(program);
        ES_LOG_ERROR("Deferred shader program {} failed to link: {}", id, why);
        glDeleteShader(shaders.vertex);
        glDeleteShader(shaders.fragment);
        glDeleteProgram(program);
        setName(program_names_, id, 0);
        failed_programs_.insert(id);
        return false;
    }
    glDeleteShader(shaders.vertex);
    glDeleteShader(shaders.fragment);
    notifyProgramLinked(id);
    return true;
}

u32 GLDevice::backendPendingProgramCount() {
    if (pending_programs_.empty()) return 0;
    // Finishing erases from the map, so the ids are taken first.
    std::vector<u32> ids;
    ids.reserve(pending_programs_.size());
    for (const auto& entry : pending_programs_) ids.push_back(entry.first);
    u32 compiling = 0;
    for (const u32 id : ids) {
        if (!backendProgramReady(id) && !failed_programs_.count(id)) ++compiling;
    }
    return compiling;
}

bool GLDevice::backendProgramReady(u32 id) {
    if (failed_programs_.count(id)) return false;
    if (!pending_programs_.count(id)) return true;
#ifdef __EMSCRIPTEN__
    if (completion_status_ == 0) {
        const EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_get_current_context();
        completion_status_ = (ctx && emscripten_webgl_enable_extension(ctx, "KHR_parallel_shader_compile")) ? 1 : 2;
    }
    if (completion_status_ == 1) {
        // The browser's answer to "is it done", which does not make the page wait for it.
        constexpr GLenum kCompletionStatus = 0x91B1;
        GLint done = 0;
        glGetProgramiv(nameOf(program_names_, id), kCompletionStatus, &done);
        if (!done) return false;
    }
#endif
    // Done (or no way to tell, in which case the wait is the same one a draw would have made): finishing it now costs nothing.
    return backendFinishProgram(id);
}

void GLDevice::backendDeleteProgram(u32 id) {
    const u32 name = nameOf(program_names_, id);
    if (!name) return;
    if (auto it = pending_programs_.find(id); it != pending_programs_.end()) {
        glDeleteShader(it->second.vertex);
        glDeleteShader(it->second.fragment);
        pending_programs_.erase(it);
    }
    glDeleteProgram(name);
    if (current_program_name_ == name) current_program_name_ = 0;
    setName(program_names_, id, 0);
}

void GLDevice::backendUseProgram(u32 id) {
    const u32 name = programName(id);
    if (name == current_program_name_) return;
    glUseProgram(name);
    current_program_name_ = name;
}

i32 GLDevice::backendUniformLocation(u32 program, const char* name) {
    const u32 glName = programName(program);
    return glName ? glGetUniformLocation(glName, name) : -1;
}

i32 GLDevice::backendAttribLocation(u32 program, const char* name) {
    const u32 glName = programName(program);
    return glName ? glGetAttribLocation(glName, name) : -1;
}

void GLDevice::backendSetUniform(i32 location, const GfxUniformValue& value) {
    if (location < 0) return;
    switch (value.type) {
    case GfxUniformValue::Type::Int:   glUniform1i(location, value.i); break;
    case GfxUniformValue::Type::Float: glUniform1f(location, value.f[0]); break;
    case GfxUniformValue::Type::Vec2:  glUniform2f(location, value.f[0], value.f[1]); break;
    case GfxUniformValue::Type::Vec3:  glUniform3f(location, value.f[0], value.f[1], value.f[2]); break;
    case GfxUniformValue::Type::Vec4:
        glUniform4f(location, value.f[0], value.f[1], value.f[2], value.f[3]);
        break;
    case GfxUniformValue::Type::Mat3:  glUniformMatrix3fv(location, 1, GL_FALSE, value.f); break;
    case GfxUniformValue::Type::Mat4:  glUniformMatrix4fv(location, 1, GL_FALSE, value.f); break;
    case GfxUniformValue::Type::None:  break;
    }
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
    case GL_SAMPLER_2D_ARRAY: return GfxUniformType::Sampler2DArray;
    default:              return GfxUniformType::Unknown;
    }
}

}  // namespace

std::vector<GfxUniformInfo> GLDevice::backendActiveUniforms(u32 program) {
    std::vector<GfxUniformInfo> result;
    const GLuint programId = programName(program);
    if (!programId) return result;

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

u32 GLDevice::backendUniformBlockIndex(u32 program, const char* name) {
    const u32 glName = programName(program);
    if (!glName) return GFX_INVALID_UNIFORM_BLOCK;
    return static_cast<u32>(glGetUniformBlockIndex(glName, name));
}

void GLDevice::backendUniformBlockBinding(u32 program, u32 nativeBlockIndex, u32 bindingPoint) {
    const u32 glName = programName(program);
    if (glName) glUniformBlockBinding(glName, nativeBlockIndex, bindingPoint);
}

// =============================================================================
// Buffer Operations
// =============================================================================

void GLDevice::uploadBufferStore(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes, bool respec) {
    const u32 name = nameOf(buffer_names_, id);
    const BufferDesc* desc = bufferDesc(BufferHandle{id});
    if (!name || !desc) return;

    // GL_ELEMENT_ARRAY_BUFFER binding is VAO state: uploading through it while some
    // VAO is bound would silently rewire that VAO's index buffer. Detach first.
    if (desc->usage == GfxBufferUsage::Index) {
        glBindVertexArray(0);
        bound_vao_ = 0;
    }

    const GLenum target = toGLBufferTarget(desc->usage);
    glBindBuffer(target, name);
    if (respec) {
        glBufferData(target, sizeBytes, data, desc->dynamic ? GL_DYNAMIC_DRAW : GL_STATIC_DRAW);
    } else {
        glBufferSubData(target, offsetBytes, sizeBytes, data);
    }
}

bool GLDevice::backendCreateBuffer(u32 id, const BufferDesc& desc, const void* data) {
    GLuint name = 0;
    glGenBuffers(1, &name);
    if (!name) return false;
    setName(buffer_names_, id, name);
    uploadBufferStore(id, 0, data, desc.size, /*respec=*/true);
    // A slot keeps naming the buffer across a rebuild; the context it was bound in does not.
    for (usize slot = 0; slot < uniform_slots_.size(); ++slot) {
        if (uniform_slots_[slot] == id) bindUniformSlot(static_cast<u32>(slot), name);
    }
    return true;
}

void GLDevice::backendDeleteBuffer(u32 id) {
    GLuint name = nameOf(buffer_names_, id);
    if (!name) return;
    glDeleteBuffers(1, &name);
    setName(buffer_names_, id, 0);
    // The context unbinds a deleted buffer from the slots that held it; the record of those slots must not go on saying it is there.
    for (UniformBound& bound : uniform_bound_) {
        if (bound.known && bound.name == name) bound = {};
    }
}

void GLDevice::backendUpdateBuffer(u32 id, u32 offsetBytes, const void* data, u32 sizeBytes) {
    uploadBufferStore(id, offsetBytes, data, sizeBytes, /*respec=*/false);
}

void GLDevice::backendResizeBuffer(u32 id, const BufferDesc& desc, const void* data) {
    uploadBufferStore(id, 0, data, desc.size, /*respec=*/true);
}

void GLDevice::backendSetUniformBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes, u32 sizeBytes) {
    setName(uniform_slots_, slot, static_cast<u32>(buffer));
    if (slot >= uniform_ranges_.size()) uniform_ranges_.resize(static_cast<usize>(slot) + 1);
    uniform_ranges_[slot] = {offsetBytes, sizeBytes};
    bindUniformSlot(slot, nameOf(buffer_names_, static_cast<u32>(buffer)));
}

void GLDevice::bindUniformSlot(u32 slot, u32 name) {
    const UniformRange range = slot < uniform_ranges_.size() ? uniform_ranges_[slot] : UniformRange{};
    // Most binds of a frame are to what the slot holds already: the same frame constants and the same material block, once per draw.
    if (slot >= uniform_bound_.size()) uniform_bound_.resize(static_cast<usize>(slot) + 1);
    UniformBound& held = uniform_bound_[slot];
    const u32 wantSize = name ? range.size : 0;
    const u32 wantOffset = (name && range.size) ? range.offset : 0;
    if (held.known && held.name == name && held.offset == wantOffset && held.size == wantSize) return;
    held = {name, wantOffset, wantSize, true};
    if (name && range.size) {
        glBindBufferRange(GL_UNIFORM_BUFFER, slot, name, range.offset, range.size);
    } else {
        glBindBufferBase(GL_UNIFORM_BUFFER, slot, name);
    }
}

// =============================================================================
// Vertex Input
// =============================================================================

void GLDevice::backendDeleteVertexLayout(u32 id) {
    auto it = vaos_.find(id);
    if (it == vaos_.end()) return;
    if (it->second.vao != 0) {
        if (bound_vao_ == it->second.vao) {
            glBindVertexArray(0);
            bound_vao_ = 0;
        }
        glDeleteVertexArrays(1, &it->second.vao);
    }
    vaos_.erase(it);
}

void GLDevice::setVertexBuffer(u32 slot, BufferHandle buffer, u32 offsetBytes) {
    if (slot >= MAX_VERTEX_BUFFER_SLOTS) return;
    pending_vbo_[slot] = nameOf(buffer_names_, static_cast<u32>(buffer));
    pending_vbo_offset_[slot] = offsetBytes;
}

void GLDevice::setIndexBuffer(BufferHandle buffer) {
    pending_ibo_ = nameOf(buffer_names_, static_cast<u32>(buffer));
}

void GLDevice::prepareVertexState() {
    const VertexLayoutDesc* desc = vertexLayoutDesc(VertexLayoutHandle{current_layout_});
    if (!desc) return;
    VaoCache& rec = vaos_[current_layout_];

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
        for (u32 a = 0; a < desc->attributeCount; ++a) {
            if (desc->attributes[a].bufferSlot == slot) { slotUsed = true; break; }
        }
        if (!slotUsed) continue;
        if (rec.configured && rec.bakedVbo[slot] == pending_vbo_[slot]
            && rec.bakedOffset[slot] == pending_vbo_offset_[slot]) {
            continue;
        }

        glBindBuffer(GL_ARRAY_BUFFER, pending_vbo_[slot]);
        for (u32 a = 0; a < desc->attributeCount; ++a) {
            const GfxVertexAttribute& attr = desc->attributes[a];
            if (attr.bufferSlot != slot) continue;
            glEnableVertexAttribArray(attr.location);
            const void* at = reinterpret_cast<const void*>(
                static_cast<uintptr_t>(pending_vbo_offset_[slot] + attr.offset));
            // An un-normalized integer attribute reaches the shader AS an
            // integer, through a different entry point: the float one converts,
            // and a converted joint index is not an index.
            if (!attr.normalized && isIntegerAttribute(attr.type)) {
                glVertexAttribIPointer(
                    attr.location, attr.components, toGLDataType(attr.type),
                    static_cast<GLsizei>(desc->strides[slot]), at);
            } else {
                glVertexAttribPointer(
                    attr.location, attr.components, toGLDataType(attr.type),
                    attr.normalized ? GL_TRUE : GL_FALSE,
                    static_cast<GLsizei>(desc->strides[slot]), at);
            }
            glVertexAttribDivisor(attr.location, desc->instanceStep[slot] ? 1 : 0);
        }
        rec.bakedVbo[slot] = pending_vbo_[slot];
        rec.bakedOffset[slot] = pending_vbo_offset_[slot];
    }
    rec.configured = true;
}

// =============================================================================
// Pipeline State
// =============================================================================

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
    case GfxStencilMode::Increment:
    case GfxStencilMode::Decrement:
    case GfxStencilMode::Zero:
        setStencilTest(true);
        setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep,
            mode == GfxStencilMode::Increment ? GfxStencilOp::Incr
                : mode == GfxStencilMode::Decrement ? GfxStencilOp::Decr : GfxStencilOp::Zero);
        setColorMask(false, false, false, false);
        setStencilMask(0xFF);
        break;
    case GfxStencilMode::Test:
    case GfxStencilMode::TestOutside:
        setStencilTest(true);
        setStencilOp(GfxStencilOp::Keep, GfxStencilOp::Keep, GfxStencilOp::Keep);
        setColorMask(true, true, true, true);
        setStencilMask(0x00);
        break;
    }
}

void GLDevice::backendSetPipeline(u32 id, const PipelineDesc& desc) {
    if (id == current_pipeline_id_) return;
    backendUseProgram(static_cast<u32>(desc.program));
    setBlendEnabled(desc.blendEnabled);
    setBlendMode(desc.blend);
    setDepthTest(desc.depthTest);
    setDepthWrite(desc.depthWrite);
    setCulling(desc.cullEnabled);
    if (desc.cullEnabled) setCullFace(desc.cullFront);
    setDepthBias(desc.depthBias);
    applyStencilMode(desc.stencil);
    // After the stencil mode, which states the colour mask for its own sake: a depth-only draw takes it away whatever the stencil said.
    if (!desc.colorWrite) setColorMask(false, false, false, false);
    if (static_cast<i8>(desc.depthEqual) != depth_equal_) {
        glDepthFunc(desc.depthEqual ? GL_LEQUAL : GL_LESS);
        depth_equal_ = static_cast<i8>(desc.depthEqual);
    }
    if (static_cast<i8>(desc.alphaToCoverage) != alpha_to_coverage_) {
        if (desc.alphaToCoverage) glEnable(GL_SAMPLE_ALPHA_TO_COVERAGE);
        else glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);
        alpha_to_coverage_ = static_cast<i8>(desc.alphaToCoverage);
    }

    if (current_fbo_has_gbuffer_) applyDrawBuffers(desc.gbuffer);
    applySurfaceBlend(desc.blendEnabled && desc.gbuffer && current_fbo_has_gbuffer_);

    current_pipeline_id_ = id;
    current_topology_ = desc.topology;
    current_stencil_mode_ = desc.stencil;
    current_layout_ = static_cast<u32>(desc.vertexLayout);
}

/**
 * @brief Push this surface toward the eye by @p bias units of depth resolution.
 *
 * @details Both terms take it: the constant separates coplanar surfaces head-on,
 *          the slope-scaled one keeps them separated at a grazing angle, where a
 *          constant offset spans less depth than one pixel of the surface does.
 */
void GLDevice::setDepthBias(i16 bias) {
    if (bias == current_depth_bias_) return;
    if (bias == 0) {
        glDisable(GL_POLYGON_OFFSET_FILL);
    } else {
        glEnable(GL_POLYGON_OFFSET_FILL);
        glPolygonOffset(static_cast<f32>(bias), static_cast<f32>(bias));
    }
    current_depth_bias_ = bias;
}

void GLDevice::setStencilReference(i32 ref) {
    switch (current_stencil_mode_) {
    case GfxStencilMode::Write:
        setStencilFunc(GfxStencilFunc::Always, ref, 0xFF);
        break;
    case GfxStencilMode::Test:
        setStencilFunc(GfxStencilFunc::Equal, ref, 0xFF);
        break;
    case GfxStencilMode::Increment:
    case GfxStencilMode::Decrement:
    case GfxStencilMode::Zero:
        setStencilFunc(GfxStencilFunc::Equal, ref, 0xFF);
        break;
    case GfxStencilMode::TestOutside:
        setStencilFunc(GfxStencilFunc::NotEqual, ref, 0xFF);
        break;
    case GfxStencilMode::Off:
        break;
    }
}

void GLDevice::backendInvalidatePipelineCache() {
    current_pipeline_id_ = 0;
    current_stencil_mode_ = GfxStencilMode::Off;
    current_program_name_ = 0;
    current_blend_ = static_cast<BlendMode>(0xFF);
}

// =============================================================================
// Draw Calls
// =============================================================================

/** The mode the bound pipeline's topology means. */
u32 GLDevice::primitiveMode() const {
    return current_topology_ == GfxTopology::Lines ? GL_LINES : GL_TRIANGLES;
}

void GLDevice::drawElements(u32 indexCount, GfxDataType indexType, u32 byteOffset) {
    if (!isDeviceUsable()) return;
    prepareVertexState();
    glDrawElements(primitiveMode(), static_cast<GLsizei>(indexCount), toGLDataType(indexType),
                   reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)));
}

void GLDevice::drawArrays(u32 first, u32 vertexCount) {
    if (!isDeviceUsable()) return;
    prepareVertexState();
    glDrawArrays(primitiveMode(), static_cast<GLint>(first), static_cast<GLsizei>(vertexCount));
}

void GLDevice::drawElementsInstanced(u32 indexCount, GfxDataType indexType, u32 byteOffset, u32 instanceCount) {
    if (!isDeviceUsable()) return;
    prepareVertexState();
    glDrawElementsInstanced(primitiveMode(), static_cast<GLsizei>(indexCount), toGLDataType(indexType),
                            reinterpret_cast<const void*>(static_cast<uintptr_t>(byteOffset)),
                            static_cast<GLsizei>(instanceCount));
}

// =============================================================================
// Textures
// =============================================================================

u32 GLDevice::textureTarget(u32 name) const {
    return !array_names_.empty() && array_names_.count(name) ? GL_TEXTURE_2D_ARRAY : GL_TEXTURE_2D;
}

// A unit holds a 2D and an array binding side by side; the sampler type of the program decides which is read.
void GLDevice::bindTexture(u32 slot, TextureHandle texture) {
    const u32 name = nameOf(texture_names_, static_cast<u32>(texture));
    if (slot >= kTextureSlots) {  // beyond the cache — bind directly
        glActiveTexture(GL_TEXTURE0 + slot);
        glBindTexture(textureTarget(name), name);
        return;
    }
    if (bound_texture_[slot] == name) return;  // already bound to this sampler unit
    if (active_texture_unit_ != slot) {
        glActiveTexture(GL_TEXTURE0 + slot);
        active_texture_unit_ = slot;
    }
    glBindTexture(textureTarget(name), name);
    bound_texture_[slot] = name;
}

void GLDevice::bindTextureForEdit(u32 name) {
    glBindTexture(textureTarget(name), name);
    if (active_texture_unit_ < kTextureSlots) bound_texture_[active_texture_unit_] = name;
}

void GLDevice::evictSamplerBinding(u32 name) {
    if (name == 0) return;
    for (u32 slot = 0; slot < kTextureSlots; ++slot) {
        if (bound_texture_[slot] != name) continue;
        if (active_texture_unit_ != slot) {
            glActiveTexture(GL_TEXTURE0 + slot);
            active_texture_unit_ = slot;
        }
        glBindTexture(textureTarget(name), 0);
        bound_texture_[slot] = 0;
    }
}

bool GLDevice::backendCreateTexture(u32 id, const TextureDesc& desc, const void* pixels) {
    // Multisampled: a renderbuffer, never sampled, only drawn into and resolved
    // from. It takes no filter or wrap because nothing reads it through a sampler.
    if (desc.samples > 1) {
        GLuint rb = 0;
        glGenRenderbuffers(1, &rb);
        glBindRenderbuffer(GL_RENDERBUFFER, rb);
        auto glfmt = toGLPixelFormat(desc.format);
        glRenderbufferStorageMultisample(GL_RENDERBUFFER, static_cast<GLsizei>(desc.samples),
                                         glfmt.internalFormat,
                                         static_cast<GLsizei>(desc.width),
                                         static_cast<GLsizei>(desc.height));
        glBindRenderbuffer(GL_RENDERBUFFER, 0);
        if (rb == 0) return false;
        setName(texture_names_, id, rb);
        return true;
    }

    GLuint name = 0;
    glGenTextures(1, &name);
    if (name == 0) return false;
    setName(texture_names_, id, name);

    auto gl = toGLPixelFormat(desc.format);
    if (desc.layers > 1) {
        // WebGL2 refuses UNPACK_FLIP_Y for a 3D upload, so the layers go up in the rows given.
        array_names_.insert(name);
        bindTextureForEdit(name);
        const TightRowScope rows(desc.format, desc.width);
        glTexImage3D(GL_TEXTURE_2D_ARRAY, 0, static_cast<GLint>(gl.internalFormat),
                     static_cast<GLsizei>(desc.width), static_cast<GLsizei>(desc.height),
                     static_cast<GLsizei>(desc.layers), 0, gl.format, gl.type, pixels);
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MIN_FILTER, toGLMinFilter(desc));
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
        glTexParameteri(GL_TEXTURE_2D_ARRAY, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));
        setAnisotropy(desc, desc.mipmaps, GL_TEXTURE_2D_ARRAY);
        if (desc.mipmaps && pixels) glGenerateMipmap(GL_TEXTURE_2D_ARRAY);
        return true;
    }
    bindTextureForEdit(name);
    const TightRowScope rows(desc.format, desc.width);
    if (pixels && desc.flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_TRUE);
    glTexImage2D(GL_TEXTURE_2D, 0, static_cast<GLint>(gl.internalFormat),
                 static_cast<GLsizei>(desc.width), static_cast<GLsizei>(desc.height),
                 0, gl.format, gl.type, pixels);
    if (pixels && desc.flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_FALSE);

    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, toGLMinFilter(desc));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));
    setAnisotropy(desc, desc.mipmaps);

    if (desc.mipmaps && pixels) {
        glGenerateMipmap(GL_TEXTURE_2D);
    }
    return true;
}

bool GLDevice::backendCreateCompressedTexture(u32 id, const TextureDesc& desc, GfxCompressedFormat format,
                                              const void* data, u32 byteLength, u32 mipLevels) {
    GLuint name = 0;
    glGenTextures(1, &name);
    if (name == 0) return false;
    setName(texture_names_, id, name);
    bindTextureForEdit(name);

    // Upload each mip level from the concatenated, block-aligned pyramid.
    const u32 levels = mipLevels ? mipLevels : 1;
    const GfxBlockInfo bi = gfxCompressedBlockInfo(format);
    const GLenum glFmt = toGLCompressedFormat(format);
    const u8* ptr = static_cast<const u8*>(data);
    const u8* end = ptr + byteLength;
    for (u32 level = 0; level < levels; ++level) {
        const u32 lw = (desc.width >> level) ? (desc.width >> level) : 1u;
        const u32 lh = (desc.height >> level) ? (desc.height >> level) : 1u;
        const u32 blocksX = (lw + bi.blockWidth - 1) / bi.blockWidth;
        const u32 blocksY = (lh + bi.blockHeight - 1) / bi.blockHeight;
        const u32 levelBytes = blocksX * blocksY * bi.bytesPerBlock;
        if (levelBytes > static_cast<usize>(end - ptr)) break;   // truncated pyramid
        glCompressedTexImage2D(GL_TEXTURE_2D, static_cast<GLint>(level), glFmt,
                               static_cast<GLsizei>(lw), static_cast<GLsizei>(lh),
                               0, static_cast<GLsizei>(levelBytes), ptr);
        ptr += levelBytes;
    }

    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, static_cast<GLint>(levels - 1));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER,
                    levels > 1 ? GL_LINEAR_MIPMAP_LINEAR : toGLFilter(desc.minFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));
    setAnisotropy(desc, levels > 1);
    return true;
}

bool GLDevice::backendAdoptTexture(u32 id, u32 nativeId, const TextureDesc&) {
    if (nativeId == 0) return false;
    setName(texture_names_, id, nativeId);
    return true;
}

void GLDevice::backendDeleteTexture(u32 id) {
    GLuint name = nameOf(texture_names_, id);
    if (!name) return;
    if (isRenderbuffer(id)) {
        glDeleteRenderbuffers(1, &name);
    } else {
        evictSamplerBinding(name);
        glDeleteTextures(1, &name);
        array_names_.erase(name);
    }
    setName(texture_names_, id, 0);
}

void GLDevice::backendMoveTexture(u32 into, u32 from) {
    setName(texture_names_, into, nameOf(texture_names_, from));
    setName(texture_names_, from, 0);
}

void GLDevice::backendUpdateTexture(u32 id, i32 x, i32 y, u32 width, u32 height,
                                    const void* pixels, bool flipY) {
    const TextureDesc* desc = textureDesc(TextureHandle{id});
    const GfxPixelFormat fmt = desc ? desc->format : GfxPixelFormat::RGBA8;
    auto gl = toGLPixelFormat(fmt);
    bindTextureForEdit(nameOf(texture_names_, id));
    const TightRowScope rows(fmt, width);
    if (flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_TRUE);
    glTexSubImage2D(GL_TEXTURE_2D, 0, x, y,
                    static_cast<GLsizei>(width), static_cast<GLsizei>(height),
                    gl.format, gl.type, pixels);
    if (flipY) glPixelStorei(GL_UNPACK_FLIP_Y_WEBGL, GL_FALSE);
}

void GLDevice::backendSetTextureParams(u32 id, const TextureDesc& desc) {
    const u32 name = nameOf(texture_names_, id);
    const GLenum target = textureTarget(name);
    bindTextureForEdit(name);
    glTexParameteri(target, GL_TEXTURE_MIN_FILTER, toGLMinFilter(desc));
    glTexParameteri(target, GL_TEXTURE_MAG_FILTER, toGLFilter(desc.magFilter));
    glTexParameteri(target, GL_TEXTURE_WRAP_S, toGLWrap(desc.wrapS));
    glTexParameteri(target, GL_TEXTURE_WRAP_T, toGLWrap(desc.wrapT));
    setAnisotropy(desc, desc.mipmaps, target);
}

void GLDevice::backendGenerateMipmaps(u32 id) {
    const u32 name = nameOf(texture_names_, id);
    const GLenum target = textureTarget(name);
    bindTextureForEdit(name);
    glGenerateMipmap(target);
    if (const TextureDesc* desc = textureDesc(TextureHandle{id})) {
        glTexParameteri(target, GL_TEXTURE_MIN_FILTER, toGLMinFilter(*desc));
    }
}

// =============================================================================
// Framebuffer
// =============================================================================

bool GLDevice::backendCreateFramebuffer(u32 id, const FramebufferDesc& desc) {
    GLuint fbo = 0;
    glGenFramebuffers(1, &fbo);
    glBindFramebuffer(GL_FRAMEBUFFER, fbo);

    auto attach = [&](GLenum point, TextureHandle texture) {
        const u32 textureId = static_cast<u32>(texture);
        const u32 name = nameOf(texture_names_, textureId);
        if (isRenderbuffer(textureId)) {
            glFramebufferRenderbuffer(GL_FRAMEBUFFER, point, GL_RENDERBUFFER, name);
        } else {
            glFramebufferTexture2D(GL_FRAMEBUFFER, point, GL_TEXTURE_2D, name, 0);
        }
    };
    auto depthPoint = [&](TextureHandle texture) {
        const TextureDesc* d = textureDesc(texture);
        return d && d->format == GfxPixelFormat::DepthComponent24 ? GL_DEPTH_ATTACHMENT
                                                                  : GL_DEPTH_STENCIL_ATTACHMENT;
    };

    if (desc.color0 != TextureHandle::Invalid) attach(GL_COLOR_ATTACHMENT0, desc.color0);
    if (desc.color1 != TextureHandle::Invalid) attach(GL_COLOR_ATTACHMENT1, desc.color1);
    if (desc.depthStencil != TextureHandle::Invalid) {
        // Attach point follows the texture's pixel format (depth-only vs packed depth+stencil).
        attach(depthPoint(desc.depthStencil), desc.depthStencil);
    }

    const bool complete = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    if (!complete) {
        glDeleteFramebuffers(1, &fbo);
        return false;
    }
    setName(framebuffer_names_, id, fbo);

    // A multisampled target keeps a second, single-sample framebuffer of its own
    // to resolve into. It is the target's, not a pass's: whoever leaves the
    // target gets the resolve for free and never has to ask for it.
    if (desc.resolveColor0 != TextureHandle::Invalid) {
        GLuint dst = 0;
        glGenFramebuffers(1, &dst);
        glBindFramebuffer(GL_FRAMEBUFFER, dst);
        attach(GL_COLOR_ATTACHMENT0, desc.resolveColor0);
        if (desc.resolveColor1 != TextureHandle::Invalid) attach(GL_COLOR_ATTACHMENT1, desc.resolveColor1);
        if (desc.resolveDepthStencil != TextureHandle::Invalid) {
            attach(depthPoint(desc.resolveDepthStencil), desc.resolveDepthStencil);
        }
        const bool ok = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        if (ok) {
            framebuffer_resolve_[id] = {dst, desc.width, desc.height,
                                        desc.resolveDepthStencil != TextureHandle::Invalid,
                                        desc.resolveColor1 != TextureHandle::Invalid};
        } else {
            glDeleteFramebuffers(1, &dst);
            ES_LOG_ERROR("GLDevice: multisample resolve target incomplete");
        }
    }
    return true;
}

/**
 * Blits a multisampled target into the single-sample one it owns. Depth rides
 * along because a post-process effect reads the scene's depth and a
 * multisampled depth attachment cannot be sampled — GL_NEAREST is the only
 * filter a depth blit accepts.
 */
void GLDevice::resolveFramebuffer(u32 framebufferId) {
    auto it = framebuffer_resolve_.find(framebufferId);
    if (it == framebuffer_resolve_.end() || it->second.destFbo == 0) return;
    const auto& r = it->second;
    if (r.width == 0 || r.height == 0) return;
    glBindFramebuffer(GL_READ_FRAMEBUFFER, nameOf(framebuffer_names_, framebufferId));
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, r.destFbo);
    const GLsizei w = static_cast<GLsizei>(r.width), h = static_cast<GLsizei>(r.height);
    if (r.gbuffer) {
        // Each attachment on its own: a blit copies the read buffer into every live draw buffer,
        // and the two are different surfaces.
        const GLenum only0[2] = {GL_COLOR_ATTACHMENT0, GL_NONE};
        const GLenum only1[2] = {GL_NONE, GL_COLOR_ATTACHMENT1};
        glDrawBuffers(2, only0);
        glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_LINEAR);
        glReadBuffer(GL_COLOR_ATTACHMENT1);
        glDrawBuffers(2, only1);
        // Nearest: a normal or a roughness averaged with its neighbour's is neither's.
        glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
        glReadBuffer(GL_COLOR_ATTACHMENT0);
    } else {
        glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_COLOR_BUFFER_BIT, GL_LINEAR);
    }
    if (r.depth) {
        // A separate blit: depth and colour cannot share one when the filter
        // differs, and depth refuses anything but NEAREST.
        glBlitFramebuffer(0, 0, w, h, 0, 0, w, h, GL_DEPTH_BUFFER_BIT, GL_NEAREST);
    }
    if (pass_discard_msaa_) {
        // Resolved, and nothing draws on it again: a tile-based GPU need not write the samples out to memory.
        GLenum attachments[4];
        GLsizei n = 0;
        attachments[n++] = GL_COLOR_ATTACHMENT0;
        if (r.gbuffer) attachments[n++] = GL_COLOR_ATTACHMENT1;
        attachments[n++] = GL_DEPTH_ATTACHMENT;
        attachments[n++] = GL_STENCIL_ATTACHMENT;
        glInvalidateFramebuffer(GL_READ_FRAMEBUFFER, n, attachments);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, nameOf(framebuffer_names_, current_framebuffer_));
}

void GLDevice::discardLeftDepth() {
    if (!pass_discard_depth_ || current_framebuffer_ == 0) return;
    const GLenum depth = GL_DEPTH_ATTACHMENT;
    glBindFramebuffer(GL_FRAMEBUFFER, nameOf(framebuffer_names_, current_framebuffer_));
    glInvalidateFramebuffer(GL_FRAMEBUFFER, 1, &depth);
}

void GLDevice::endFrame() {
    // The default framebuffer's depth and stencil are never read after the frame, which the page shows by its colour: a tile-based GPU that is told so
    // does not write them out. Only with that framebuffer bound, so nothing is rebound under whoever draws next.
    if (current_framebuffer_ != 0) return;
    if (default_depth_bits_ < 0) {
        GLint depth = 0, stencil = 0;
        glBindFramebuffer(GL_FRAMEBUFFER, 0);
        glGetIntegerv(GL_DEPTH_BITS, &depth);
        glGetIntegerv(GL_STENCIL_BITS, &stencil);
        default_depth_bits_ = depth > 0 ? 1 : 0;
        default_stencil_bits_ = stencil > 0 ? 1 : 0;
    }
    GLenum attachments[2];
    GLsizei n = 0;
    if (default_depth_bits_ > 0) attachments[n++] = GL_DEPTH;
    if (default_stencil_bits_ > 0) attachments[n++] = GL_STENCIL;
    if (n == 0) return;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glInvalidateFramebuffer(GL_FRAMEBUFFER, n, attachments);
}

void GLDevice::backendDeleteFramebuffer(u32 id) {
    if (auto it = framebuffer_resolve_.find(id); it != framebuffer_resolve_.end()) {
        if (it->second.destFbo != 0) glDeleteFramebuffers(1, &it->second.destFbo);
        framebuffer_resolve_.erase(it);
    }
    GLuint name = nameOf(framebuffer_names_, id);
    if (name != 0) glDeleteFramebuffers(1, &name);
    setName(framebuffer_names_, id, 0);
}

void GLDevice::clearStencil(i32 value) {
    setClearStencil(value);
    clear(false, false, true);
}

void GLDevice::beginRenderPass(const RenderPassDesc& desc) {
    const u32 target = static_cast<u32>(desc.target);
    // Retargeting LEAVES the previous target, and the model has no explicit pass
    // object to hang the resolve on — so leaving is the event, whether it comes
    // from endRenderPass or from being retargeted out from under.
    if (current_framebuffer_ != target) {
        resolveFramebuffer(current_framebuffer_);
        discardLeftDepth();
    }
    pass_discard_msaa_ = desc.discardMultisampled;
    pass_discard_depth_ = desc.discardDepth;
    current_framebuffer_ = target;
    glBindFramebuffer(GL_FRAMEBUFFER, nameOf(framebuffer_names_, target));

    // A target's own attachment must not stay bound to a sampler while it is drawn
    // into: GL leaves that undefined and some drivers raise a feedback-loop error
    // (a minimap composited last frame and drawn into this one).
    if (const FramebufferDesc* fb = framebufferDesc(desc.target)) {
        evictSamplerBinding(nameOf(texture_names_, static_cast<u32>(fb->color0)));
        evictSamplerBinding(nameOf(texture_names_, static_cast<u32>(fb->depthStencil)));
        if (fb->color1 != TextureHandle::Invalid) {
            evictSamplerBinding(nameOf(texture_names_, static_cast<u32>(fb->color1)));
        }
    }
    // Which draw buffers are live is the framebuffer's own state and a pipeline decides it per draw,
    // so a pass starts by saying it is not yet known — and the pipeline cache forgets, or a pipeline
    // left bound by the last pass would skip the call that says it.
    const FramebufferDesc* passTarget = framebufferDesc(desc.target);
    const bool hasGBuffer = passTarget && passTarget->color1 != TextureHandle::Invalid;
    if (hasGBuffer || current_fbo_has_gbuffer_) {
        current_pipeline_id_ = 0;
        draw_buffers_ = -1;
    }
    current_fbo_has_gbuffer_ = hasGBuffer;

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
    // The first attachment takes the clear colour (the camera's background); the second records what a
    // surface is, and the background is not one, so it clears to zero — "nothing wrote here".
    if (hasGBuffer && desc.clearColor) applyDrawBuffers(false);
    clear(desc.clearColor, desc.clearDepth, desc.clearStencil);
    if (hasGBuffer && desc.clearColor) {
        applyDrawBuffers(true);
        const GLfloat zero[4] = {0.0f, 0.0f, 0.0f, 0.0f};
        glClearBufferfv(GL_COLOR, 1, zero);
    }
    if (scoped) setScissorTest(false);
}

void GLDevice::applySurfaceBlend(bool off) {
    if (off == surface_blend_off_ || indexed_blend_ != 1) return;
#ifdef __EMSCRIPTEN__
    es_gl_surface_blend(off ? 1 : 0);
#endif
    surface_blend_off_ = off;
}

void GLDevice::applyDrawBuffers(bool gbuffer) {
    const i8 want = gbuffer ? 1 : 0;
    if (draw_buffers_ == want) return;
    // The second slot is NONE for a draw that does not write it, so a shader with one output does not
    // leave an undefined value in the surface record.
    const GLenum both[2] = {GL_COLOR_ATTACHMENT0, GL_COLOR_ATTACHMENT1};
    const GLenum first[2] = {GL_COLOR_ATTACHMENT0, GL_NONE};
    glDrawBuffers(2, gbuffer ? both : first);
    draw_buffers_ = want;
}

void GLDevice::endRenderPass() {
    resolveFramebuffer(current_framebuffer_);
    discardLeftDepth();
    pass_discard_msaa_ = false;
    pass_discard_depth_ = false;
    current_framebuffer_ = 0;
    current_fbo_has_gbuffer_ = false;
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

u32 GLDevice::maxSamples() {
    if (max_samples_ != 0) return max_samples_;
    GLint n = 0;
    glGetIntegerv(GL_MAX_SAMPLES, &n);
    max_samples_ = n > 1 ? static_cast<u32>(n) : 1u;
    return max_samples_;
}

// =============================================================================
// Readback (async seam; GL resolves at request time)
// =============================================================================

ReadbackHandle GLDevice::requestReadback(FramebufferHandle target, u32 w, u32 h) {
    if (!isDeviceUsable()) return ReadbackHandle::Invalid;
    if (w == 0 || h == 0) return ReadbackHandle::Invalid;
    std::vector<u8> pixels(static_cast<usize>(w) * h * 4);
    // Called outside a pass (framebuffer 0 bound); bind the source, read, restore.
    glBindFramebuffer(GL_FRAMEBUFFER, nameOf(framebuffer_names_, static_cast<u32>(target)));
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

bool GLDevice::backendCreateTimerQuery(u32 id) {
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
    if (timer_query_state_ != 1) return false;
    GLuint name = 0;
    glGenQueries(1, &name);
    if (name == 0) return false;
    setName(query_names_, id, name);
    return true;
}

void GLDevice::beginTimerQuery(u32 query) {
    glBeginQuery(GL_TIME_ELAPSED_EXT, nameOf(query_names_, query));
}

void GLDevice::endTimerQuery() {
    glEndQuery(GL_TIME_ELAPSED_EXT);
}

bool GLDevice::timerDisjoint() {
    if (timer_disjoint_pending_) {
        timer_disjoint_pending_ = false;
        return true;
    }
    GLint disjoint = 0;
    glGetIntegerv(GL_GPU_DISJOINT_EXT, &disjoint);
    return disjoint != 0;
}

bool GLDevice::getTimerQueryNs(u32 query, u64* outNanoseconds) {
    const u32 name = nameOf(query_names_, query);
    if (!name) return false;
    GLuint available = 0;
    glGetQueryObjectuiv(name, GL_QUERY_RESULT_AVAILABLE, &available);
    if (!available) return false;
    GLuint ns = 0;
    glGetQueryObjectuiv(name, GL_QUERY_RESULT, &ns);
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
    const GLenum err = glGetError();
    // GL_CONTEXT_LOST is not an error to handle but the context announcing it is
    // gone; the two enums for it differ by header origin. Reporting it here lets
    // a build with error checking on notice in the same frame.
    if (err == GL_CONTEXT_LOST || err == GL_CONTEXT_LOST_WEBGL) {
        markDeviceLost(GfxDeviceLostReason::ContextLost,
                       "glGetError returned GL_CONTEXT_LOST", "getError");
    }
    return static_cast<u32>(err);
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
    // Asked by the post-process chain several times a frame, and each ask walked the whole extension list across the wasm boundary (a call into the
    // browser for every extension the context has). What a context supports does not change while it lives; init() runs again for a new one.
    if (float_targets_ < 0) {
        // Rendering INTO RGBA16F needs EXT_color_buffer_float on WebGL2 (sampling
        // half-float textures is core; only attachment renderability is gated).
        float_targets_ = (glExtensionPresent("GL_EXT_color_buffer_float") || glExtensionPresent("EXT_color_buffer_float")) ? 1 : 0;
    }
    return float_targets_ == 1;
}

}  // namespace esengine
