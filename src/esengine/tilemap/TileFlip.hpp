// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TileFlip.hpp
 * @brief   Tiled tile-flip → UV transform (single source, dependency-free).
 */
#pragma once

namespace esengine {
namespace tilemap {

/**
 * Apply Tiled's tile-flip flags to a screen corner's normalized coordinate
 * (s,t) in [0,1]², yielding the texture-space (s,t) to sample.
 *
 * Order matters: diagonal (transpose) first, then horizontal, then vertical.
 * That is the order Tiled encodes, so the standard rotation combos render as
 * true rotations:
 *   90°  CW  = flipH | flipD
 *   180°     = flipH | flipV
 *   270°  CW = flipV | flipD
 * With flipD unset this reduces to plain H/V mirroring.
 */
inline void applyTileFlip(float& s, float& t, bool flipH, bool flipV, bool flipD) {
    if (flipD) { float tmp = s; s = t; t = tmp; }
    if (flipH) s = 1.0f - s;
    if (flipV) t = 1.0f - t;
}

}  // namespace tilemap
}  // namespace esengine
