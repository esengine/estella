// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include <algorithm>
#include <cctype>
#include <string>
#include <string_view>

namespace esengine::gfx {

inline constexpr std::string_view kLoopFloorUniform = "es_loopFloor";

namespace detail {

inline bool identChar(char c) {
    return std::isalnum(static_cast<unsigned char>(c)) != 0 || c == '_';
}

inline std::size_t skipBlank(const std::string& s, std::size_t at) {
    while (at < s.size() && (s[at] == ' ' || s[at] == '\t' || s[at] == '\r' || s[at] == '\n')) ++at;
    return at;
}

inline bool takeWord(const std::string& s, std::size_t& at, std::string_view word) {
    if (s.compare(at, word.size(), word) != 0) return false;
    const std::size_t end = at + word.size();
    if (end < s.size() && identChar(s[end])) return false;
    at = end;
    return true;
}

inline std::size_t takeIdent(const std::string& s, std::size_t at) {
    if (at >= s.size() || !(std::isalpha(static_cast<unsigned char>(s[at])) != 0 || s[at] == '_')) return std::string::npos;
    while (at < s.size() && identChar(s[at])) ++at;
    return at;
}

inline std::size_t floorInsertionPoint(const std::string& s) {
    std::size_t pos = 0, line = 0;
    int depth = 0;
    bool sawVersion = false;
    while (line < s.size()) {
        std::size_t end = s.find('\n', line);
        if (end == std::string::npos) end = s.size();
        const std::size_t first = skipBlank(s, line);
        if (first >= end) {
            line = end + 1;
            continue;
        }
        if (s[first] != '#') break;
        std::size_t word = skipBlank(s, first + 1);
        if (takeWord(s, word, "version")) sawVersion = true;
        else if (takeWord(s, word, "if") || takeWord(s, word, "ifdef") || takeWord(s, word, "ifndef")) ++depth;
        else if (takeWord(s, word, "endif")) --depth;
        if (depth == 0) pos = std::min(end + 1, s.size());
        line = end + 1;
    }
    return sawVersion ? pos : 0;
}

}  // namespace detail

inline std::string floorConstantLoops(const std::string& src) {
    std::string out;
    std::size_t copied = 0, at = 0, loops = 0;
    while ((at = src.find("for", at)) != std::string::npos) {
        const std::size_t start = at;
        at += 3;
        std::size_t p = start;
        if (!detail::takeWord(src, p, "for")) continue;
        p = detail::skipBlank(src, p);
        if (p >= src.size() || src[p] != '(') continue;
        p = detail::skipBlank(src, p + 1);
        for (std::string_view q : {"highp", "mediump", "lowp"}) {
            std::size_t probe = p;
            if (detail::takeWord(src, probe, q)) { p = detail::skipBlank(src, probe); break; }
        }
        if (!detail::takeWord(src, p, "int")) continue;
        p = detail::skipBlank(src, p);
        const std::size_t identEnd = detail::takeIdent(src, p);
        if (identEnd == std::string::npos) continue;
        p = detail::skipBlank(src, identEnd);
        if (p >= src.size() || src[p] != '=') continue;
        p = detail::skipBlank(src, p + 1);
        const std::size_t valueStart = p;
        if (p < src.size() && src[p] == '-') p = detail::skipBlank(src, p + 1);
        while (p < src.size() && std::isdigit(static_cast<unsigned char>(src[p])) != 0) ++p;
        if (p < src.size() && detail::identChar(src[p])) continue;
        const std::size_t valueEnd = p;
        p = detail::skipBlank(src, p);
        if (p >= src.size() || src[p] != ';') continue;
        out.append(src, copied, valueStart - copied);
        out += '(';
        out.append(src, valueStart, valueEnd - valueStart);
        out += " + ";
        out += kLoopFloorUniform;
        out += ')';
        copied = valueEnd;
        at = valueEnd;
        ++loops;
    }
    if (loops == 0) return src;
    out.append(src, copied, std::string::npos);
    const std::size_t insert = detail::floorInsertionPoint(out);
    std::string declaration = "uniform highp int ";
    declaration += kLoopFloorUniform;
    declaration += ";\n";
    out.insert(insert, declaration);
    return out;
}

}  // namespace esengine::gfx
