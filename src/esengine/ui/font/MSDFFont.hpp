/**
 * @file    MSDFFont.hpp
 * @brief   MSDF font rendering with msdfgen
 * @details Provides Multi-channel Signed Distance Field font rendering using
 *          msdfgen library. Produces sharper text than single-channel SDF.
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

#include <list>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::ui {

// =============================================================================
// MSDF Glyph Information
// =============================================================================

struct MSDFGlyphInfo {
    f32 width = 0.0f;
    f32 height = 0.0f;
    f32 bearingX = 0.0f;
    f32 bearingY = 0.0f;
    f32 advance = 0.0f;

    f32 u0 = 0.0f;
    f32 v0 = 0.0f;
    f32 u1 = 0.0f;
    f32 v1 = 0.0f;

    i32 atlasX = 0;
    i32 atlasY = 0;
    i32 atlasWidth = 0;
    i32 atlasHeight = 0;
};

// =============================================================================
// MSDFFont Class
// =============================================================================

class MSDFFont {
public:
    ~MSDFFont();

    MSDFFont(const MSDFFont&) = delete;
    MSDFFont& operator=(const MSDFFont&) = delete;

    MSDFFont(MSDFFont&& other) noexcept;
    MSDFFont& operator=(MSDFFont&& other) noexcept;

    // =========================================================================
    // Factory Methods
    // =========================================================================

    static Unique<MSDFFont> create(const std::string& path, f32 fontSize = 32.0f, f32 pixelRange = 4.0f);

    // =========================================================================
    // Properties
    // =========================================================================

    f32 getFontSize() const { return fontSize_; }
    f32 getPixelRange() const { return pixelRange_; }
    f32 getAscent() const { return ascent_; }
    f32 getDescent() const { return descent_; }
    f32 getLineHeight() const { return lineHeight_; }
    u32 getAtlasTextureId() const { return atlasTextureId_; }
    glm::ivec2 getAtlasSize() const { return {atlasWidth_, atlasHeight_}; }

    // =========================================================================
    // Glyph Access
    // =========================================================================

    const MSDFGlyphInfo* getGlyph(u32 codepoint);
    void preloadASCII();

    // =========================================================================
    // Text Measurement
    // =========================================================================

    glm::vec2 measureText(const std::string& text, f32 fontSize);
    f32 getCharWidth(u32 codepoint, f32 fontSize);

    // =========================================================================
    // Cache Management
    // =========================================================================

    usize getCachedGlyphCount() const { return glyphs_.size(); }
    void setMaxCachedGlyphs(usize maxGlyphs) { maxCachedGlyphs_ = maxGlyphs; }
    void clearCache();

private:
    MSDFFont() = default;

    bool loadFromFile(const std::string& path, f32 fontSize, f32 pixelRange);
    MSDFGlyphInfo* loadGlyph(u32 codepoint);
    void evictLRU();
    void rebuildAtlasTexture();

    bool findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY);

    struct FontData;
    Unique<FontData> fontData_;

    f32 fontSize_ = 32.0f;
    f32 pixelRange_ = 4.0f;
    f32 ascent_ = 0.0f;
    f32 descent_ = 0.0f;
    f32 lineHeight_ = 0.0f;

    u32 atlasTextureId_ = 0;
    u32 atlasWidth_ = 1024;
    u32 atlasHeight_ = 1024;
    std::vector<u8> atlasData_;  // RGB format (3 bytes per pixel)

    std::unordered_map<u32, MSDFGlyphInfo> glyphs_;
    std::list<u32> lruList_;
    std::unordered_map<u32, std::list<u32>::iterator> lruMap_;
    usize maxCachedGlyphs_ = 2048;

    i32 packX_ = 1;
    i32 packY_ = 1;
    i32 rowHeight_ = 0;
};

}  // namespace esengine::ui
