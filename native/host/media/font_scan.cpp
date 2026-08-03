// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    font_scan.cpp
 * @brief   Directory font matching by codepoint coverage.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "font_scan.hpp"

// The implementation lives in glyph_raster.cpp; this TU only needs the decls.
#include "stb_truetype.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <unordered_map>
#include <vector>

using namespace esengine;

namespace eshost {
namespace {

bool hasSuffix(const std::string& s, const char* suffix) {
    const size_t n = strlen(suffix);
    if (s.size() < n) return false;
    return std::equal(s.end() - n, s.end(), suffix,
                      [](char a, char b) { return std::tolower(a) == std::tolower(b); });
}

/** Letters and digits only, lowercased — so "Noto Sans CJK" and
 *  "NotoSansCJK-Regular.ttc" can be compared without either being wrong. */
std::string fold(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (const char c : s) {
        if (std::isalnum((unsigned char)c)) out.push_back((char)std::tolower(c));
    }
    return out;
}

std::vector<u8> readFile(const std::string& path) {
    std::vector<u8> bytes;
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return bytes;
    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (size > 0) {
        bytes.resize((size_t)size);
        if (fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) bytes.clear();
    }
    fclose(f);
    return bytes;
}

/** Every font file in @p dir, listed once. Names only — a system font directory
 *  holds well over a hundred megabytes across its CJK files, so nothing is read
 *  until a candidate is actually being considered. */
const std::vector<std::string>& listing(const char* dir) {
    static std::unordered_map<std::string, std::vector<std::string>> cache;
    auto it = cache.find(dir);
    if (it != cache.end()) return it->second;

    std::vector<std::string> names;
    if (DIR* d = opendir(dir)) {
        while (const dirent* e = readdir(d)) {
            const std::string name = e->d_name;
            if (hasSuffix(name, ".ttf") || hasSuffix(name, ".otf") || hasSuffix(name, ".ttc")) {
                names.push_back(name);
            }
        }
        closedir(d);
    }
    // Stable order, so the same device answers the same way every launch.
    std::sort(names.begin(), names.end());
    return cache.emplace(dir, std::move(names)).first->second;
}

/** Generic CSS families have no file of their own; these are what Android has
 *  shipped under those names since well before the floor. */
const char* const* genericStems(const std::string& folded, size_t& count) {
    static const char* kSans[] = {"roboto", "droidsans", "notosans"};
    static const char* kSerif[] = {"notoserif", "droidserif"};
    static const char* kMono[] = {"droidsansmono", "cutivemono", "notomono"};
    if (folded == "serif") { count = 2; return kSerif; }
    if (folded == "monospace" || folded == "mono") { count = 3; return kMono; }
    count = 3;
    return kSans;   // sans-serif, and anything unrecognized
}

int rank(const std::string& name, const std::string& family, bool wantBold, bool wantItalic) {
    const std::string folded = fold(name);
    const std::string wanted = fold(family.empty() ? "sans-serif" : family);

    int score = 0;
    if (!wanted.empty() && folded.find(wanted) != std::string::npos) {
        score += 100;
    } else {
        size_t count = 0;
        const char* const* stems = genericStems(wanted, count);
        for (size_t i = 0; i < count; ++i) {
            if (folded.find(stems[i]) != std::string::npos) { score += 60 - (int)i; break; }
        }
    }
    // Style is read off the filename because the alternative is parsing every
    // candidate's OS/2 table to sort candidates we have not read yet. Android's
    // own files are named for their style; a device whose are not still gets a
    // correct glyph, drawn from a face this scores lower.
    const bool isBold = folded.find("bold") != std::string::npos;
    const bool isItalic = folded.find("italic") != std::string::npos
                       || folded.find("oblique") != std::string::npos;
    if (isBold == wantBold) score += 10;
    if (isItalic == wantItalic) score += 5;
    return score;
}

/** Paths that covered a codepoint before, newest first. CJK resolves to one huge
 *  file, and without this every glyph in a sentence would re-read the candidates
 *  ahead of it before arriving at the same answer. */
std::vector<std::string>& recentFor(const std::string& family, int style) {
    static std::unordered_map<std::string, std::vector<std::string>> mru;
    return mru[family + "\x1f" + std::to_string(style)];
}

void remember(std::vector<std::string>& mru, const std::string& name) {
    mru.erase(std::remove(mru.begin(), mru.end(), name), mru.end());
    mru.insert(mru.begin(), name);
    if (mru.size() > 4) mru.resize(4);
}

/** Does any face in this file draw @p codepoint? Fills the face index if so. */
bool covers(const std::vector<u8>& bytes, u32 codepoint, int& faceIndex) {
    const int faces = stbtt_GetNumberOfFonts(bytes.data());
    for (int i = 0; i < (faces > 0 ? faces : 1); ++i) {
        const int offset = stbtt_GetFontOffsetForIndex(bytes.data(), i);
        if (offset < 0) continue;
        stbtt_fontinfo info{};
        if (!stbtt_InitFont(&info, bytes.data(), offset)) continue;
        if (stbtt_FindGlyphIndex(&info, (int)codepoint) != 0) { faceIndex = i; return true; }
    }
    return false;
}

}  // namespace

FontFile scanFontDir(const char* dir, const std::string& family, u32 codepoint, int style) {
    FontFile out;
    const std::vector<std::string>& names = listing(dir);
    if (names.empty()) return out;

    const bool wantBold = (style & GLYPH_BOLD) != 0;
    const bool wantItalic = (style & GLYPH_ITALIC) != 0;
    const u32 wanted = codepoint ? codepoint : (u32)'A';

    std::vector<std::string>& mru = recentFor(family, style);
    std::vector<std::string> order(mru);
    std::vector<std::string> rest;
    for (const std::string& name : names) {
        if (std::find(mru.begin(), mru.end(), name) == mru.end()) rest.push_back(name);
    }
    std::stable_sort(rest.begin(), rest.end(), [&](const std::string& a, const std::string& b) {
        return rank(a, family, wantBold, wantItalic) > rank(b, family, wantBold, wantItalic);
    });
    order.insert(order.end(), rest.begin(), rest.end());

    for (const std::string& name : order) {
        const std::string path = std::string(dir) + "/" + name;
        std::vector<u8> bytes = readFile(path);
        if (bytes.empty()) continue;
        int faceIndex = 0;
        if (!covers(bytes, wanted, faceIndex)) continue;   // freed on the next pass

        const std::string folded = fold(name);
        out.path = path;
        out.bytes = std::move(bytes);
        out.faceIndex = faceIndex;
        out.syntheticBold = wantBold && folded.find("bold") == std::string::npos;
        out.syntheticItalic = wantItalic && folded.find("italic") == std::string::npos
                                         && folded.find("oblique") == std::string::npos;
        remember(mru, name);
        return out;
    }
    return out;
}

}  // namespace eshost
