/**
 * @file    SystemFont.hpp
 * @brief   System font rendering using OS native APIs
 * @details Uses DirectWrite on Windows, CoreText on macOS, Canvas2D on Web.
 *          No TTF files needed - uses installed system fonts.
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "IFont.hpp"
#include <list>
#include <unordered_map>
#include <vector>

namespace esengine::ui {

class SystemFont : public IFont {
public:
    ~SystemFont() override;

    SystemFont(const SystemFont&) = delete;
    SystemFont& operator=(const SystemFont&) = delete;
    SystemFont(SystemFont&& other) noexcept;
    SystemFont& operator=(SystemFont&& other) noexcept;

    // =========================================================================
    // Factory
    // =========================================================================

    /**
     * @brief Create a system font
     * @param fontFamily Font family name (e.g. "Microsoft YaHei", "Arial", "sans-serif")
     * @param fontSize Base font size in pixels
     * @return Font instance or nullptr on failure
     */
    static Unique<SystemFont> create(const std::string& fontFamily, f32 fontSize = 32.0f);

    // =========================================================================
    // IFont Interface
    // =========================================================================

    FontType getType() const override { return FontType::System; }
    const GlyphInfo* getGlyph(u32 codepoint) override;
    u32 getTextureId() const override { return atlasTextureId_; }
    f32 getFontSize() const override { return fontSize_; }
    f32 getLineHeight() const override { return lineHeight_; }
    f32 getAscent() const override { return ascent_; }
    f32 getDescent() const override { return descent_; }
    glm::vec2 measureText(const std::string& text, f32 fontSize) override;
    f32 getCharWidth(u32 codepoint, f32 fontSize) override;
    glm::ivec2 getAtlasSize() const override { return {atlasWidth_, atlasHeight_}; }

    // =========================================================================
    // System Font Specific
    // =========================================================================

    const std::string& getFontFamily() const { return fontFamily_; }
    void preloadASCII();
    void preloadChars(const std::string& chars);
    usize getCachedGlyphCount() const { return glyphs_.size(); }
    void setMaxCachedGlyphs(usize maxGlyphs) { maxCachedGlyphs_ = maxGlyphs; }
    void clearCache();

private:
    SystemFont() = default;

    bool init(const std::string& fontFamily, f32 fontSize);
    GlyphInfo* renderGlyph(u32 codepoint);
    void evictLRU();
    void rebuildAtlasTexture();
    bool findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY);

    struct PlatformData;
    Unique<PlatformData> platformData_;

    std::string fontFamily_;
    f32 fontSize_ = 32.0f;
    f32 ascent_ = 0.0f;
    f32 descent_ = 0.0f;
    f32 lineHeight_ = 0.0f;

    u32 atlasTextureId_ = 0;
    i32 atlasWidth_ = 1024;
    i32 atlasHeight_ = 1024;
    std::vector<u8> atlasData_;

    std::unordered_map<u32, GlyphInfo> glyphs_;
    std::list<u32> lruList_;
    std::unordered_map<u32, std::list<u32>::iterator> lruMap_;
    usize maxCachedGlyphs_ = 2048;

    i32 packX_ = 1;
    i32 packY_ = 1;
    i32 rowHeight_ = 0;
};

}  // namespace esengine::ui
