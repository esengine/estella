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
};

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
};

// =============================================================================
// Framebuffer Attachment
// =============================================================================

enum class GfxAttachment : u8 {
    Color0,
    Depth,
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
