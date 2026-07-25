// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glyph_raster.cpp
 * @brief   Implements the native glyph source (see glyph_raster.hpp).
 */
#include "glyph_raster.hpp"

#include "Host.hpp"

#include "esengine/text/SdfGenerator.hpp"

#include <algorithm>
#include <cmath>
#include <memory>
#include <unordered_map>

#define STB_TRUETYPE_IMPLEMENTATION
#include "stb_truetype.h"

namespace eshost {
namespace {

// The SDF is rasterized and distance-transformed at this multiple of the stored
// resolution, then box-downsampled — magnified glyphs stop showing the source
// grid as edge wobble. The SDK's canvas rasterizer supersamples by the same 4.
constexpr int SDF_SUPERSAMPLE = 4;

/** A parsed font file, kept for the life of the host: fonts are few, glyphs many. */
struct Font {
    std::vector<uint8_t> bytes;
    stbtt_fontinfo info{};
    bool ok = false;
};

/** Parsed fonts by file path — the matcher answers a path per glyph, and only a
 *  path we have not seen costs a read + parse. */
std::unordered_map<std::string, std::unique_ptr<Font>> g_fonts;

Font* loadFont(Platform& platform, const std::string& family, uint32_t codepoint, int style) {
    FontFile file = platform.loadFont(family, codepoint, style);
    if (file.path.empty()) return nullptr;

    auto it = g_fonts.find(file.path);
    if (it != g_fonts.end()) return it->second->ok ? it->second.get() : nullptr;

    auto font = std::make_unique<Font>();
    font->bytes = std::move(file.bytes);
    const int offset = stbtt_GetFontOffsetForIndex(font->bytes.data(), file.faceIndex);
    if (offset >= 0 && stbtt_InitFont(&font->info, font->bytes.data(), offset)) {
        font->ok = true;
    }
    Font* raw = font.get();
    g_fonts.emplace(file.path, std::move(font));
    return raw->ok ? raw : nullptr;
}

/** Average an alpha grid down by an integer factor (the SDK's downsampleBytes). */
std::vector<uint8_t> downsample(const std::vector<uint8_t>& src, int width, int height, int factor) {
    if (factor <= 1) return src;
    const int w = width / factor;
    const int h = height / factor;
    std::vector<uint8_t> out((size_t)w * h, 0);
    const int area = factor * factor;
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
            int sum = 0;
            for (int sy = 0; sy < factor; sy++) {
                const uint8_t* row = src.data() + (size_t)(y * factor + sy) * width + (size_t)x * factor;
                for (int sx = 0; sx < factor; sx++) sum += row[sx];
            }
            out[(size_t)y * w + x] = (uint8_t)std::lround((double)sum / area);
        }
    }
    return out;
}

/** Expand single-channel coverage into the atlas' RGBA tile (RGB = 255, A = it). */
std::vector<uint8_t> toAtlasRgba(const std::vector<uint8_t>& coverage, int width, int height) {
    std::vector<uint8_t> out((size_t)width * height * 4);
    for (size_t i = 0, n = (size_t)width * height; i < n; i++) {
        out[i * 4 + 0] = 255;
        out[i * 4 + 1] = 255;
        out[i * 4 + 2] = 255;
        out[i * 4 + 3] = coverage[i];
    }
    return out;
}

}  // namespace

GlyphBitmap rasterizeGlyph(Platform& platform, uint32_t codepoint, const std::string& family,
                           int style, float pixelSize, bool sdf, float padding) {
    GlyphBitmap out;
    if (pixelSize <= 0.0f) return out;

    Font* font = loadFont(platform, family, codepoint, style);
    if (!font) return out;

    const int glyph = stbtt_FindGlyphIndex(&font->info, (int)codepoint);
    if (glyph == 0) return out;   // the matched font does not have it after all

    // px per em, the same unit CSS font-size (and so the SDK's pixelSize) means.
    const int pad = (int)std::lround(padding);
    const int ss = sdf ? SDF_SUPERSAMPLE : 1;
    const float scale = stbtt_ScaleForMappingEmToPixels(&font->info, pixelSize) * (float)ss;

    int advanceRaw = 0, lsbRaw = 0;
    stbtt_GetGlyphHMetrics(&font->info, glyph, &advanceRaw, &lsbRaw);
    out.advance = advanceRaw * scale / (float)ss;
    out.ok = true;

    // Ink box in supersampled px, y DOWN from the baseline (y0 above it, negative).
    int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
    stbtt_GetGlyphBitmapBox(&font->info, glyph, scale, scale, &x0, &y0, &x1, &y1);
    const int inkWss = x1 - x0;
    const int inkHss = y1 - y0;
    if (inkWss <= 0 || inkHss <= 0) return out;   // whitespace: advance only, no cell

    // Stored (post-downsample) tile, padded; the supersampled grid tiles it exactly.
    const int inkW = (inkWss + ss - 1) / ss;
    const int inkH = (inkHss + ss - 1) / ss;
    const int w = inkW + pad * 2;
    const int h = inkH + pad * 2;
    const int wss = w * ss;
    const int hss = h * ss;

    std::vector<uint8_t> alpha((size_t)wss * hss, 0);
    stbtt_MakeGlyphBitmap(&font->info, alpha.data() + (size_t)pad * ss * wss + (size_t)pad * ss,
                          inkWss, inkHss, wss, scale, scale, glyph);

    std::vector<uint8_t> coverage;
    if (sdf) {
        // The engine's own generator, so the field the shared SDF shader samples is
        // encoded exactly as the web's (128 = edge, spread = padding after folding).
        std::vector<uint8_t> field((size_t)wss * hss, 0);
        esengine::text::sdfFromAlpha(alpha.data(), field.data(), (esengine::u32)wss, (esengine::u32)hss,
                                     (esengine::f32)(pad * ss));
        coverage = downsample(field, wss, hss, ss);
    } else {
        coverage = std::move(alpha);
    }

    out.rgba = toAtlasRgba(coverage, w, h);
    out.width = w;
    out.height = h;
    // The tile's top-left in pen space, y UP: the SDK places it at
    // (penX + bearingX, bearingY). The ink starts `pad` in from both.
    out.bearingX = (float)x0 / (float)ss - (float)pad;
    out.bearingY = -(float)y0 / (float)ss + (float)pad;
    return out;
}

}  // namespace eshost
