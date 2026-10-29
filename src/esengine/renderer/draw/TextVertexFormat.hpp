// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
#pragma once

#include "../../core/Types.hpp"

namespace esengine {

// JS/native text submission: x, y, u, v, r, g, b, a, sdfBias.
// The boundary validator and the renderer must consume the same stride.
inline constexpr i32 TEXT_VERTEX_FLOATS = 9;

/// How a glyph page's pixels become coverage. The numbers are what crosses the script boundary: 0 and 1 are what the `sdf` flag it replaced was
/// (false, true), so a caller that has never heard of the others means what it always did.
enum class TextGlyphMode : u8 {
    Color = 0,  ///< The page's RGBA, tinted: a rasterized atlas that carries native-AA coverage in alpha, or a font drawn in colour.
    Sdf = 1,    ///< Alpha is a signed distance; coverage is derived from it, and sdfBias grows the glyph (an outline pass).
    Mask = 2,   ///< Alpha alone is coverage and the page's colour is ignored: the silhouette of a glyph whose outline is baked into the page.
    Fill = 3,   ///< Red x alpha is coverage: the glyph proper of that page. Mask underneath and Fill on top is the outlined glyph, ring in any colour.
};

/// The mode a raw script-side value names; anything out of range is Color, the draw that cannot be wrong about a page it does not understand.
inline TextGlyphMode textGlyphModeFromRaw(i32 raw) {
    return raw >= 0 && raw <= static_cast<i32>(TextGlyphMode::Fill) ? static_cast<TextGlyphMode>(raw) : TextGlyphMode::Color;
}

}  // namespace esengine
