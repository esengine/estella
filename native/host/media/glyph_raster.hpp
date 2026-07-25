// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    glyph_raster.hpp
 * @brief   The device's glyph source: one codepoint → an upload-ready atlas tile.
 * @details On the web the SDK rasterizes glyphs on an offscreen 2D canvas and
 *          converts the coverage to a signed distance field through the engine's
 *          wasm heap. A native host has neither, so both halves happen here —
 *          stb_truetype for the outline, the engine's OWN `text::sdfFromAlpha`
 *          for the field, so the tiles the shared SDF shader samples are encoded
 *          identically on both platforms.
 *
 *          Only picking the font file is per-OS (Android's font matcher, Core
 *          Text on iOS); it sits behind {@link eshost::Platform::loadFont}.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace eshost {

struct Platform;

/** Style bits, matching the SDK's atlas cache key (ui/text/glyph-rasterizer.ts). */
enum : int { GLYPH_BOLD = 1, GLYPH_ITALIC = 2 };

/**
 * A rasterized glyph in the atlas' own terms: an RGBA8 tile (RGB = 255, alpha =
 * coverage or SDF) and metrics in the requested pixel size. `ok` is false when no
 * font could produce the codepoint; a blank-but-ok glyph (whitespace) carries an
 * advance and an empty tile, exactly as the canvas path returns.
 */
struct GlyphBitmap {
    std::vector<uint8_t> rgba;
    int width = 0;
    int height = 0;
    float advance = 0.0f;
    float bearingX = 0.0f;
    float bearingY = 0.0f;
    bool ok = false;
};

/**
 * Rasterize @p codepoint at @p pixelSize (px per em, as CSS font-size means it).
 *
 * @param style    GLYPH_BOLD | GLYPH_ITALIC — passed to the platform's font match.
 * @param sdf      true → a signed distance field (128 = edge, @p padding px per
 *                 half the byte range); false → plain antialiased coverage.
 * @param padding  border around the ink, in px; the SDF spread.
 *
 * Fonts are cached by file path, so a glyph costs one match plus the raster.
 */
GlyphBitmap rasterizeGlyph(Platform& platform, uint32_t codepoint, const std::string& family,
                           int style, float pixelSize, bool sdf, float padding);

}  // namespace eshost
