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

#include "../core/Types.hpp"

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
    DepthComponent24,
    Depth24Stencil8,
};

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
    ETC2_RGB8,    ///< GL_COMPRESSED_RGB8_ETC2 (core)
    ETC2_RGBA8,   ///< GL_COMPRESSED_RGBA8_ETC2_EAC (core)
    ASTC_4x4,     ///< GL_COMPRESSED_RGBA_ASTC_4x4_KHR (extension)
    ASTC_8x8,     ///< GL_COMPRESSED_RGBA_ASTC_8x8_KHR (extension)
    S3TC_DXT1,    ///< GL_COMPRESSED_RGBA_S3TC_DXT1_EXT (extension)
    S3TC_DXT5,    ///< GL_COMPRESSED_RGBA_S3TC_DXT5_EXT (extension)
};

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
 * @brief One render pass: a target plus which attachments to clear on entry.
 * @details Clears use the device's current clear color / clear stencil values
 *          and ignore write masks a prior pipeline left restrictive (load-op
 *          semantics) — but they do honor the current scissor rectangle, which
 *          the TS-driven multi-camera flow relies on for per-camera clears.
 */
struct RenderPassDesc {
    FramebufferHandle target = FramebufferHandle::Default;
    bool clearColor = false;
    bool clearDepth = false;
    bool clearStencil = false;
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
// Shader Program Creation
// =============================================================================

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
