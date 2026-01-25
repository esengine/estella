/**
 * @file    Font.hpp
 * @brief   Font loading and text rendering support
 * @details Provides TrueType font loading using stb_truetype, glyph caching,
 *          and text measurement utilities.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

// =============================================================================
// Includes
// =============================================================================

#include "../../core/Types.hpp"

#include <glm/glm.hpp>

#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::ui {

// =============================================================================
// Glyph Information
// =============================================================================

/**
 * @brief Information about a single glyph in the font atlas
 */
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
// Font Class
// =============================================================================

/**
 * @brief Font for text rendering
 *
 * @details Loads TrueType fonts and generates a texture atlas for efficient
 *          text rendering. Supports glyph caching and text measurement.
 *
 * @code
 * auto font = Font::create("assets/fonts/Roboto.ttf", 16.0f);
 * if (font) {
 *     glm::vec2 size = font->measureText("Hello World", 16.0f);
 *     // Use with UIBatchRenderer::drawText()
 * }
 * @endcode
 */
class Font {
public:
    ~Font();

    // Non-copyable
    Font(const Font&) = delete;
    Font& operator=(const Font&) = delete;

    // Move-only
    Font(Font&& other) noexcept;
    Font& operator=(Font&& other) noexcept;

    // =========================================================================
    // Factory Methods
    // =========================================================================

    /**
     * @brief Creates a font from a file
     * @param path Path to the TTF font file
     * @param baseSize Base size in pixels for atlas generation
     * @return Font instance or nullptr on failure
     */
    static Unique<Font> create(const std::string& path, f32 baseSize = 32.0f);

    /**
     * @brief Creates a font from memory
     * @param data Font file data
     * @param dataSize Size of the data in bytes
     * @param baseSize Base size in pixels for atlas generation
     * @return Font instance or nullptr on failure
     */
    static Unique<Font> createFromMemory(const u8* data, usize dataSize, f32 baseSize = 32.0f);

    // =========================================================================
    // Properties
    // =========================================================================

    /**
     * @brief Gets the base size used for atlas generation
     */
    f32 getBaseSize() const { return baseSize_; }

    /**
     * @brief Gets the font ascent (pixels above baseline)
     */
    f32 getAscent() const { return ascent_; }

    /**
     * @brief Gets the font descent (pixels below baseline)
     */
    f32 getDescent() const { return descent_; }

    /**
     * @brief Gets the line height (ascent + descent + line gap)
     */
    f32 getLineHeight() const { return lineHeight_; }

    /**
     * @brief Gets the font atlas texture ID
     */
    u32 getAtlasTextureId() const { return atlasTextureId_; }

    /**
     * @brief Gets the atlas dimensions
     */
    glm::ivec2 getAtlasSize() const { return {atlasWidth_, atlasHeight_}; }

    // =========================================================================
    // Glyph Access
    // =========================================================================

    /**
     * @brief Gets glyph information for a character
     * @param codepoint Unicode codepoint
     * @return Glyph info or nullptr if not available
     */
    const GlyphInfo* getGlyph(u32 codepoint) const;

    /**
     * @brief Preloads glyphs for a range of codepoints
     * @param start Starting codepoint
     * @param end Ending codepoint (exclusive)
     */
    void preloadGlyphs(u32 start, u32 end);

    // =========================================================================
    // Text Measurement
    // =========================================================================

    /**
     * @brief Measures the size of rendered text
     * @param text Text to measure
     * @param fontSize Size to render at
     * @return Width and height in pixels
     */
    glm::vec2 measureText(const std::string& text, f32 fontSize) const;

    /**
     * @brief Gets the width of a single character
     * @param codepoint Unicode codepoint
     * @param fontSize Size to render at
     * @return Advance width in pixels
     */
    f32 getCharWidth(u32 codepoint, f32 fontSize) const;

    /**
     * @brief Gets kerning between two characters
     * @param left Left character codepoint
     * @param right Right character codepoint
     * @param fontSize Size to render at
     * @return Kerning adjustment in pixels
     */
    f32 getKerning(u32 left, u32 right, f32 fontSize) const;

private:
    Font() = default;

    bool loadFromFile(const std::string& path, f32 baseSize);
    bool loadFromMemory(const u8* data, usize dataSize, f32 baseSize);
    void buildAtlas();
    void createAtlasTexture();
    GlyphInfo* loadGlyph(u32 codepoint);

    struct FontData;
    Unique<FontData> fontData_;

    f32 baseSize_ = 32.0f;
    f32 ascent_ = 0.0f;
    f32 descent_ = 0.0f;
    f32 lineHeight_ = 0.0f;

    u32 atlasTextureId_ = 0;
    u32 atlasWidth_ = 0;
    u32 atlasHeight_ = 0;

    std::vector<u8> atlasData_;
    std::unordered_map<u32, GlyphInfo> glyphs_;

    i32 atlasPackX_ = 0;
    i32 atlasPackY_ = 0;
    i32 atlasRowHeight_ = 0;
};

}  // namespace esengine::ui
