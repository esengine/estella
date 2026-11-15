// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../core/Types.hpp"

namespace esengine::text {

inline constexpr u32 kReplacementCodepoint = 0xFFFD;

constexpr u32 nextCodepoint(const char* data, usize length, usize& pos) {
    const u8 b0 = static_cast<u8>(data[pos]);
    ++pos;
    if (b0 < 0x80) return b0;

    usize extra = 0;
    u32 cp = 0;
    u32 min = 0;
    if ((b0 & 0xE0) == 0xC0) { extra = 1; cp = b0 & 0x1Fu; min = 0x80; }
    else if ((b0 & 0xF0) == 0xE0) { extra = 2; cp = b0 & 0x0Fu; min = 0x800; }
    else if ((b0 & 0xF8) == 0xF0) { extra = 3; cp = b0 & 0x07u; min = 0x10000; }
    else return kReplacementCodepoint;

    if (pos + extra > length) return kReplacementCodepoint;
    for (usize k = 0; k < extra; ++k) {
        const u8 b = static_cast<u8>(data[pos + k]);
        if ((b & 0xC0) != 0x80) return kReplacementCodepoint;
        cp = (cp << 6) | (b & 0x3Fu);
    }
    if (cp < min || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return kReplacementCodepoint;
    pos += extra;
    return cp;
}

}  // namespace esengine::text
