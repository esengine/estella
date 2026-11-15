// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "Types.hpp"

#include <cstring>
#include <string_view>

namespace esengine::hash {

inline constexpr u64 kFnv64Offset = 0xcbf29ce484222325ull;
inline constexpr u64 kFnv64Prime = 0x100000001b3ull;
inline constexpr u32 kFnv32Offset = 0x811c9dc5u;
inline constexpr u32 kFnv32Prime = 0x01000193u;

constexpr u64 fnv1aWord(u64 h, u64 word) {
    return (h ^ word) * kFnv64Prime;
}

inline u64 fnv1aBytes(u64 h, const void* data, usize bytes) {
    const auto* p = static_cast<const u8*>(data);
    for (usize i = 0; i < bytes; ++i) h = (h ^ p[i]) * kFnv64Prime;
    return h;
}

constexpr u32 fnv1a32(std::string_view text) {
    u32 h = kFnv32Offset;
    for (const char c : text) h = (h ^ static_cast<u8>(c)) * kFnv32Prime;
    return h;
}

constexpr u64 combine(u64 h, u64 v) {
    return h ^ (v + 0x9e3779b97f4a7c15ull + (h << 6) + (h >> 2));
}

inline u64 combineWords(u64 h, const void* data, usize bytes) {
    const auto* p = static_cast<const u8*>(data);
    usize at = 0;
    for (; at + 8 <= bytes; at += 8) {
        u64 w;
        std::memcpy(&w, p + at, 8);
        h = combine(h, w);
    }
    if (at < bytes) {
        u64 tail = 0;
        std::memcpy(&tail, p + at, bytes - at);
        h = combine(h, tail);
    }
    return h;
}

}  // namespace esengine::hash
