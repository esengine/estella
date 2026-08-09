// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    GfxEnums.hpp
 * @brief   Backend-agnostic graphics enumerations
 * @details Replaces raw GL enum constants in the GfxDevice interface so that
 *          upper-layer code has zero dependency on OpenGL headers.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"

#include <string>

namespace esengine {

// =============================================================================
// Resource Handles
// =============================================================================

// Opaque, type-safe GPU resource handles. On the GL backend the value is the GL
// object id (0 is GL's null object, matching Invalid); other backends map the
// value to an internal resource table.

enum class BufferHandle : u32 { Invalid = 0 };
enum class TextureHandle : u32 { Invalid = 0 };
enum class ShaderHandle : u32 { Invalid = 0 };
/** @brief Handle 0 is the default framebuffer (backbuffer); it cannot be created or deleted. */
enum class FramebufferHandle : u32 { Default = 0 };
/** @brief An in-flight framebuffer readback (GfxDevice::requestReadback). */
enum class ReadbackHandle : u32 { Invalid = 0 };

/** @brief State of an in-flight readback. GL completes at request time (first poll
 *         reports Ready); WebGPU resolves when its staging-buffer map lands. */
enum class GfxReadbackStatus : u8 {
    Pending = 0,
    Ready = 1,
    Failed = 2,
};

// =============================================================================
// Texture Sampling
// =============================================================================

enum class TextureFilter : u8 {
    Nearest,  ///< No interpolation (pixelated look)
    Linear,   ///< Bilinear interpolation (smooth)
};

enum class TextureWrap : u8 {
    Repeat,          ///< Tile the texture
    ClampToEdge,     ///< Clamp to edge pixels
    MirroredRepeat,  ///< Tile with mirroring
};

// =============================================================================
// Buffer Usage
// =============================================================================

enum class GfxBufferUsage : u8 {
    Vertex,
    Index,
    Uniform,
};

// =============================================================================
// Vertex Layout Id
// =============================================================================

/**
 * @brief Identifies a transient vertex stream / vertex format. Each layout has its own
 *        VBO+EBO+VAO in TransientBufferPool and is part of a pipeline's identity.
 */
enum class LayoutId : u8 {
    Batch           = 0,
    ParticleInstance = 1,  ///< Instanced: a static unit quad + a per-particle instance stream.
    Shape           = 2,
};

static constexpr u32 LAYOUT_COUNT = 3;

// =============================================================================
// Data Type (vertex attributes, index type, pixel data type)
// =============================================================================

enum class GfxDataType : u8 {
    Float,
    Int,
    UnsignedByte,
    UnsignedShort,
    UnsignedInt,
};

// =============================================================================
// Vertex Layout (part of a pipeline's identity; see PipelineDesc)
// =============================================================================

static constexpr u32 MAX_VERTEX_ATTRIBUTES = 8;
static constexpr u32 MAX_VERTEX_BUFFER_SLOTS = 2;

struct GfxVertexAttribute {
    u32 location = 0;
    u8 components = 4;  ///< 1..4
    GfxDataType type = GfxDataType::Float;
    bool normalized = false;
    u32 offset = 0;  ///< Byte offset within one element of its buffer slot.
    u8 bufferSlot = 0;
};

/**
 * @brief Describes how vertex-buffer bytes map to shader attributes.
 * @details Registered once (createVertexLayout) and referenced by pipelines;
 *          the buffers themselves bind per draw via setVertexBuffer. A slot with
 *          `instanceStep` advances per instance (attribute divisor 1).
 */
struct VertexLayoutDesc {
    GfxVertexAttribute attributes[MAX_VERTEX_ATTRIBUTES] = {};
    u32 attributeCount = 0;
    u32 strides[MAX_VERTEX_BUFFER_SLOTS] = {};
    bool instanceStep[MAX_VERTEX_BUFFER_SLOTS] = {};
};

enum class VertexLayoutHandle : u32 { Invalid = 0 };

// =============================================================================
// Stencil Function
// =============================================================================

enum class GfxStencilFunc : u8 {
    Never,
    Less,
    Equal,
    LEqual,
    Greater,
    NotEqual,
    GEqual,
    Always,
};

// =============================================================================
// Stencil Operation
// =============================================================================

enum class GfxStencilOp : u8 {
    Keep,
    Zero,
    Replace,
    Incr,
    Decr,
    Invert,
    IncrWrap,
    DecrWrap,
};

// =============================================================================
// Pixel Format (texture internal format + transfer format)
// =============================================================================

enum class GfxPixelFormat : u8 {
    RGB8,
    RGBA8,
    /// sRGB-encoded storage: hardware EOTF on sample, OETF on write, and
    /// blending in linear space — the 8-bit backbone of the linear pipeline.
    SRGB8_ALPHA8,
    /// Half-float HDR target; gate render-target use on
    /// GfxDevice::supportsFloatTargets (EXT_color_buffer_float on WebGL2).
    RGBA16F,
    DepthComponent24,
    Depth24Stencil8,
};

/** @brief Bytes one pixel occupies in the CALLER's upload buffer — the single
 *         source both backends size a read of caller-owned pixels with. A
 *         backend's own texel size may differ (RGB8 widens to RGBA8 on WebGPU).
 *         Depth formats are attachment-only and never uploaded. */
inline u32 gfxBytesPerPixel(GfxPixelFormat fmt) {
    switch (fmt) {
    case GfxPixelFormat::RGB8:    return 3;
    case GfxPixelFormat::RGBA16F: return 8;
    default:                      return 4;
    }
}

// =============================================================================
// Compressed Texture Format (GPU-compressed internal formats)
// =============================================================================

/**
 * @brief GPU-compressed texture internal formats for createCompressedTexture.
 *
 * @details Decoded textures stay compressed in VRAM (4–8× smaller than RGBA8),
 *          the key constraint on mobile. Tiering:
 *          - **ETC2/EAC** — core in the WebGL2 / GLES3 spec; available wherever
 *            WebGL2 is, no extension. The safe baseline.
 *          - **ASTC** — `WEBGL_compressed_texture_astc` (iOS A8+, most modern
 *            Android); best quality/size. Query before use.
 *          - **S3TC/DXT** — `WEBGL_compressed_texture_s3tc` (desktop GPUs).
 *
 *          Always gate ASTC/S3TC behind GfxDevice::supportsCompressedFormat and
 *          fall back to the uncompressed RGBA8 path.
 */
enum class GfxCompressedFormat : u8 {
    ETC2_RGB8,         ///< GL_COMPRESSED_RGB8_ETC2 (core)
    ETC2_RGBA8,        ///< GL_COMPRESSED_RGBA8_ETC2_EAC (core)
    ASTC_4x4,          ///< GL_COMPRESSED_RGBA_ASTC_4x4_KHR (extension)
    ASTC_8x8,          ///< GL_COMPRESSED_RGBA_ASTC_8x8_KHR (extension)
    S3TC_DXT1,         ///< GL_COMPRESSED_RGBA_S3TC_DXT1_EXT (extension)
    S3TC_DXT5,         ///< GL_COMPRESSED_RGBA_S3TC_DXT5_EXT (extension)
    ETC2_RGBA8_SRGB,   ///< GL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC (core)
    ASTC_4x4_SRGB,     ///< GL_COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR (extension)
    S3TC_DXT5_SRGB,    ///< GL_COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT (extension)
};

/** @brief Block footprint of a compressed format, the single source both backends
 *         use to size each mip level's upload. BC1/ETC2_RGB are 4x4x8B, the RGBA
 *         block formats 4x4x16B, ASTC's block matches its name. */
struct GfxBlockInfo {
    u32 blockWidth;
    u32 blockHeight;
    u32 bytesPerBlock;
};
inline GfxBlockInfo gfxCompressedBlockInfo(GfxCompressedFormat fmt) {
    switch (fmt) {
    case GfxCompressedFormat::S3TC_DXT1:      return {4, 4, 8};   // BC1
    case GfxCompressedFormat::ETC2_RGB8:      return {4, 4, 8};
    case GfxCompressedFormat::ASTC_8x8:       return {8, 8, 16};
    case GfxCompressedFormat::S3TC_DXT5:
    case GfxCompressedFormat::S3TC_DXT5_SRGB:
    case GfxCompressedFormat::ETC2_RGBA8:
    case GfxCompressedFormat::ETC2_RGBA8_SRGB:
    case GfxCompressedFormat::ASTC_4x4:
    case GfxCompressedFormat::ASTC_4x4_SRGB:
    default:                                  return {4, 4, 16};
    }
}

/** @brief Total bytes of a full mip pyramid (levels 0..mipLevels-1) for a
 *         base-size compressed texture — the block-aligned sum both the transcoder
 *         (packing) and the device (uploading) agree on. */
inline u32 gfxCompressedPyramidBytes(GfxCompressedFormat fmt, u32 width, u32 height, u32 mipLevels) {
    const GfxBlockInfo bi = gfxCompressedBlockInfo(fmt);
    u32 total = 0;
    for (u32 level = 0; level < (mipLevels ? mipLevels : 1); ++level) {
        const u32 lw = (width >> level) ? (width >> level) : 1u;
        const u32 lh = (height >> level) ? (height >> level) : 1u;
        total += ((lw + bi.blockWidth - 1) / bi.blockWidth)
               * ((lh + bi.blockHeight - 1) / bi.blockHeight) * bi.bytesPerBlock;
    }
    return total;
}

// =============================================================================
// Resource Descriptors
// =============================================================================

/**
 * @brief Immutable creation parameters of a GPU buffer.
 * @details `size` is the buffer's capacity; updateBuffer must stay within it.
 *          Growing is an explicit resizeBuffer (contents discarded), keeping the
 *          handle stable so vertex-layout associations survive.
 */
struct BufferDesc {
    GfxBufferUsage usage = GfxBufferUsage::Vertex;
    u32 size = 0;
    bool dynamic = false;
};

/**
 * @brief Immutable creation parameters of a 2D texture.
 * @details `flipY` applies to the initial pixel upload only (WebGL upload state;
 *          native backends flip CPU-side at load time).
 */
struct TextureDesc {
    u32 width = 1;
    u32 height = 1;
    GfxPixelFormat format = GfxPixelFormat::RGBA8;
    TextureFilter minFilter = TextureFilter::Linear;
    TextureFilter magFilter = TextureFilter::Linear;
    TextureWrap wrapS = TextureWrap::ClampToEdge;
    TextureWrap wrapT = TextureWrap::ClampToEdge;
    bool mipmaps = false;
    bool flipY = false;
};

/**
 * @brief Attachments of an offscreen render target. The attach point of
 *        `depthStencil` follows its texture's pixel format.
 */
struct FramebufferDesc {
    TextureHandle color0 = TextureHandle::Invalid;
    TextureHandle depthStencil = TextureHandle::Invalid;
};

/**
 * @brief One render pass: a target, which attachments to clear on entry, and the
 *        clear values — full load-op semantics, no sticky device clear state.
 * @details Clears ignore write masks a prior pipeline left restrictive (the masks
 *          are forced open). An optional clear region scopes the clear to a
 *          viewport rectangle (clearW == 0 = full target): the multi-camera flow
 *          clears each camera's region on the shared default target. A WebGPU
 *          backend maps the full-target case to a real load-op and emulates the
 *          scoped case (first-pass load-op or a scissored clear-quad).
 */
struct RenderPassDesc {
    FramebufferHandle target = FramebufferHandle::Default;
    bool clearColor = false;
    bool clearDepth = false;
    bool clearStencil = false;
    f32 clearColorValue[4] = {0.0f, 0.0f, 0.0f, 1.0f};
    i32 clearStencilValue = 0;
    i32 clearX = 0, clearY = 0;   ///< Clear region origin (pixels).
    u32 clearW = 0, clearH = 0;   ///< Clear region size; 0 = the whole target.
};

// =============================================================================
// Backend Queries (diagnostics / capabilities)
// =============================================================================

/** @brief Backend identification strings. */
enum class GfxStringName : u8 {
    Version,
    Renderer,
    Vendor,
    ShadingLanguageVersion,
};

/** @brief Backend integer capabilities/limits. */
enum class GfxIntParam : u8 {
    MaxTextureSize,
    MaxTextureImageUnits,
    MaxVertexAttribs,
};

// =============================================================================
// Device Loss
// =============================================================================

/**
 * @brief Whether the device can still be drawn to.
 *
 * @details Every backend can lose its device: WebGL fires `webglcontextlost`,
 *          WebGPU resolves its lost future, a native driver resets under us. The
 *          states make "lost" a value the renderer branches on, not a condition
 *          it discovers by drawing into a dead device.
 */
enum class GfxDeviceStatus : u8 {
    Live,        ///< Normal operation.
    Lost,        ///< Every handle issued before is dead; submission has stopped.
    Recovering,  ///< A replacement device is being built; old handles stay dead.
    Dead,        ///< Unrecoverable — the renderer will not draw again this run.
};

/** @brief Why the device was lost. The report leads with this. */
enum class GfxDeviceLostReason : u8 {
    Unknown,
    ContextLost,   ///< The host took the context away (web `webglcontextlost`, surface teardown).
    OutOfMemory,   ///< An allocation the backend could not satisfy.
    Reset,         ///< Driver/GPU reset — a hang watchdog (TDR) or a peer process's fault.
    Removed,       ///< The adapter itself is gone: driver update, eGPU unplugged.
    Destroyed,     ///< We destroyed it. A loss report that is not a failure.
    Validation,    ///< The backend rejected our commands fatally.
    Internal,      ///< The backend failed inside itself and said no more than that.
};

/**
 * @brief Everything a human needs to know about one device loss.
 *
 * @details Assembled once, at the moment of loss, and then immutable — a report
 *          that says only "the context was lost" is what this type exists to
 *          replace.
 */
/**
 * @brief Who a device IS, captured at init() and true whether or not it still lives.
 *
 * @details A lost backend cannot be asked who it was (glGetString returns null
 *          once the context is gone), so this is read while the device works.
 *          Its own type because a device has an identity for its whole life,
 *          while a loss report exists only after one.
 */
struct GfxDeviceIdentity {
    std::string backend;   ///< "WebGL2", "WebGPU".
    std::string vendor;
    std::string renderer;
    std::string version;   ///< Driver / API version string.

    bool known() const { return !backend.empty(); }
};

struct GfxDeviceLostInfo {
    GfxDeviceLostReason reason = GfxDeviceLostReason::Unknown;

    /** Snapshotted from the device at the moment of loss, so the report stays
     *  immutable while the device goes on to be rebuilt with a new identity. */
    GfxDeviceIdentity identity;

    /** Driver-supplied text; empty when the backend offered no detail. */
    std::string message;

    /** What the device was doing when it died, when the site knows (e.g. "createTexture 4096x4096"). */
    std::string context;

    /** The frame the loss was observed on. */
    u64 frame = 0;
};

/**
 * @brief The whole report as one line, for a log or a crash report.
 * @details Single formatter so the C++ log, the JS diagnostics record and a
 *          user-facing error all name the failure identically.
 */
inline std::string gfxFormatDeviceLost(const GfxDeviceLostInfo& info);

/** @brief Human-readable reason, for logs and diagnostics reports. */
inline const char* gfxDeviceLostReasonName(GfxDeviceLostReason reason) {
    switch (reason) {
    case GfxDeviceLostReason::ContextLost: return "context-lost";
    case GfxDeviceLostReason::OutOfMemory: return "out-of-memory";
    case GfxDeviceLostReason::Reset:       return "device-reset";
    case GfxDeviceLostReason::Removed:     return "device-removed";
    case GfxDeviceLostReason::Destroyed:   return "destroyed";
    case GfxDeviceLostReason::Validation:  return "validation";
    case GfxDeviceLostReason::Internal:    return "internal-error";
    case GfxDeviceLostReason::Unknown:     break;
    }
    return "unknown";
}

inline std::string gfxFormatDeviceLost(const GfxDeviceLostInfo& info) {
    std::string out = "GPU device lost: ";
    out += gfxDeviceLostReasonName(info.reason);
    out += " [backend=" + (info.identity.backend.empty() ? std::string("unknown") : info.identity.backend);
    if (!info.identity.vendor.empty())   out += ", vendor=" + info.identity.vendor;
    if (!info.identity.renderer.empty()) out += ", gpu=" + info.identity.renderer;
    if (!info.identity.version.empty())  out += ", driver=" + info.identity.version;
    out += ", frame=" + std::to_string(info.frame) + "]";
    if (!info.context.empty()) out += " during " + info.context;
    if (!info.message.empty()) out += " — " + info.message;
    return out;
}

// =============================================================================
// Shader Program Creation
// =============================================================================

/**
 * @brief Shader source language a backend consumes.
 * @details GLDevice accepts GLSL ES 300; a WebGPU backend accepts WGSL. Queried
 *          via GfxDevice::supportsShaderLanguage, so the RHI itself is
 *          language-neutral and a caller fails fast instead of feeding a backend
 *          text it cannot compile (REARCH_WGSL Phase 1 seam).
 */
enum class GfxShaderLanguage : u8 {
    GLSL_ES300 = 0,
    WGSL       = 1,
};

/** @brief A program's source pair, tagged with the language it is written in. */
struct GfxShaderSource {
    GfxShaderLanguage language = GfxShaderLanguage::GLSL_ES300;
    const char* vertexSrc = nullptr;
    const char* fragmentSrc = nullptr;
};

/**
 * @brief Vertex attribute location binding applied before a program is linked.
 * @note `name` is borrowed for the duration of the createProgram() call only.
 */
struct GfxAttribBinding {
    u32 index = 0;
    const char* name = nullptr;
};

/** @brief Which pipeline stage rejected a program during createProgram(). */
enum class GfxShaderStage : u8 {
    None,
    Vertex,
    Fragment,
    Link,
};

// =============================================================================
// Uniform Reflection
// =============================================================================

enum class GfxUniformType : u8 {
    Unknown,
    Float,
    Vec2,
    Vec3,
    Vec4,
    Int,
    IVec2,
    IVec3,
    IVec4,
    Bool,
    Mat2,
    Mat3,
    Mat4,
    Sampler2D,
    SamplerCube,
};

struct GfxUniformInfo {
    std::string name;
    GfxUniformType type = GfxUniformType::Unknown;
    i32 location = -1;
    u32 arraySize = 1;
};

}  // namespace esengine
