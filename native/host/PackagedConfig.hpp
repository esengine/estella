// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PackagedConfig.hpp
 * @brief   Boot settings the native renderer needs before the JS runtime exists.
 * @details The packaged config declares the render owner and shader colour space before the host creates its surface or draws.
 */
#pragma once

#include <cctype>
#include <cstddef>
#include <string_view>

namespace eshost {

/** Read a scalar from the flat config emitted by the packager. */
inline bool packagedConfigHasValue(std::string_view json, std::string_view key, std::string_view value) {
    const auto space = [&](size_t at) {
        while (at < json.size() && std::isspace(static_cast<unsigned char>(json[at]))) ++at;
        return at;
    };
    for (size_t at = json.find(key); at != std::string_view::npos; at = json.find(key, at + key.size())) {
        size_t next = space(at + key.size());
        if (next >= json.size() || json[next] != ':') continue;
        next = space(next + 1);
        if (json.compare(next, value.size(), value) != 0) continue;
        next = space(next + value.size());
        if (next == json.size() || json[next] == ',' || json[next] == '}') return true;
    }
    return false;
}

inline bool packagedConfigIsLinear(std::string_view json) {
    return packagedConfigHasValue(json, "\"colorSpace\"", "\"linear\"");
}

inline bool packagedConfigThreadedRendering(std::string_view json) {
    return packagedConfigHasValue(json, "\"threadedRendering\"", "true");
}

}  // namespace eshost
