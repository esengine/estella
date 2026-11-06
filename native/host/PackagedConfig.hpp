// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PackagedConfig.hpp
 * @brief   The one thing a host must know of game.config.json before JS runs.
 *
 * @details Every other field reaches the engine from the SDK (renderOptions.ts). The colour space cannot: shaders compile against it, a
 *          host compiles its first ones to paint the boot frame, and the JS engine comes up after that. The web declares it before its
 *          renderer starts; this is the native road to the same moment. A host has no JSON parser and no other reason to grow one, and
 *          the export writes this key only for a linear project, so a scan for that key and value is all it takes.
 */
#pragma once

#include <cctype>
#include <cstddef>
#include <string_view>

namespace eshost {

/** Whether a game.config.json declares `"colorSpace": "linear"`. Absent, malformed or anything else is gamma, as the SDK reads it. */
inline bool packagedConfigIsLinear(std::string_view json) {
    constexpr std::string_view key = "\"colorSpace\"";
    constexpr std::string_view value = "\"linear\"";
    const auto space = [&](size_t at) {
        while (at < json.size() && std::isspace(static_cast<unsigned char>(json[at]))) ++at;
        return at;
    };
    for (size_t at = json.find(key); at != std::string_view::npos; at = json.find(key, at + key.size())) {
        size_t next = space(at + key.size());
        if (next >= json.size() || json[next] != ':') continue;
        next = space(next + 1);
        if (json.compare(next, value.size(), value) == 0) return true;
    }
    return false;
}

}  // namespace eshost
