/**
 * @file    IFont.hpp
 * @brief   Abstract font interface
 * @details Unified interface for different font rendering backends:
 *          MSDFFont, BitmapFont, SystemFont
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../../core/Types.hpp"
#include <glm/glm.hpp>
#include <string>

namespace esengine::ui {

// =============================================================================
// Glyph Information
// =============================================================================

struct GlyphInfo {
    f32 width = 0.0f;
    f32 height = 0.0f;
    f32 bearingX = 0.0f;
    f32 bearingY = 0.0f;
    f32 advance = 0.0f;
    f32 u0 = 0.0f;
    f32 v0 = 0.0f;
    f32 u1 = 0.0f;
    f32 v1 = 0.0f;
};

// =============================================================================
// Font Type
// =============================================================================

enum class FontType {
    Bitmap,
    SDF,
    MSDF,
    System
};

// =============================================================================
// IFont Interface
// =============================================================================

class IFont {
public:
    virtual ~IFont() = default;

    virtual FontType getType() const = 0;
    virtual const GlyphInfo* getGlyph(u32 codepoint) = 0;
    virtual u32 getTextureId() const = 0;
    virtual f32 getFontSize() const = 0;
    virtual f32 getLineHeight() const = 0;
    virtual f32 getAscent() const = 0;
    virtual f32 getDescent() const = 0;
    virtual glm::vec2 measureText(const std::string& text, f32 fontSize) = 0;
    virtual f32 getCharWidth(u32 codepoint, f32 fontSize) = 0;
    virtual glm::ivec2 getAtlasSize() const = 0;
};

}  // namespace esengine::ui
