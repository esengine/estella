// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    text/SdfGenerator.hpp
 * @brief   Signed distance field generation from an 8-bit alpha coverage bitmap.
 *
 * Used by the runtime dynamic glyph atlas: glyphs are rasterized
 * to alpha via Canvas2D on the TS side, then converted to an SDF here so they
 * stay crisp at any scale and support cheap outline/shadow in the shader. Pure
 * (no GL / no emscripten) so it is unit-testable and portable.
 */
#pragma once

#include "../core/Types.hpp"

namespace esengine::text {

/**
 * @brief 8SSEDT signed distance field from an alpha coverage bitmap.
 *
 * @param alpha   width*height coverage bytes; a texel is "inside" the glyph
 *                when its value is >= 128.
 * @param out     width*height output bytes. 128 encodes the edge; values above
 *                128 are inside, below are outside. The mapping is linear with
 *                `spread` pixels spanning half the [0,255] range, matching what
 *                the SDF text shader expects.
 * @param spread  distance in pixels mapped to half the byte range (the SDF
 *                "range"/padding). Larger = softer falloff / more outline room.
 */
void sdfFromAlpha(const u8* alpha, u8* out, u32 width, u32 height, f32 spread);

}  // namespace esengine::text
