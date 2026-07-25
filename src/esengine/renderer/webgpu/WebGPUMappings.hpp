// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebGPUMappings.hpp
 * @brief   Pure RHI-enum → WebGPU translations (REARCH_WGSL Phase 2).
 * @details Every GfxEnums/PipelineState concept the GL backend consumes has its
 *          WebGPU spelling here, as free functions with no device dependency — so
 *          the mapping layer is unit-testable long before a live adapter exists,
 *          and WebGPUDevice stays a thin orchestration shell over these.
 *
 *          Compiled only under ES_ENABLE_WEBGPU (emdawnwebgpu port supplies
 *          <webgpu/webgpu.h>); never part of the GL build.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../GfxEnums.hpp"
#include "../BlendMode.hpp"
#include "../PipelineState.hpp"

#include <webgpu/webgpu.h>

#include <cstdlib>
#include <cstring>

namespace esengine::webgpu {

// =============================================================================
// Blend
// =============================================================================

/** @brief One RHI blend mode as a full WebGPU blend state (color + alpha). */
struct BlendStateWGPU {
    WGPUBlendComponent color;
    WGPUBlendComponent alpha;
};

/** @brief Maps BlendMode to its WebGPU blend components — mirrors GLDevice's
 *         setBlendMode table (Overlay renders as Normal there too; the real
 *         overlay math lives in shaders). */
inline BlendStateWGPU toWGPUBlend(BlendMode mode) {
    auto comp = [](WGPUBlendOperation op, WGPUBlendFactor src, WGPUBlendFactor dst) {
        WGPUBlendComponent c{};
        c.operation = op;
        c.srcFactor = src;
        c.dstFactor = dst;
        return c;
    };
    const auto add = WGPUBlendOperation_Add;
    switch (mode) {
    case BlendMode::Additive:
        return { comp(add, WGPUBlendFactor_SrcAlpha, WGPUBlendFactor_One),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_One) };
    case BlendMode::Multiply:
        return { comp(add, WGPUBlendFactor_Dst, WGPUBlendFactor_OneMinusSrcAlpha),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha) };
    case BlendMode::Screen:
        return { comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrc),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha) };
    case BlendMode::PremultipliedAlpha:
        return { comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha) };
    case BlendMode::PmaAdditive:
        return { comp(add, WGPUBlendFactor_One, WGPUBlendFactor_One),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_One) };
    case BlendMode::Lighten:
        return { comp(WGPUBlendOperation_Max, WGPUBlendFactor_One, WGPUBlendFactor_One),
                 comp(WGPUBlendOperation_Max, WGPUBlendFactor_One, WGPUBlendFactor_One) };
    case BlendMode::Darken:
        return { comp(WGPUBlendOperation_Min, WGPUBlendFactor_One, WGPUBlendFactor_One),
                 comp(WGPUBlendOperation_Min, WGPUBlendFactor_One, WGPUBlendFactor_One) };
    case BlendMode::Normal:
    case BlendMode::Overlay:
    default:
        return { comp(add, WGPUBlendFactor_SrcAlpha, WGPUBlendFactor_OneMinusSrcAlpha),
                 comp(add, WGPUBlendFactor_One, WGPUBlendFactor_OneMinusSrcAlpha) };
    }
}

// =============================================================================
// Vertex layout
// =============================================================================

/** @brief Sentinel for "no WGPU spelling": the header defines no Undefined vertex
 *         format, so the enum's non-value stands in. Callers treat it as a hard error. */
inline constexpr WGPUVertexFormat kInvalidVertexFormat = WGPUVertexFormat_Force32;

/** @brief Maps one RHI attribute (components × type × normalized) to a
 *         WGPUVertexFormat, or kInvalidVertexFormat for combinations the engine
 *         never produces. */
inline WGPUVertexFormat toWGPUVertexFormat(u8 components, GfxDataType type, bool normalized) {
    switch (type) {
    case GfxDataType::Float:
        switch (components) {
        case 1: return WGPUVertexFormat_Float32;
        case 2: return WGPUVertexFormat_Float32x2;
        case 3: return WGPUVertexFormat_Float32x3;
        case 4: return WGPUVertexFormat_Float32x4;
        default: return kInvalidVertexFormat;
        }
    case GfxDataType::UnsignedByte:
        // The engine's u8 attributes are colors (normalized RGBA8) — 4 lanes only.
        if (components == 4) return normalized ? WGPUVertexFormat_Unorm8x4 : WGPUVertexFormat_Uint8x4;
        if (components == 2) return normalized ? WGPUVertexFormat_Unorm8x2 : WGPUVertexFormat_Uint8x2;
        return kInvalidVertexFormat;
    case GfxDataType::UnsignedShort:
        if (components == 2) return normalized ? WGPUVertexFormat_Unorm16x2 : WGPUVertexFormat_Uint16x2;
        if (components == 4) return normalized ? WGPUVertexFormat_Unorm16x4 : WGPUVertexFormat_Uint16x4;
        return kInvalidVertexFormat;
    case GfxDataType::Int:
        switch (components) {
        case 1: return WGPUVertexFormat_Sint32;
        case 2: return WGPUVertexFormat_Sint32x2;
        case 3: return WGPUVertexFormat_Sint32x3;
        case 4: return WGPUVertexFormat_Sint32x4;
        default: return kInvalidVertexFormat;
        }
    case GfxDataType::UnsignedInt:
        switch (components) {
        case 1: return WGPUVertexFormat_Uint32;
        case 2: return WGPUVertexFormat_Uint32x2;
        case 3: return WGPUVertexFormat_Uint32x3;
        case 4: return WGPUVertexFormat_Uint32x4;
        default: return kInvalidVertexFormat;
        }
    default:
        return kInvalidVertexFormat;
    }
}

/** @brief Index type for drawElements' GfxDataType. */
inline WGPUIndexFormat toWGPUIndexFormat(GfxDataType type) {
    switch (type) {
    case GfxDataType::UnsignedShort: return WGPUIndexFormat_Uint16;
    case GfxDataType::UnsignedInt:   return WGPUIndexFormat_Uint32;
    default:                         return WGPUIndexFormat_Undefined;
    }
}

// =============================================================================
// Textures / samplers
// =============================================================================

inline WGPUTextureFormat toWGPUTextureFormat(GfxPixelFormat fmt) {
    switch (fmt) {
    // WebGPU has no 3-channel color format; RGB8 sources upload as RGBA8
    // (the GL backend's swizzle-free equivalent — expansion happens at upload).
    case GfxPixelFormat::RGB8:             return WGPUTextureFormat_RGBA8Unorm;
    case GfxPixelFormat::RGBA8:            return WGPUTextureFormat_RGBA8Unorm;
    case GfxPixelFormat::SRGB8_ALPHA8:     return WGPUTextureFormat_RGBA8UnormSrgb;
    case GfxPixelFormat::RGBA16F:          return WGPUTextureFormat_RGBA16Float;
    case GfxPixelFormat::DepthComponent24: return WGPUTextureFormat_Depth24Plus;
    case GfxPixelFormat::Depth24Stencil8:  return WGPUTextureFormat_Depth24PlusStencil8;
    default:                               return WGPUTextureFormat_RGBA8Unorm;
    }
}

/** Bytes per pixel of an uncompressed upload in @p fmt (RGB8 expands to RGBA8). */
inline u32 wgpuBytesPerPixel(GfxPixelFormat fmt) {
    return fmt == GfxPixelFormat::RGBA16F ? 8u : 4u;
}

inline WGPUTextureFormat toWGPUCompressedFormat(GfxCompressedFormat fmt) {
    switch (fmt) {
    case GfxCompressedFormat::ETC2_RGB8:  return WGPUTextureFormat_ETC2RGB8Unorm;
    case GfxCompressedFormat::ETC2_RGBA8: return WGPUTextureFormat_ETC2RGBA8Unorm;
    case GfxCompressedFormat::ASTC_4x4:   return WGPUTextureFormat_ASTC4x4Unorm;
    case GfxCompressedFormat::ASTC_8x8:   return WGPUTextureFormat_ASTC8x8Unorm;
    case GfxCompressedFormat::S3TC_DXT1:  return WGPUTextureFormat_BC1RGBAUnorm;
    case GfxCompressedFormat::S3TC_DXT5:  return WGPUTextureFormat_BC3RGBAUnorm;
    case GfxCompressedFormat::ETC2_RGBA8_SRGB: return WGPUTextureFormat_ETC2RGBA8UnormSrgb;
    case GfxCompressedFormat::ASTC_4x4_SRGB:   return WGPUTextureFormat_ASTC4x4UnormSrgb;
    case GfxCompressedFormat::S3TC_DXT5_SRGB:  return WGPUTextureFormat_BC3RGBAUnormSrgb;
    default:                              return WGPUTextureFormat_Undefined;
    }
}

/** Block footprint of a compressed format: writeTexture's bytesPerRow/rowsPerImage
 *  count blocks, not pixels. BC/ETC2 are 4x4; ASTC's block matches its name. */
struct CompressedBlockInfo {
    u32 blockWidth;
    u32 blockHeight;
    u32 bytesPerBlock;
};
inline CompressedBlockInfo compressedBlockInfo(GfxCompressedFormat fmt) {
    switch (fmt) {
    case GfxCompressedFormat::S3TC_DXT1:                              return {4, 4, 8};   // BC1
    case GfxCompressedFormat::ETC2_RGB8:                             return {4, 4, 8};
    case GfxCompressedFormat::ASTC_8x8:                             return {8, 8, 16};
    case GfxCompressedFormat::S3TC_DXT5:
    case GfxCompressedFormat::S3TC_DXT5_SRGB:                        return {4, 4, 16};  // BC3
    case GfxCompressedFormat::ETC2_RGBA8:
    case GfxCompressedFormat::ETC2_RGBA8_SRGB:                       return {4, 4, 16};
    case GfxCompressedFormat::ASTC_4x4:
    case GfxCompressedFormat::ASTC_4x4_SRGB:
    default:                                                        return {4, 4, 16};
    }
}

/** The device feature that gates a compressed-format family (BC / ETC2 / ASTC). */
inline WGPUFeatureName compressionFeatureFor(GfxCompressedFormat fmt) {
    switch (fmt) {
    case GfxCompressedFormat::S3TC_DXT1:
    case GfxCompressedFormat::S3TC_DXT5:
    case GfxCompressedFormat::S3TC_DXT5_SRGB:   return WGPUFeatureName_TextureCompressionBC;
    case GfxCompressedFormat::ASTC_4x4:
    case GfxCompressedFormat::ASTC_8x8:
    case GfxCompressedFormat::ASTC_4x4_SRGB:    return WGPUFeatureName_TextureCompressionASTC;
    case GfxCompressedFormat::ETC2_RGB8:
    case GfxCompressedFormat::ETC2_RGBA8:
    case GfxCompressedFormat::ETC2_RGBA8_SRGB:
    default:                                    return WGPUFeatureName_TextureCompressionETC2;
    }
}

inline WGPUFilterMode toWGPUFilter(TextureFilter filter) {
    return filter == TextureFilter::Nearest ? WGPUFilterMode_Nearest : WGPUFilterMode_Linear;
}

inline WGPUAddressMode toWGPUAddressMode(TextureWrap wrap) {
    switch (wrap) {
    case TextureWrap::ClampToEdge:    return WGPUAddressMode_ClampToEdge;
    case TextureWrap::MirroredRepeat: return WGPUAddressMode_MirrorRepeat;
    case TextureWrap::Repeat:
    default:                          return WGPUAddressMode_Repeat;
    }
}

// =============================================================================
// Buffers
// =============================================================================

inline WGPUBufferUsage toWGPUBufferUsage(GfxBufferUsage usage) {
    switch (usage) {
    case GfxBufferUsage::Vertex:  return WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst;
    case GfxBufferUsage::Index:   return WGPUBufferUsage_Index | WGPUBufferUsage_CopyDst;
    case GfxBufferUsage::Uniform: return WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst;
    default:                      return WGPUBufferUsage_CopyDst;
    }
}

// =============================================================================
// Depth / stencil (PipelineDesc → WGPUDepthStencilState pieces)
// =============================================================================

inline WGPUCompareFunction toWGPUCompare(GfxStencilFunc func) {
    switch (func) {
    case GfxStencilFunc::Never:    return WGPUCompareFunction_Never;
    case GfxStencilFunc::Less:     return WGPUCompareFunction_Less;
    case GfxStencilFunc::Equal:    return WGPUCompareFunction_Equal;
    case GfxStencilFunc::LEqual:   return WGPUCompareFunction_LessEqual;
    case GfxStencilFunc::Greater:  return WGPUCompareFunction_Greater;
    case GfxStencilFunc::NotEqual: return WGPUCompareFunction_NotEqual;
    case GfxStencilFunc::GEqual:   return WGPUCompareFunction_GreaterEqual;
    case GfxStencilFunc::Always:
    default:                       return WGPUCompareFunction_Always;
    }
}

inline WGPUStencilOperation toWGPUStencilOp(GfxStencilOp op) {
    switch (op) {
    case GfxStencilOp::Zero:     return WGPUStencilOperation_Zero;
    case GfxStencilOp::Replace:  return WGPUStencilOperation_Replace;
    case GfxStencilOp::Incr:     return WGPUStencilOperation_IncrementClamp;
    case GfxStencilOp::Decr:     return WGPUStencilOperation_DecrementClamp;
    case GfxStencilOp::Invert:   return WGPUStencilOperation_Invert;
    case GfxStencilOp::IncrWrap: return WGPUStencilOperation_IncrementWrap;
    case GfxStencilOp::DecrWrap: return WGPUStencilOperation_DecrementWrap;
    case GfxStencilOp::Keep:
    default:                     return WGPUStencilOperation_Keep;
    }
}

/** @brief The engine's two stencil modes as WebGPU face states (same table as
 *         GLDevice::applyPipeline: Write = Always/Replace + no color write,
 *         Test = Equal/Keep). */
inline WGPUStencilFaceState toWGPUStencilFace(GfxStencilMode mode) {
    WGPUStencilFaceState face{};
    face.depthFailOp = WGPUStencilOperation_Keep;
    switch (mode) {
    case GfxStencilMode::Write:
        face.compare = WGPUCompareFunction_Always;
        face.failOp = WGPUStencilOperation_Replace;
        face.passOp = WGPUStencilOperation_Replace;
        break;
    case GfxStencilMode::Test:
        face.compare = WGPUCompareFunction_Equal;
        face.failOp = WGPUStencilOperation_Keep;
        face.passOp = WGPUStencilOperation_Keep;
        break;
    case GfxStencilMode::Off:
    default:
        face.compare = WGPUCompareFunction_Always;
        face.failOp = WGPUStencilOperation_Keep;
        face.passOp = WGPUStencilOperation_Keep;
        break;
    }
    return face;
}

/** @brief Stencil write mask per mode — the applyStencilMode table: Write fills
 *         all planes, Test reads without writing, Off never touches stencil. */
inline u32 toWGPUStencilWriteMask(GfxStencilMode mode) {
    return mode == GfxStencilMode::Write ? 0xFFu : 0x00u;
}

/**
 * @brief A pipeline's full depth-stencil state against a pass attachment format.
 * @details GL semantics carried over exactly: a disabled depth test neither
 *          compares NOR writes (glDepthMask only applies while GL_DEPTH_TEST is
 *          on); an enabled one compares with GL's default Less func. Stencil
 *          faces/masks come from the same tables applyStencilMode uses.
 */
inline WGPUDepthStencilState toWGPUDepthStencil(const PipelineDesc& desc, WGPUTextureFormat format) {
    WGPUDepthStencilState ds{};
    ds.format = format;
    ds.depthWriteEnabled = (desc.depthTest && desc.depthWrite) ? WGPUOptionalBool_True
                                                               : WGPUOptionalBool_False;
    ds.depthCompare = desc.depthTest ? WGPUCompareFunction_Less : WGPUCompareFunction_Always;
    ds.stencilFront = toWGPUStencilFace(desc.stencil);
    ds.stencilBack = toWGPUStencilFace(desc.stencil);
    ds.stencilReadMask = 0xFFu;
    ds.stencilWriteMask = toWGPUStencilWriteMask(desc.stencil);
    return ds;
}

/** @brief True when a depth-stencil format carries stencil planes (drives whether
 *         a pass may set stencil load/store ops — Depth24Plus alone must not). */
inline bool hasStencilPlanes(WGPUTextureFormat format) {
    return format == WGPUTextureFormat_Depth24PlusStencil8 ||
           format == WGPUTextureFormat_Depth32FloatStencil8 ||
           format == WGPUTextureFormat_Stencil8;
}

// =============================================================================
// Render pass load-ops (RenderPassDesc carries the values since the load-op
// unification; a scoped clear region has NO load-op equivalent — the device
// emulates it with a scissored clear-quad, exactly as documented in GfxEnums).
// =============================================================================

inline WGPULoadOp toWGPULoadOp(bool clearRequested, bool scoped) {
    // A region-scoped clear must LOAD the attachment and clear the region by
    // other means; only a full-target clear maps to a real load-op.
    return (clearRequested && !scoped) ? WGPULoadOp_Clear : WGPULoadOp_Load;
}

inline WGPUColor toWGPUClearColor(const RenderPassDesc& desc) {
    return WGPUColor{ desc.clearColorValue[0], desc.clearColorValue[1],
                      desc.clearColorValue[2], desc.clearColorValue[3] };
}

/** @brief Cull state (PipelineDesc.cullEnabled/cullFront). Front face is CCW,
 *         matching the GL backend's default winding. */
inline WGPUCullMode toWGPUCullMode(bool enabled, bool front) {
    if (!enabled) return WGPUCullMode_None;
    return front ? WGPUCullMode_Front : WGPUCullMode_Back;
}

// =============================================================================
// Group-1 binding convention (texture units → bindings)
// =============================================================================

/**
 * @brief Texture units the group-1 convention spans: engine units 0..7 (the
 *        batch's u_textures[8]) plus material-param units 8..15 (the GL
 *        MATERIAL_TEXTURE_UNIT_BASE range).
 */
inline constexpr u32 kGroup1TextureUnits = 16;

/**
 * @brief Group-1 binding of a texture unit's texture_2d.
 * @details Engine units 0..7 sit at bindings 0..7 with their samplers at 8..15
 *          (GL's combined texture+sampler state de-combined); material units
 *          8..15 extend the group at bindings 16..23 with samplers at 24..31.
 *          The two maps are disjoint and together cover bits 0..31 exactly, so
 *          one u32 mask describes a whole group.
 */
inline constexpr u32 textureBindingForUnit(u32 unit) { return unit < 8 ? unit : unit + 8; }

/** @brief Group-1 binding of a texture unit's sampler (see textureBindingForUnit). */
inline constexpr u32 samplerBindingForUnit(u32 unit) { return unit < 8 ? unit + 8 : unit + 16; }

// =============================================================================
// WGSL binding reflection (source scan)
// =============================================================================

/**
 * @brief Bit mask of the `@group(N) @binding(i)` indices a WGSL source declares.
 * @details Declarations drive the device's EXPLICIT bind-group layouts: every
 *          declared binding gets a layout entry and a bind-group entry (bound
 *          resource or dummy backfill), so declared-but-unused bindings are as
 *          legal as they are in GLSL. A source scan stands in for real
 *          reflection until the Phase 3 emitter carries binding metadata.
 *          Bindings ≥ 32 are ignored (the group-1 convention tops out at 31).
 */
inline u32 scanWGSLBindingMask(const char* source, u32 group) {
    if (!source) return 0;
    u32 mask = 0;
    for (const char* p = source; (p = std::strstr(p, "@group(")) != nullptr;) {
        p += 7;
        char* end = nullptr;
        const unsigned long g = std::strtoul(p, &end, 10);
        if (end == p) continue;
        p = end;
        if (g != group) continue;
        const char* b = std::strstr(p, "@binding(");
        if (!b) break;
        b += 9;
        const unsigned long idx = std::strtoul(b, &end, 10);
        if (end == b) continue;
        p = end;
        if (idx < 32) mask |= (1u << idx);
    }
    return mask;
}

}  // namespace esengine::webgpu
