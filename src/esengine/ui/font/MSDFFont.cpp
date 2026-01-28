/**
 * @file    MSDFFont.cpp
 * @brief   MSDF font rendering implementation using msdfgen
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "MSDFFont.hpp"
#include "../../core/Log.hpp"

#include <msdfgen.h>
#include <msdfgen-ext.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <fstream>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
#endif

#ifndef GL_UNPACK_ALIGNMENT
    #define GL_UNPACK_ALIGNMENT 0x0CF5
#endif

namespace esengine::ui {

// =============================================================================
// Font Data
// =============================================================================

struct MSDFFont::FontData {
    msdfgen::FreetypeHandle* ft = nullptr;
    msdfgen::FontHandle* font = nullptr;
    std::vector<u8> fontBuffer;
};

// =============================================================================
// Constructor / Destructor
// =============================================================================

MSDFFont::~MSDFFont() {
    if (atlasTextureId_ != 0) {
        glDeleteTextures(1, &atlasTextureId_);
        atlasTextureId_ = 0;
    }

    if (fontData_) {
        if (fontData_->font) {
            msdfgen::destroyFont(fontData_->font);
        }
        if (fontData_->ft) {
            msdfgen::deinitializeFreetype(fontData_->ft);
        }
    }
}

MSDFFont::MSDFFont(MSDFFont&& other) noexcept
    : fontData_(std::move(other.fontData_)),
      fontSize_(other.fontSize_),
      pixelRange_(other.pixelRange_),
      ascent_(other.ascent_),
      descent_(other.descent_),
      lineHeight_(other.lineHeight_),
      atlasTextureId_(other.atlasTextureId_),
      atlasWidth_(other.atlasWidth_),
      atlasHeight_(other.atlasHeight_),
      atlasData_(std::move(other.atlasData_)),
      glyphs_(std::move(other.glyphs_)),
      lruList_(std::move(other.lruList_)),
      lruMap_(std::move(other.lruMap_)),
      maxCachedGlyphs_(other.maxCachedGlyphs_),
      packX_(other.packX_),
      packY_(other.packY_),
      rowHeight_(other.rowHeight_) {
    other.atlasTextureId_ = 0;
}

MSDFFont& MSDFFont::operator=(MSDFFont&& other) noexcept {
    if (this != &other) {
        if (atlasTextureId_ != 0) {
            glDeleteTextures(1, &atlasTextureId_);
        }
        if (fontData_) {
            if (fontData_->font) msdfgen::destroyFont(fontData_->font);
            if (fontData_->ft) msdfgen::deinitializeFreetype(fontData_->ft);
        }

        fontData_ = std::move(other.fontData_);
        fontSize_ = other.fontSize_;
        pixelRange_ = other.pixelRange_;
        ascent_ = other.ascent_;
        descent_ = other.descent_;
        lineHeight_ = other.lineHeight_;
        atlasTextureId_ = other.atlasTextureId_;
        atlasWidth_ = other.atlasWidth_;
        atlasHeight_ = other.atlasHeight_;
        atlasData_ = std::move(other.atlasData_);
        glyphs_ = std::move(other.glyphs_);
        lruList_ = std::move(other.lruList_);
        lruMap_ = std::move(other.lruMap_);
        maxCachedGlyphs_ = other.maxCachedGlyphs_;
        packX_ = other.packX_;
        packY_ = other.packY_;
        rowHeight_ = other.rowHeight_;
        other.atlasTextureId_ = 0;
    }
    return *this;
}

// =============================================================================
// Factory
// =============================================================================

Unique<MSDFFont> MSDFFont::create(const std::string& path, f32 fontSize, f32 pixelRange) {
    auto font = Unique<MSDFFont>(new MSDFFont());
    if (!font->loadFromFile(path, fontSize, pixelRange)) {
        return nullptr;
    }
    return font;
}

// =============================================================================
// Loading
// =============================================================================

bool MSDFFont::loadFromFile(const std::string& path, f32 fontSize, f32 pixelRange) {
    fontSize_ = fontSize;
    pixelRange_ = pixelRange;

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        ES_LOG_ERROR("MSDFFont: Failed to open file: {}", path);
        return false;
    }

    fontData_ = makeUnique<FontData>();

    fontData_->ft = msdfgen::initializeFreetype();
    if (!fontData_->ft) {
        ES_LOG_ERROR("MSDFFont: Failed to initialize FreeType");
        return false;
    }

    fontData_->font = msdfgen::loadFont(fontData_->ft, path.c_str());
    if (!fontData_->font) {
        ES_LOG_ERROR("MSDFFont: Failed to load font: {}", path);
        return false;
    }

    msdfgen::FontMetrics metrics;
    msdfgen::getFontMetrics(metrics, fontData_->font);

    f32 scale = fontSize_ / static_cast<f32>(metrics.emSize);
    ascent_ = static_cast<f32>(metrics.ascenderY) * scale;
    descent_ = static_cast<f32>(-metrics.descenderY) * scale;
    lineHeight_ = static_cast<f32>(metrics.lineHeight) * scale;

    atlasData_.resize(atlasWidth_ * atlasHeight_ * 3, 0);

    glGenTextures(1, &atlasTextureId_);
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB8, atlasWidth_, atlasHeight_, 0, GL_RGB, GL_UNSIGNED_BYTE, atlasData_.data());

    ES_LOG_INFO("MSDFFont loaded: {} (size={}, range={}, atlas={}x{})",
                path, fontSize_, pixelRange_, atlasWidth_, atlasHeight_);

    preloadASCII();
    return true;
}

// =============================================================================
// Glyph Loading
// =============================================================================

MSDFGlyphInfo* MSDFFont::loadGlyph(u32 codepoint) {
    if (!fontData_ || !fontData_->font) return nullptr;

    msdfgen::Shape shape;
    double advance;
    if (!msdfgen::loadGlyph(shape, fontData_->font, codepoint, msdfgen::FONT_SCALING_EM_NORMALIZED, &advance)) {
        return nullptr;
    }

    if (shape.contours.empty()) {
        MSDFGlyphInfo& info = glyphs_[codepoint];
        info.width = 0;
        info.height = 0;
        info.bearingX = 0;
        info.bearingY = 0;
        info.advance = static_cast<f32>(advance) * fontSize_;
        info.u0 = info.v0 = info.u1 = info.v1 = 0;
        return &info;
    }

    shape.normalize();
    msdfgen::edgeColoringSimple(shape, 3.0);

    msdfgen::Shape::Bounds bounds = shape.getBounds(pixelRange_ / fontSize_);

    i32 glyphWidth = static_cast<i32>(std::ceil((bounds.r - bounds.l) * fontSize_)) + 2;
    i32 glyphHeight = static_cast<i32>(std::ceil((bounds.t - bounds.b) * fontSize_)) + 2;

    glyphWidth = std::max(glyphWidth, 1);
    glyphHeight = std::max(glyphHeight, 1);

    if (glyphs_.size() >= maxCachedGlyphs_) {
        evictLRU();
    }

    i32 atlasX, atlasY;
    if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
        ES_LOG_WARN("MSDFFont: Atlas full, clearing cache");
        clearCache();
        packX_ = 1;
        packY_ = 1;
        rowHeight_ = 0;
        if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
            return nullptr;
        }
    }

    msdfgen::Bitmap<float, 3> msdf(glyphWidth, glyphHeight);

    msdfgen::Vector2 scale(fontSize_, fontSize_);
    msdfgen::Vector2 translate(1.0 / fontSize_ - bounds.l, 1.0 / fontSize_ - bounds.b);

    double rangeInEm = pixelRange_ / fontSize_;
    msdfgen::Range range(-rangeInEm / 2.0, rangeInEm / 2.0);

    msdfgen::generateMSDF(msdf, shape, range, scale, translate);

    for (i32 y = 0; y < glyphHeight; ++y) {
        for (i32 x = 0; x < glyphWidth; ++x) {
            i32 atlasIdx = ((atlasY + y) * atlasWidth_ + (atlasX + x)) * 3;
            float* pixel = msdf(x, glyphHeight - 1 - y);
            atlasData_[atlasIdx + 0] = static_cast<u8>(std::clamp(pixel[0], 0.0f, 1.0f) * 255.0f);
            atlasData_[atlasIdx + 1] = static_cast<u8>(std::clamp(pixel[1], 0.0f, 1.0f) * 255.0f);
            atlasData_[atlasIdx + 2] = static_cast<u8>(std::clamp(pixel[2], 0.0f, 1.0f) * 255.0f);
        }
    }

    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);

    std::vector<u8> subImage(glyphWidth * glyphHeight * 3);
    for (i32 y = 0; y < glyphHeight; ++y) {
        std::memcpy(&subImage[y * glyphWidth * 3],
                    &atlasData_[((atlasY + y) * atlasWidth_ + atlasX) * 3],
                    glyphWidth * 3);
    }
    glTexSubImage2D(GL_TEXTURE_2D, 0, atlasX, atlasY, glyphWidth, glyphHeight,
                    GL_RGB, GL_UNSIGNED_BYTE, subImage.data());

    MSDFGlyphInfo& info = glyphs_[codepoint];
    info.width = static_cast<f32>(glyphWidth);
    info.height = static_cast<f32>(glyphHeight);
    info.bearingX = static_cast<f32>(bounds.l) * fontSize_ - 1.0f;
    info.bearingY = static_cast<f32>(bounds.t) * fontSize_ + 1.0f;
    info.advance = static_cast<f32>(advance) * fontSize_;

    info.atlasX = atlasX;
    info.atlasY = atlasY;
    info.atlasWidth = glyphWidth;
    info.atlasHeight = glyphHeight;

    info.u0 = static_cast<f32>(atlasX) / atlasWidth_;
    info.v0 = static_cast<f32>(atlasY) / atlasHeight_;
    info.u1 = static_cast<f32>(atlasX + glyphWidth) / atlasWidth_;
    info.v1 = static_cast<f32>(atlasY + glyphHeight) / atlasHeight_;

    lruList_.push_front(codepoint);
    lruMap_[codepoint] = lruList_.begin();

    return &info;
}

const MSDFGlyphInfo* MSDFFont::getGlyph(u32 codepoint) {
    auto it = glyphs_.find(codepoint);
    if (it != glyphs_.end()) {
        auto lruIt = lruMap_.find(codepoint);
        if (lruIt != lruMap_.end()) {
            lruList_.erase(lruIt->second);
            lruList_.push_front(codepoint);
            lruMap_[codepoint] = lruList_.begin();
        }
        return &it->second;
    }
    return loadGlyph(codepoint);
}

void MSDFFont::preloadASCII() {
    for (u32 c = 32; c < 127; ++c) {
        getGlyph(c);
    }
    ES_LOG_DEBUG("MSDFFont: Preloaded {} ASCII glyphs", 127 - 32);
}

// =============================================================================
// Cache Management
// =============================================================================

void MSDFFont::evictLRU() {
    if (lruList_.empty()) return;

    u32 lruCodepoint = lruList_.back();
    lruList_.pop_back();
    lruMap_.erase(lruCodepoint);
    glyphs_.erase(lruCodepoint);
}

void MSDFFont::clearCache() {
    glyphs_.clear();
    lruList_.clear();
    lruMap_.clear();
    std::fill(atlasData_.begin(), atlasData_.end(), 0);
    rebuildAtlasTexture();
}

void MSDFFont::rebuildAtlasTexture() {
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, atlasWidth_, atlasHeight_,
                    GL_RGB, GL_UNSIGNED_BYTE, atlasData_.data());
}

bool MSDFFont::findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY) {
    if (packX_ + width + 1 > static_cast<i32>(atlasWidth_)) {
        packX_ = 1;
        packY_ += rowHeight_ + 1;
        rowHeight_ = 0;
    }

    if (packY_ + height + 1 > static_cast<i32>(atlasHeight_)) {
        return false;
    }

    outX = packX_;
    outY = packY_;
    packX_ += width + 1;
    rowHeight_ = std::max(rowHeight_, height);
    return true;
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 MSDFFont::measureText(const std::string& text, f32 fontSize) {
    f32 scale = fontSize / fontSize_;
    f32 width = 0.0f;

    usize i = 0;
    while (i < text.size()) {
        u32 codepoint;
        u8 c = static_cast<u8>(text[i]);
        if ((c & 0x80) == 0) {
            codepoint = c;
            i += 1;
        } else if ((c & 0xE0) == 0xC0) {
            codepoint = (c & 0x1F) << 6;
            if (i + 1 < text.size()) codepoint |= (static_cast<u8>(text[i + 1]) & 0x3F);
            i += 2;
        } else if ((c & 0xF0) == 0xE0) {
            codepoint = (c & 0x0F) << 12;
            if (i + 1 < text.size()) codepoint |= (static_cast<u8>(text[i + 1]) & 0x3F) << 6;
            if (i + 2 < text.size()) codepoint |= (static_cast<u8>(text[i + 2]) & 0x3F);
            i += 3;
        } else if ((c & 0xF8) == 0xF0) {
            codepoint = (c & 0x07) << 18;
            if (i + 1 < text.size()) codepoint |= (static_cast<u8>(text[i + 1]) & 0x3F) << 12;
            if (i + 2 < text.size()) codepoint |= (static_cast<u8>(text[i + 2]) & 0x3F) << 6;
            if (i + 3 < text.size()) codepoint |= (static_cast<u8>(text[i + 3]) & 0x3F);
            i += 4;
        } else {
            i += 1;
            continue;
        }

        const MSDFGlyphInfo* glyph = getGlyph(codepoint);
        if (glyph) {
            width += glyph->advance * scale;
        }
    }

    return glm::vec2(width, lineHeight_ * scale);
}

f32 MSDFFont::getCharWidth(u32 codepoint, f32 fontSize) {
    f32 scale = fontSize / fontSize_;
    const MSDFGlyphInfo* glyph = getGlyph(codepoint);
    if (glyph) {
        return glyph->advance * scale;
    }
    return 0.0f;
}

}  // namespace esengine::ui
