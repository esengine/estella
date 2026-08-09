// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    linux_common.cpp
 * @brief   fontconfig font matching and libcurl fetching. See the header.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#include "platform/linux_common.hpp"

#include <fontconfig/fontconfig.h>
#include <curl/curl.h>

#include <cstdio>
#include <mutex>
#include <thread>
#include <vector>

#include "media/glyph_raster.hpp"   // GLYPH_BOLD / GLYPH_ITALIC

namespace eshost {
namespace {

using esengine::u8;
using esengine::u32;

/** fontconfig's config, initialised once. Its first call reads every font on the
 *  machine, which is tens of milliseconds nobody should pay twice. */
FcConfig* fonts() {
    static FcConfig* config = [] {
        return FcInitLoadConfigAndFonts();
    }();
    return config;
}

std::vector<u8> readWholeFile(const char* path) {
    std::vector<u8> out;
    std::FILE* file = std::fopen(path, "rb");
    if (!file) return out;
    std::fseek(file, 0, SEEK_END);
    const long size = std::ftell(file);
    std::fseek(file, 0, SEEK_SET);
    if (size > 0) {
        out.resize(static_cast<size_t>(size));
        if (std::fread(out.data(), 1, out.size(), file) != out.size()) out.clear();
    }
    std::fclose(file);
    return out;
}

/** The default family, matching the role Segoe UI plays on Windows and Helvetica
 *  on Apple: whatever this machine calls its sans-serif, which fontconfig knows
 *  and no distribution spells the same way. */
constexpr const char* kDefaultFamily = "sans-serif";

}  // namespace

FontFile linuxLoadFont(const std::string& family, u32 codepoint, int style) {
    FontFile out;
    FcConfig* config = fonts();
    if (!config) return out;

    FcPattern* pattern = FcPatternCreate();
    if (!pattern) return out;
    const std::string wanted = family.empty() ? kDefaultFamily : family;
    FcPatternAddString(pattern, FC_FAMILY, reinterpret_cast<const FcChar8*>(wanted.c_str()));
    if (style & GLYPH_BOLD) FcPatternAddInteger(pattern, FC_WEIGHT, FC_WEIGHT_BOLD);
    if (style & GLYPH_ITALIC) FcPatternAddInteger(pattern, FC_SLANT, FC_SLANT_ITALIC);
    // The codepoint as a REQUIRED charset: this is what turns "find me this
    // family" into "find me something that can draw this character", which is the
    // CJK fallback and the whole reason font matching is platform code.
    FcCharSet* charset = nullptr;
    if (codepoint) {
        charset = FcCharSetCreate();
        FcCharSetAddChar(charset, codepoint);
        FcPatternAddCharSet(pattern, FC_CHARSET, charset);
    }

    FcConfigSubstitute(config, pattern, FcMatchPattern);
    FcDefaultSubstitute(pattern);

    FcResult result = FcResultNoMatch;
    FcPattern* matched = FcFontMatch(config, pattern, &result);
    if (matched && result == FcResultMatch) {
        FcChar8* file = nullptr;
        int index = 0;
        if (FcPatternGetString(matched, FC_FILE, 0, &file) == FcResultMatch && file) {
            out.path = reinterpret_cast<const char*>(file);
            out.bytes = readWholeFile(out.path.c_str());
            if (out.bytes.empty()) out.path.clear();
        }
        // A collection (.ttc) holds several faces, so the index travels with the
        // bytes or the rasterizer reads the wrong one.
        if (FcPatternGetInteger(matched, FC_INDEX, 0, &index) == FcResultMatch) out.faceIndex = index;

        // What the matched file does NOT provide of what was asked for. fontconfig
        // answers the closest face it has, so a family with no bold comes back
        // regular — and the rasterizer synthesizes the rest, as a browser does.
        int weight = FC_WEIGHT_REGULAR;
        int slant = FC_SLANT_ROMAN;
        FcPatternGetInteger(matched, FC_WEIGHT, 0, &weight);
        FcPatternGetInteger(matched, FC_SLANT, 0, &slant);
        out.syntheticBold = (style & GLYPH_BOLD) && weight < FC_WEIGHT_DEMIBOLD;
        out.syntheticItalic = (style & GLYPH_ITALIC) && slant == FC_SLANT_ROMAN;
    }

    if (matched) FcPatternDestroy(matched);
    if (charset) FcCharSetDestroy(charset);
    FcPatternDestroy(pattern);
    return out;
}

namespace {

size_t appendBody(char* data, size_t size, size_t count, void* user) {
    auto* out = static_cast<std::vector<u8>*>(user);
    out->insert(out->end(), data, data + size * count);
    return size * count;
}

size_t appendHeader(char* data, size_t size, size_t count, void* user) {
    auto* out = static_cast<std::vector<std::pair<std::string, std::string>>*>(user);
    const std::string line(data, size * count);
    const size_t colon = line.find(':');
    if (colon != std::string::npos) {
        auto trim = [](std::string s) {
            while (!s.empty() && (s.back() == '\r' || s.back() == '\n' || s.back() == ' ')) s.pop_back();
            size_t at = 0;
            while (at < s.size() && s[at] == ' ') ++at;
            return s.substr(at);
        };
        out->emplace_back(trim(line.substr(0, colon)), trim(line.substr(colon + 1)));
    }
    return size * count;
}

}  // namespace

void linuxStartFetch(const FetchRequest& req) {
    // curl_global_init is not thread-safe and must run before the first easy
    // handle; doing it here, once, keeps every caller from having to know that.
    static std::once_flag once;
    std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });

    // A detached thread per request, as the other two platforms do: libcurl's
    // easy API is synchronous, and deliverFetch is thread-safe by contract.
    std::thread([req]() {
        FetchResult result;
        result.id = req.id;
        result.isText = req.wantText;

        CURL* curl = curl_easy_init();
        if (!curl) {
            result.error = "curl_easy_init failed";
            deliverFetch(std::move(result));
            return;
        }

        curl_slist* headers = nullptr;
        for (const auto& [name, value] : req.headers) {
            headers = curl_slist_append(headers, (name + ": " + value).c_str());
        }

        curl_easy_setopt(curl, CURLOPT_URL, req.url.c_str());
        curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
        curl_easy_setopt(curl, CURLOPT_USERAGENT, "Estella");
        if (headers) curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        if (!req.method.empty() && req.method != "GET") {
            curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, req.method.c_str());
        }
        if (!req.body.empty()) {
            curl_easy_setopt(curl, CURLOPT_POSTFIELDS, reinterpret_cast<const char*>(req.body.data()));
            curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(req.body.size()));
        }
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, appendBody);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &result.body);
        curl_easy_setopt(curl, CURLOPT_HEADERFUNCTION, appendHeader);
        curl_easy_setopt(curl, CURLOPT_HEADERDATA, &result.headers);

        const CURLcode code = curl_easy_perform(curl);
        if (code == CURLE_OK) {
            long status = 0;
            curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
            result.status = static_cast<int>(status);
            result.ok = status >= 200 && status < 300;
            result.statusText = result.ok ? "OK" : "";
        } else {
            // curl's own words: "it failed" without a reason is not something a
            // game can act on, and this is a network round trip.
            result.error = curl_easy_strerror(code);
        }

        if (headers) curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        deliverFetch(std::move(result));
    }).detach();
}

}  // namespace eshost
