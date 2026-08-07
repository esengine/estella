// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PixelUpload.hpp
 * @brief   Row arithmetic shared by the backends' texture uploads
 * @details A backend's texel size need not match the layout the caller allocated
 *          (WebGPU has no 3-channel format, so RGB8 sources land in RGBA8
 *          textures). Sizing a read of caller-owned pixels with the DESTINATION
 *          row is an out-of-bounds read, so the conversion lives here, in one
 *          testable place, rather than inline in each backend.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include "../../core/Types.hpp"

#include <cstring>

namespace esengine {

/// Stage @p height rows for a texture upload: reads exactly `width * srcBpp` bytes
/// per row from @p src, writes `width * dstBpp` per row into @p dst, bottom-up when
/// @p reverseRows, widening 3-byte pixels to opaque RGBA when the two sizes differ.
inline void stageTextureRows(u8* dst, const u8* src, u32 width, u32 height,
                             u32 srcBpp, u32 dstBpp, bool reverseRows) {
    const usize srcRow = static_cast<usize>(width) * srcBpp;
    const usize dstRow = static_cast<usize>(width) * dstBpp;
    for (u32 row = 0; row < height; ++row) {
        const u8* from = src + srcRow * (reverseRows ? (height - 1 - row) : row);
        u8* to = dst + dstRow * row;
        if (srcBpp == dstBpp) {
            std::memcpy(to, from, srcRow);
            continue;
        }
        for (u32 px = 0; px < width; ++px) {
            std::memcpy(to + px * dstBpp, from + px * srcBpp, srcBpp);
            to[px * dstBpp + 3] = 0xFF;
        }
    }
}

}  // namespace esengine
