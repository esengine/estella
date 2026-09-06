// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    HdrFormat.hpp
 * @brief   What a linear project ASKED its intermediates to be, and what the
 *          device let them be.
 *
 * @details The choice was a function nobody kept the answer to: it read the
 *          colour-space flag and the device's float capability every time it was
 *          asked. So a project set to linear on a backend without renderable
 *          float targets ran the whole chain at 8-bit precision, correctly, and
 *          with nothing anywhere recording that it had.
 */
#pragma once

#include "../../core/Types.hpp"
#include "../rhi/GfxEnums.hpp"

namespace esengine {

/** @brief Why the effective format is not the requested one. */
enum class HdrRefusal : u8 {
    None = 0,
    /// The device cannot render to a float target (WebGL2 without
    /// EXT_color_buffer_float). sRGB-encoded 8-bit keeps the linear pipeline
    /// correct and takes its over-range headroom away.
    FloatTargetsUnsupported,
};

/** @brief The refusal as a word, for a log line and for a reader. */
inline const char* hdrRefusalName(HdrRefusal why) {
    switch (why) {
        case HdrRefusal::FloatTargetsUnsupported: return "float targets unsupported";
        case HdrRefusal::None:                    break;
    }
    return "none";
}

/**
 * @brief A pixel format as a word.
 *
 * @details Named HERE rather than mirrored in TypeScript: the enum crosses as a
 *          bare number, and a second spelling of its ORDER is what
 *          check-enum-twins exists to refuse. A reader that wants to show the
 *          format asks for the word.
 */
inline const char* pixelFormatName(GfxPixelFormat format) {
    switch (format) {
        case GfxPixelFormat::RGB8:             return "RGB8";
        case GfxPixelFormat::RGBA8:            return "RGBA8";
        case GfxPixelFormat::SRGB8_ALPHA8:     return "SRGB8_ALPHA8";
        case GfxPixelFormat::RGBA16F:          return "RGBA16F";
        case GfxPixelFormat::DepthComponent24: return "DepthComponent24";
        case GfxPixelFormat::Depth24Stencil8:  return "Depth24Stencil8";
    }
    return "unknown";
}

/**
 * @brief The format decision one frame committed to.
 *
 * @details `requested == effective` covers both a granted ask and no ask at all;
 *          `linear` is what tells them apart. A gamma project is not a fallback,
 *          and calling it one warns every project that never wanted HDR.
 */
struct HdrFormatDecision {
    GfxPixelFormat requested = GfxPixelFormat::RGBA8;
    GfxPixelFormat effective = GfxPixelFormat::RGBA8;
    HdrRefusal refusal = HdrRefusal::None;
    /// Whether the project asked for a linear pipeline at all this frame.
    bool linear = false;
};

/**
 * @brief What a linear project asks for, and what @p supportsFloatTargets grants.
 *
 * @details Pure, so the three cases hold without a device. Called once where the
 *          frame COMMITS: two targets in one frame disagreeing about their format
 *          is a chain sampling a texture that is not the one it wrote.
 */
inline HdrFormatDecision decideHdrFormat(bool linearOutput, bool supportsFloatTargets) {
    if (!linearOutput) return {GfxPixelFormat::RGBA8, GfxPixelFormat::RGBA8, HdrRefusal::None, false};
    if (supportsFloatTargets) {
        return {GfxPixelFormat::RGBA16F, GfxPixelFormat::RGBA16F, HdrRefusal::None, true};
    }
    return {GfxPixelFormat::RGBA16F, GfxPixelFormat::SRGB8_ALPHA8,
            HdrRefusal::FloatTargetsUnsupported, true};
}

}  // namespace esengine
