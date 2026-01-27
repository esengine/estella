/**
 * @file    SDFFont.hpp
 * @brief   SDF font rendering with FreeType
 * @details Provides Signed Distance Field font rendering using FreeType's
 *          native SDF rasterizer. Supports dynamic glyph loading with LRU
 *          cache for efficient CJK text rendering.
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

#include <list>
#include <string>
#include <unordered_map>
#include <vector>

namespace esengine::ui {

// =============================================================================
// SDF Glyph Information
// =============================================================================

/**
 * @brief Information about a single SDF glyph in the atlas
 */
struct SDFGlyphInfo {
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
// SDFFont Class
// =============================================================================

/**
 * @brief SDF font for high-quality scalable text rendering
 *
 * @details Uses FreeType's native SDF rasterizer to generate distance field
 *          glyphs on demand. Features:
 *          - Dynamic glyph loading (efficient for CJK)
 *          - LRU cache with atlas space reclamation
 *          - High quality at any scale
 *          - Support for outline and shadow effects
 *
 * @code
 * auto font = SDFFont::create("assets/fonts/NotoSansCJK.ttf", 48.0f);
 * if (font) {
 *     // Glyphs are loaded on demand
 *     renderer.drawTextSDF("Hello 你好", position, *font, fontSize, color);
 * }
 * @endcode
 */
class SDFFont {
public:
    ~SDFFont();

    SDFFont(const SDFFont&) = delete;
    SDFFont& operator=(const SDFFont&) = delete;

    SDFFont(SDFFont&& other) noexcept;
    SDFFont& operator=(SDFFont&& other) noexcept;

    // =========================================================================
    // Factory Methods
    // =========================================================================

    /**
     * @brief Creates an SDF font from a file
     * @param path Path to the TTF/OTF font file
     * @param sdfSize SDF glyph size (recommended: 32-64)
     * @param sdfSpread SDF spread in pixels (default: 8)
     * @return Font instance or nullptr on failure
     */
    static Unique<SDFFont> create(const std::string& path, f32 sdfSize = 48.0f, f32 sdfSpread = 8.0f);

    // =========================================================================
    // Properties
    // =========================================================================

    f32 getSDFSize() const { return sdfSize_; }
    f32 getSDFSpread() const { return sdfSpread_; }
    f32 getAscent() const { return ascent_; }
    f32 getDescent() const { return descent_; }
    f32 getLineHeight() const { return lineHeight_; }
    u32 getAtlasTextureId() const { return atlasTextureId_; }
    glm::ivec2 getAtlasSize() const { return {atlasWidth_, atlasHeight_}; }

    // =========================================================================
    // Glyph Access
    // =========================================================================

    /**
     * @brief Gets glyph information, loading if necessary
     * @param codepoint Unicode codepoint
     * @return Glyph info or nullptr if unavailable
     */
    const SDFGlyphInfo* getGlyph(u32 codepoint);

    /**
     * @brief Preloads ASCII glyphs for common use
     */
    void preloadASCII();

    // =========================================================================
    // Text Measurement
    // =========================================================================

    glm::vec2 measureText(const std::string& text, f32 fontSize);
    f32 getCharWidth(u32 codepoint, f32 fontSize);

    // =========================================================================
    // Cache Management
    // =========================================================================

    /**
     * @brief Gets the number of cached glyphs
     */
    usize getCachedGlyphCount() const { return glyphs_.size(); }

    /**
     * @brief Sets the maximum number of cached glyphs
     * @param maxGlyphs Maximum glyphs (default: 2048)
     */
    void setMaxCachedGlyphs(usize maxGlyphs) { maxCachedGlyphs_ = maxGlyphs; }

    /**
     * @brief Clears all cached glyphs
     */
    void clearCache();

private:
    SDFFont() = default;

    bool loadFromFile(const std::string& path, f32 sdfSize, f32 sdfSpread);
    SDFGlyphInfo* loadGlyph(u32 codepoint);
    void evictLRU();
    void rebuildAtlasTexture();

    bool findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY);
    void markAtlasRegionUsed(i32 x, i32 y, i32 width, i32 height);
    void markAtlasRegionFree(i32 x, i32 y, i32 width, i32 height);

    struct FTData;
    Unique<FTData> ftData_;

    f32 sdfSize_ = 48.0f;
    f32 sdfSpread_ = 8.0f;
    f32 ascent_ = 0.0f;
    f32 descent_ = 0.0f;
    f32 lineHeight_ = 0.0f;

    u32 atlasTextureId_ = 0;
    u32 atlasWidth_ = 1024;
    u32 atlasHeight_ = 1024;
    std::vector<u8> atlasData_;

    std::unordered_map<u32, SDFGlyphInfo> glyphs_;
    std::list<u32> lruList_;
    std::unordered_map<u32, std::list<u32>::iterator> lruMap_;
    usize maxCachedGlyphs_ = 2048;

    i32 packX_ = 1;
    i32 packY_ = 1;
    i32 rowHeight_ = 0;
};

}  // namespace esengine::ui
