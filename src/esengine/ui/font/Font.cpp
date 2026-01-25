/**
 * @file    Font.cpp
 * @brief   Font loading implementation using stb_truetype
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Font.hpp"
#include "../../core/Log.hpp"

#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>

#include <algorithm>
#include <cstring>
#include <fstream>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
    #ifndef GL_UNPACK_ALIGNMENT
        #define GL_UNPACK_ALIGNMENT 0x0CF5
    #endif
    #ifndef GL_TEXTURE_SWIZZLE_RGBA
        #define GL_TEXTURE_SWIZZLE_RGBA 0x8E46
    #endif
#endif

namespace esengine::ui {

// =============================================================================
// Font Internal Data
// =============================================================================

struct Font::FontData {
    stbtt_fontinfo fontInfo{};
    std::vector<u8> fontBuffer;
    f32 scale = 0.0f;
};

// =============================================================================
// Constructor / Destructor
// =============================================================================

Font::~Font() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    if (atlasTextureId_ != 0) {
        glDeleteTextures(1, &atlasTextureId_);
        atlasTextureId_ = 0;
    }
#endif
}

Font::Font(Font&& other) noexcept
    : fontData_(std::move(other.fontData_)),
      baseSize_(other.baseSize_),
      ascent_(other.ascent_),
      descent_(other.descent_),
      lineHeight_(other.lineHeight_),
      atlasTextureId_(other.atlasTextureId_),
      atlasWidth_(other.atlasWidth_),
      atlasHeight_(other.atlasHeight_),
      atlasData_(std::move(other.atlasData_)),
      glyphs_(std::move(other.glyphs_)),
      atlasPackX_(other.atlasPackX_),
      atlasPackY_(other.atlasPackY_),
      atlasRowHeight_(other.atlasRowHeight_) {
    other.atlasTextureId_ = 0;
}

Font& Font::operator=(Font&& other) noexcept {
    if (this != &other) {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        if (atlasTextureId_ != 0) {
            glDeleteTextures(1, &atlasTextureId_);
        }
#endif
        fontData_ = std::move(other.fontData_);
        baseSize_ = other.baseSize_;
        ascent_ = other.ascent_;
        descent_ = other.descent_;
        lineHeight_ = other.lineHeight_;
        atlasTextureId_ = other.atlasTextureId_;
        atlasWidth_ = other.atlasWidth_;
        atlasHeight_ = other.atlasHeight_;
        atlasData_ = std::move(other.atlasData_);
        glyphs_ = std::move(other.glyphs_);
        atlasPackX_ = other.atlasPackX_;
        atlasPackY_ = other.atlasPackY_;
        atlasRowHeight_ = other.atlasRowHeight_;
        other.atlasTextureId_ = 0;
    }
    return *this;
}

// =============================================================================
// Factory Methods
// =============================================================================

Unique<Font> Font::create(const std::string& path, f32 baseSize) {
    auto font = Unique<Font>(new Font());
    if (!font->loadFromFile(path, baseSize)) {
        return nullptr;
    }
    return font;
}

Unique<Font> Font::createFromMemory(const u8* data, usize dataSize, f32 baseSize) {
    auto font = Unique<Font>(new Font());
    if (!font->loadFromMemory(data, dataSize, baseSize)) {
        return nullptr;
    }
    return font;
}

// =============================================================================
// Loading
// =============================================================================

bool Font::loadFromFile(const std::string& path, f32 baseSize) {
    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        ES_LOG_ERROR("Failed to open font file: {}", path);
        return false;
    }

    auto fileSize = file.tellg();
    file.seekg(0, std::ios::beg);

    std::vector<u8> buffer(static_cast<usize>(fileSize));
    if (!file.read(reinterpret_cast<char*>(buffer.data()), fileSize)) {
        ES_LOG_ERROR("Failed to read font file: {}", path);
        return false;
    }

    return loadFromMemory(buffer.data(), buffer.size(), baseSize);
}

bool Font::loadFromMemory(const u8* data, usize dataSize, f32 baseSize) {
    fontData_ = makeUnique<FontData>();
    baseSize_ = baseSize;

    fontData_->fontBuffer.resize(dataSize);
    std::memcpy(fontData_->fontBuffer.data(), data, dataSize);

    if (!stbtt_InitFont(&fontData_->fontInfo, fontData_->fontBuffer.data(), 0)) {
        ES_LOG_ERROR("Failed to initialize font");
        fontData_.reset();
        return false;
    }

    fontData_->scale = stbtt_ScaleForPixelHeight(&fontData_->fontInfo, baseSize_);

    int ascent, descent, lineGap;
    stbtt_GetFontVMetrics(&fontData_->fontInfo, &ascent, &descent, &lineGap);

    ascent_ = static_cast<f32>(ascent) * fontData_->scale;
    descent_ = static_cast<f32>(-descent) * fontData_->scale;
    lineHeight_ = ascent_ + descent_ + static_cast<f32>(lineGap) * fontData_->scale;

    buildAtlas();
    createAtlasTexture();

    ES_LOG_INFO("Font loaded: base size {}, atlas {}x{}", baseSize_, atlasWidth_, atlasHeight_);

    return true;
}

// =============================================================================
// Atlas Building
// =============================================================================

void Font::buildAtlas() {
    atlasWidth_ = 512;
    atlasHeight_ = 512;
    atlasData_.resize(atlasWidth_ * atlasHeight_, 0);
    atlasPackX_ = 1;
    atlasPackY_ = 1;
    atlasRowHeight_ = 0;

    for (u32 c = 32; c < 127; ++c) {
        loadGlyph(c);
    }
}

void Font::createAtlasTexture() {
#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
    glGenTextures(1, &atlasTextureId_);
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);

    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

#ifdef ES_PLATFORM_WEB
    glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, atlasWidth_, atlasHeight_, 0, GL_LUMINANCE,
                 GL_UNSIGNED_BYTE, atlasData_.data());
#else
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, atlasWidth_, atlasHeight_, 0, GL_RED, GL_UNSIGNED_BYTE,
                 atlasData_.data());
#endif

    glBindTexture(GL_TEXTURE_2D, 0);
#endif
}

GlyphInfo* Font::loadGlyph(u32 codepoint) {
    if (!fontData_) return nullptr;

    auto it = glyphs_.find(codepoint);
    if (it != glyphs_.end()) {
        return &it->second;
    }

    int glyphIndex = stbtt_FindGlyphIndex(&fontData_->fontInfo, static_cast<int>(codepoint));
    if (glyphIndex == 0 && codepoint != 0) {
        return nullptr;
    }

    int x0, y0, x1, y1;
    stbtt_GetGlyphBitmapBox(&fontData_->fontInfo, glyphIndex, fontData_->scale, fontData_->scale,
                            &x0, &y0, &x1, &y1);

    int glyphWidth = x1 - x0;
    int glyphHeight = y1 - y0;

    int advance, leftBearing;
    stbtt_GetGlyphHMetrics(&fontData_->fontInfo, glyphIndex, &advance, &leftBearing);

    GlyphInfo glyph;
    glyph.width = static_cast<f32>(glyphWidth);
    glyph.height = static_cast<f32>(glyphHeight);
    glyph.bearingX = static_cast<f32>(x0);
    glyph.bearingY = static_cast<f32>(-y0);
    glyph.advance = static_cast<f32>(advance) * fontData_->scale;

    if (glyphWidth > 0 && glyphHeight > 0) {
        int padding = 1;

        if (atlasPackX_ + glyphWidth + padding > static_cast<int>(atlasWidth_)) {
            atlasPackX_ = 1;
            atlasPackY_ += atlasRowHeight_ + padding;
            atlasRowHeight_ = 0;
        }

        if (atlasPackY_ + glyphHeight + padding > static_cast<int>(atlasHeight_)) {
            u32 newHeight = atlasHeight_ * 2;
            if (newHeight > 4096) {
                ES_LOG_WARN("Font atlas exceeded maximum size");
                return nullptr;
            }

            atlasData_.resize(atlasWidth_ * newHeight, 0);
            atlasHeight_ = newHeight;

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
            if (atlasTextureId_ != 0) {
                glDeleteTextures(1, &atlasTextureId_);
                atlasTextureId_ = 0;
            }
            createAtlasTexture();
#endif
        }

        std::vector<u8> bitmap(static_cast<usize>(glyphWidth * glyphHeight));
        stbtt_MakeGlyphBitmap(&fontData_->fontInfo, bitmap.data(), glyphWidth, glyphHeight,
                              glyphWidth, fontData_->scale, fontData_->scale, glyphIndex);

        for (int row = 0; row < glyphHeight; ++row) {
            int dstY = atlasPackY_ + row;
            int srcOffset = row * glyphWidth;
            int dstOffset = dstY * static_cast<int>(atlasWidth_) + atlasPackX_;
            std::memcpy(&atlasData_[static_cast<usize>(dstOffset)],
                        &bitmap[static_cast<usize>(srcOffset)], static_cast<usize>(glyphWidth));
        }

        glyph.u0 = static_cast<f32>(atlasPackX_) / static_cast<f32>(atlasWidth_);
        glyph.v0 = static_cast<f32>(atlasPackY_) / static_cast<f32>(atlasHeight_);
        glyph.u1 = static_cast<f32>(atlasPackX_ + glyphWidth) / static_cast<f32>(atlasWidth_);
        glyph.v1 = static_cast<f32>(atlasPackY_ + glyphHeight) / static_cast<f32>(atlasHeight_);

        atlasPackX_ += glyphWidth + padding;
        atlasRowHeight_ = (glyphHeight > atlasRowHeight_) ? glyphHeight : atlasRowHeight_;

#if defined(ES_PLATFORM_WEB) || defined(ES_PLATFORM_NATIVE)
        if (atlasTextureId_ != 0) {
            glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
#ifdef ES_PLATFORM_WEB
            glTexSubImage2D(GL_TEXTURE_2D, 0, atlasPackX_ - glyphWidth - padding, atlasPackY_,
                            glyphWidth, glyphHeight, GL_LUMINANCE, GL_UNSIGNED_BYTE, bitmap.data());
#else
            glTexSubImage2D(GL_TEXTURE_2D, 0, atlasPackX_ - glyphWidth - padding, atlasPackY_,
                            glyphWidth, glyphHeight, GL_RED, GL_UNSIGNED_BYTE, bitmap.data());
#endif
            glBindTexture(GL_TEXTURE_2D, 0);
        }
#endif
    }

    auto [insertIt, inserted] = glyphs_.emplace(codepoint, glyph);
    return &insertIt->second;
}

// =============================================================================
// Glyph Access
// =============================================================================

const GlyphInfo* Font::getGlyph(u32 codepoint) const {
    auto it = glyphs_.find(codepoint);
    if (it != glyphs_.end()) {
        return &it->second;
    }

    return const_cast<Font*>(this)->loadGlyph(codepoint);
}

void Font::preloadGlyphs(u32 start, u32 end) {
    for (u32 c = start; c < end; ++c) {
        loadGlyph(c);
    }
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 Font::measureText(const std::string& text, f32 fontSize) const {
    if (text.empty()) return {0.0f, 0.0f};

    f32 scale = fontSize / baseSize_;
    f32 width = 0.0f;
    f32 maxWidth = 0.0f;
    f32 height = fontSize;
    i32 lines = 1;

    for (char c : text) {
        if (c == '\n') {
            maxWidth = (width > maxWidth) ? width : maxWidth;
            width = 0.0f;
            lines++;
            continue;
        }

        const auto* glyph = getGlyph(static_cast<u32>(c));
        if (glyph) {
            width += glyph->advance * scale;
        }
    }

    maxWidth = (width > maxWidth) ? width : maxWidth;
    height = static_cast<f32>(lines) * fontSize * 1.2f;

    return {maxWidth, height};
}

f32 Font::getCharWidth(u32 codepoint, f32 fontSize) const {
    const auto* glyph = getGlyph(codepoint);
    if (!glyph) return 0.0f;

    f32 scale = fontSize / baseSize_;
    return glyph->advance * scale;
}

f32 Font::getKerning(u32 left, u32 right, f32 fontSize) const {
    if (!fontData_) return 0.0f;

    int kern = stbtt_GetCodepointKernAdvance(&fontData_->fontInfo, static_cast<int>(left),
                                              static_cast<int>(right));

    f32 scale = fontSize / baseSize_;
    return static_cast<f32>(kern) * fontData_->scale * scale;
}

}  // namespace esengine::ui
