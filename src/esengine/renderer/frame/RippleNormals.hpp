// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The built-in `default(ripples)` texture: two fields of wind ripples as normals, one in rg and one in ba, that tile.
 */
#pragma once

#include "../../core/Types.hpp"

#include <vector>

namespace esengine {

inline constexpr u32 RIPPLE_NORMALS_SIZE = 256;
/// The longest wave in a field runs this many times across the texture: a reader that wants ripples of length L tiles it every L times this.
inline constexpr u32 RIPPLE_NORMALS_LONGEST = 6;

/// RGBA8, RIPPLE_NORMALS_SIZE square. A texel's rg (and ba) is the xy of a unit normal whose z is up: the slope there is xy / z.
std::vector<u8> buildRippleNormals();

}  // namespace esengine
