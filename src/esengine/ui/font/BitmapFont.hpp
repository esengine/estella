/**
 * @file    BitmapFont.hpp
 * @brief   Bitmap font rendering for lightweight deployments
 *
 * @details Pre-rendered bitmap fonts for scenarios where FreeType is not
 *          available or package size is critical (e.g., playable ads).
 *
 * @author  ESEngine Team
 * @date    2026
 */
#pragma once

#include "../../core/Types.hpp"
#include <glm/glm.hpp>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::ui {

/**
 * @brief Glyph information for bitmap fonts
 */
struct BitmapGlyphInfo {
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

/**
 * @brief Lightweight bitmap font for size-constrained deployments
 *
 * @details Uses pre-rendered font atlas and metrics file.
 *          No FreeType dependency, minimal runtime overhead.
 *
 * @code
 * auto font = BitmapFont::load("font_atlas.png", "font_metrics.json");
 * if (font) {
 *     renderer.drawText("Hello", {10, 10}, *font, 32.0f, {1,1,1,1});
 * }
 * @endcode
 */
class BitmapFont {
public:
    BitmapFont() = default;
    ~BitmapFont();

    BitmapFont(const BitmapFont&) = delete;
    BitmapFont& operator=(const BitmapFont&) = delete;
    BitmapFont(BitmapFont&& other) noexcept;
    BitmapFont& operator=(BitmapFont&& other) noexcept;

    /**
     * @brief Load bitmap font from atlas image and metrics file
     * @param atlasPath Path to the font atlas texture (PNG)
     * @param metricsPath Path to the glyph metrics file (JSON)
     * @return Font instance or nullptr on failure
     */
    static Unique<BitmapFont> load(const std::string& atlasPath,
                                    const std::string& metricsPath);

    /**
     * @brief Load bitmap font from embedded data
     * @param atlasData Raw PNG data
     * @param atlasSize Size of PNG data
     * @param metricsJson JSON string with glyph metrics
     * @return Font instance or nullptr on failure
     */
    static Unique<BitmapFont> loadFromMemory(const u8* atlasData, usize atlasSize,
                                              const std::string& metricsJson);

    /**
     * @brief Get glyph information for a codepoint
     * @param codepoint Unicode codepoint
     * @return Pointer to glyph info, or nullptr if not found
     */
    const BitmapGlyphInfo* getGlyph(u32 codepoint) const;

    /** @brief Get the atlas texture ID */
    u32 getTextureId() const { return textureId_; }

    /** @brief Get the base font size (pixels) */
    f32 getFontSize() const { return fontSize_; }

    /** @brief Get line height */
    f32 getLineHeight() const { return lineHeight_; }

    /** @brief Get ascent (baseline to top) */
    f32 getAscent() const { return ascent_; }

    /** @brief Get descent (baseline to bottom) */
    f32 getDescent() const { return descent_; }

    /** @brief Measure text dimensions */
    glm::vec2 measureText(const std::string& text, f32 fontSize) const;

    /** @brief Get character width */
    f32 getCharWidth(u32 codepoint, f32 fontSize) const;

private:
    bool loadAtlasTexture(const std::string& path);
    bool loadAtlasFromMemory(const u8* data, usize size);
    bool parseMetrics(const std::string& json);

    u32 textureId_ = 0;
    u32 atlasWidth_ = 0;
    u32 atlasHeight_ = 0;
    f32 fontSize_ = 0.0f;
    f32 lineHeight_ = 0.0f;
    f32 ascent_ = 0.0f;
    f32 descent_ = 0.0f;
    std::unordered_map<u32, BitmapGlyphInfo> glyphs_;
};

}  // namespace esengine::ui
