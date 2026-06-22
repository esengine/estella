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
 *            Licensed under the MIT License.
 */
#pragma once

#include "../core/Types.hpp"

#include <string>

namespace esengine {

// =============================================================================
// Buffer Target
// =============================================================================

enum class GfxBufferTarget : u8 {
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
    MatSprite       = 3,
};

static constexpr u32 LAYOUT_COUNT = 4;

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
 * @brief GPU-compressed texture internal formats for compressedTexImage2D.
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
// Framebuffer Attachment
// =============================================================================

enum class GfxAttachment : u8 {
    Color0,
    Depth,
    DepthStencil,
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
