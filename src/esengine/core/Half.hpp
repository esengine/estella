// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Half.hpp
 * @brief   IEEE binary32 → binary16, for the data the GPU takes at half width.
 *
 * @details One author: a mesh's morph deltas and a frame's probe coefficients
 *          both reach the GPU as RGBA16F, and two conversions would be two
 *          roundings to keep agreeing.
 */
#pragma once

#include "./Types.hpp"

#include <cstring>

namespace esengine {

/**
 * @brief IEEE binary32 to binary16.
 * @details The end that matters is the subnormal one — hence the explicit path
 *          rather than a cast. A value too large for half saturates to infinity,
 *          which is what a number that big would look like on screen either way.
 */
inline u16 packHalf(f32 value) {
    u32 bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    const u32 sign = (bits >> 16) & 0x8000u;
    const i32 exponent = static_cast<i32>((bits >> 23) & 0xFFu) - 127 + 15;
    const u32 mantissa = bits & 0x7FFFFFu;
    if (exponent >= 31) return static_cast<u16>(sign | 0x7C00u);
    if (exponent <= 0) {
        if (exponent < -10) return static_cast<u16>(sign);
        const u32 shift = static_cast<u32>(14 - exponent);
        const u32 subnormal = (mantissa | 0x800000u) >> shift;
        return static_cast<u16>(sign | (subnormal + ((mantissa >> (shift - 1)) & 1u)));
    }
    const u32 half = sign | (static_cast<u32>(exponent) << 10) | (mantissa >> 13);
    return static_cast<u16>(half + ((mantissa & 0x1FFFu) > 0x1000u ? 1u : 0u));
}

}  // namespace esengine
