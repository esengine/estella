/**
 * @file    SDFFont.cpp
 * @brief   SDF font rendering implementation using FreeType
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "SDFFont.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <cstring>
#include <fstream>

#ifdef ES_PLATFORM_WEB
    #include <GLES3/gl3.h>
#else
    #include <ft2build.h>
    #include FT_FREETYPE_H
    #include FT_MODULE_H
    #ifdef _WIN32
        #include <windows.h>
    #endif
    #include <glad/glad.h>
    #ifndef GL_UNPACK_ALIGNMENT
        #define GL_UNPACK_ALIGNMENT 0x0CF5
    #endif
#endif

namespace esengine::ui {

// =============================================================================
// FreeType Data (Native only)
// =============================================================================

#ifndef ES_PLATFORM_WEB
struct SDFFont::FTData {
    FT_Library library = nullptr;
    FT_Face face = nullptr;
    std::vector<u8> fontBuffer;
};
#else
struct SDFFont::FTData {};
#endif

// =============================================================================
// Constructor / Destructor
// =============================================================================

SDFFont::~SDFFont() {
    if (atlasTextureId_ != 0) {
        glDeleteTextures(1, &atlasTextureId_);
        atlasTextureId_ = 0;
    }

#ifndef ES_PLATFORM_WEB
    if (ftData_) {
        if (ftData_->face) {
            FT_Done_Face(ftData_->face);
        }
        if (ftData_->library) {
            FT_Done_FreeType(ftData_->library);
        }
    }
#endif
}

SDFFont::SDFFont(SDFFont&& other) noexcept
    : ftData_(std::move(other.ftData_)),
      sdfSize_(other.sdfSize_),
      sdfSpread_(other.sdfSpread_),
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

SDFFont& SDFFont::operator=(SDFFont&& other) noexcept {
    if (this != &other) {
        if (atlasTextureId_ != 0) {
            glDeleteTextures(1, &atlasTextureId_);
        }
#ifndef ES_PLATFORM_WEB
        if (ftData_) {
            if (ftData_->face) FT_Done_Face(ftData_->face);
            if (ftData_->library) FT_Done_FreeType(ftData_->library);
        }
#endif

        ftData_ = std::move(other.ftData_);
        sdfSize_ = other.sdfSize_;
        sdfSpread_ = other.sdfSpread_;
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
// Factory Methods
// =============================================================================

Unique<SDFFont> SDFFont::create(const std::string& path, f32 sdfSize, f32 sdfSpread) {
    auto font = Unique<SDFFont>(new SDFFont());
    if (!font->loadFromFile(path, sdfSize, sdfSpread)) {
        return nullptr;
    }
    return font;
}

// =============================================================================
// Loading
// =============================================================================

#ifdef ES_PLATFORM_WEB
bool SDFFont::loadFromFile(const std::string& path, f32 sdfSize, f32 sdfSpread) {
    (void)path; (void)sdfSize; (void)sdfSpread;
    ES_LOG_WARN("SDFFont: Dynamic font loading not supported on Web platform");
    return false;
}
#else
bool SDFFont::loadFromFile(const std::string& path, f32 sdfSize, f32 sdfSpread) {
    sdfSize_ = sdfSize;
    sdfSpread_ = sdfSpread;

    std::ifstream file(path, std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        ES_LOG_ERROR("SDFFont: Failed to open font file: {}", path);
        return false;
    }

    auto fileSize = file.tellg();
    file.seekg(0, std::ios::beg);

    ftData_ = makeUnique<FTData>();
    ftData_->fontBuffer.resize(static_cast<usize>(fileSize));

    if (!file.read(reinterpret_cast<char*>(ftData_->fontBuffer.data()), fileSize)) {
        ES_LOG_ERROR("SDFFont: Failed to read font file: {}", path);
        ftData_.reset();
        return false;
    }

    FT_Error error = FT_Init_FreeType(&ftData_->library);
    if (error) {
        ES_LOG_ERROR("SDFFont: Failed to initialize FreeType: {}", error);
        ftData_.reset();
        return false;
    }

    error = FT_New_Memory_Face(
        ftData_->library,
        ftData_->fontBuffer.data(),
        static_cast<FT_Long>(ftData_->fontBuffer.size()),
        0,
        &ftData_->face
    );

    if (error) {
        ES_LOG_ERROR("SDFFont: Failed to create font face: {}", error);
        FT_Done_FreeType(ftData_->library);
        ftData_.reset();
        return false;
    }

    error = FT_Set_Pixel_Sizes(ftData_->face, 0, static_cast<FT_UInt>(sdfSize_));
    if (error) {
        ES_LOG_ERROR("SDFFont: Failed to set pixel size: {}", error);
        FT_Done_Face(ftData_->face);
        FT_Done_FreeType(ftData_->library);
        ftData_.reset();
        return false;
    }

    FT_UInt spread = static_cast<FT_UInt>(sdfSpread_);
    FT_Property_Set(ftData_->library, "sdf", "spread", &spread);

    ascent_ = static_cast<f32>(ftData_->face->size->metrics.ascender) / 64.0f;
    descent_ = static_cast<f32>(-ftData_->face->size->metrics.descender) / 64.0f;
    lineHeight_ = static_cast<f32>(ftData_->face->size->metrics.height) / 64.0f;

    atlasData_.resize(atlasWidth_ * atlasHeight_, 0);

    glGenTextures(1, &atlasTextureId_);
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, atlasWidth_, atlasHeight_, 0,
                 GL_RED, GL_UNSIGNED_BYTE, atlasData_.data());

    glBindTexture(GL_TEXTURE_2D, 0);

    ES_LOG_INFO("SDFFont loaded: {} (size={}, spread={}, atlas={}x{})",
                path, sdfSize_, sdfSpread_, atlasWidth_, atlasHeight_);

    preloadASCII();

    return true;
}
#endif

// =============================================================================
// Glyph Loading
// =============================================================================

const SDFGlyphInfo* SDFFont::getGlyph(u32 codepoint) {
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

#ifdef ES_PLATFORM_WEB
SDFGlyphInfo* SDFFont::loadGlyph(u32 codepoint) {
    (void)codepoint;
    return nullptr;
}
#else
SDFGlyphInfo* SDFFont::loadGlyph(u32 codepoint) {
    if (!ftData_ || !ftData_->face) return nullptr;

    FT_UInt glyphIndex = FT_Get_Char_Index(ftData_->face, codepoint);
    if (glyphIndex == 0 && codepoint != 0) {
        return nullptr;
    }

    FT_Error error = FT_Load_Glyph(ftData_->face, glyphIndex, FT_LOAD_DEFAULT);
    if (error) {
        ES_LOG_WARN("SDFFont: Failed to load glyph for codepoint {}: {}", codepoint, error);
        return nullptr;
    }

    error = FT_Render_Glyph(ftData_->face->glyph, FT_RENDER_MODE_SDF);
    if (error) {
        error = FT_Render_Glyph(ftData_->face->glyph, FT_RENDER_MODE_NORMAL);
        if (error) {
            ES_LOG_WARN("SDFFont: Failed to render glyph for codepoint {}: {}", codepoint, error);
            return nullptr;
        }
    }

    FT_GlyphSlot slot = ftData_->face->glyph;
    FT_Bitmap& bitmap = slot->bitmap;

    SDFGlyphInfo glyph;
    glyph.width = static_cast<f32>(bitmap.width);
    glyph.height = static_cast<f32>(bitmap.rows);
    glyph.bearingX = static_cast<f32>(slot->bitmap_left);
    glyph.bearingY = static_cast<f32>(slot->bitmap_top);
    glyph.advance = static_cast<f32>(slot->advance.x) / 64.0f;

    if (bitmap.width > 0 && bitmap.rows > 0) {
        i32 glyphW = static_cast<i32>(bitmap.width);
        i32 glyphH = static_cast<i32>(bitmap.rows);
        i32 padding = 1;

        while (glyphs_.size() >= maxCachedGlyphs_) {
            evictLRU();
        }

        i32 atlasX, atlasY;
        if (!findAtlasSpace(glyphW + padding, glyphH + padding, atlasX, atlasY)) {
            packX_ = 1;
            packY_ = 1;
            rowHeight_ = 0;
            atlasData_.assign(atlasWidth_ * atlasHeight_, 0);

            for (auto& [cp, g] : glyphs_) {
                g.u0 = g.v0 = g.u1 = g.v1 = 0.0f;
            }
            glyphs_.clear();
            lruList_.clear();
            lruMap_.clear();

            if (!findAtlasSpace(glyphW + padding, glyphH + padding, atlasX, atlasY)) {
                ES_LOG_ERROR("SDFFont: Glyph too large for atlas");
                return nullptr;
            }
        }

        for (i32 row = 0; row < glyphH; ++row) {
            i32 srcOffset = row * static_cast<i32>(bitmap.pitch);
            i32 dstOffset = (atlasY + row) * static_cast<i32>(atlasWidth_) + atlasX;
            std::memcpy(&atlasData_[static_cast<usize>(dstOffset)],
                        &bitmap.buffer[srcOffset],
                        static_cast<usize>(glyphW));
        }

        glyph.atlasX = atlasX;
        glyph.atlasY = atlasY;
        glyph.atlasWidth = glyphW;
        glyph.atlasHeight = glyphH;

        glyph.u0 = static_cast<f32>(atlasX) / static_cast<f32>(atlasWidth_);
        glyph.v0 = static_cast<f32>(atlasY) / static_cast<f32>(atlasHeight_);
        glyph.u1 = static_cast<f32>(atlasX + glyphW) / static_cast<f32>(atlasWidth_);
        glyph.v1 = static_cast<f32>(atlasY + glyphH) / static_cast<f32>(atlasHeight_);

        glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
        glTexSubImage2D(GL_TEXTURE_2D, 0, atlasX, atlasY, glyphW, glyphH,
                        GL_RED, GL_UNSIGNED_BYTE, bitmap.buffer);
        glBindTexture(GL_TEXTURE_2D, 0);

        markAtlasRegionUsed(atlasX, atlasY, glyphW + padding, glyphH + padding);
    }

    auto [insertIt, inserted] = glyphs_.emplace(codepoint, glyph);
    if (inserted) {
        lruList_.push_front(codepoint);
        lruMap_[codepoint] = lruList_.begin();
    }

    return &insertIt->second;
}
#endif

// =============================================================================
// LRU Cache Management
// =============================================================================

void SDFFont::evictLRU() {
    if (lruList_.empty()) return;

    u32 evictCodepoint = lruList_.back();
    lruList_.pop_back();
    lruMap_.erase(evictCodepoint);

    auto it = glyphs_.find(evictCodepoint);
    if (it != glyphs_.end()) {
        markAtlasRegionFree(it->second.atlasX, it->second.atlasY,
                            it->second.atlasWidth, it->second.atlasHeight);
        glyphs_.erase(it);
    }
}

void SDFFont::clearCache() {
    glyphs_.clear();
    lruList_.clear();
    lruMap_.clear();
    packX_ = 1;
    packY_ = 1;
    rowHeight_ = 0;
    atlasData_.assign(atlasWidth_ * atlasHeight_, 0);
    rebuildAtlasTexture();
}

// =============================================================================
// Atlas Space Management
// =============================================================================

bool SDFFont::findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY) {
    if (packX_ + width > static_cast<i32>(atlasWidth_)) {
        packX_ = 1;
        packY_ += rowHeight_ + 1;
        rowHeight_ = 0;
    }

    if (packY_ + height > static_cast<i32>(atlasHeight_)) {
        return false;
    }

    outX = packX_;
    outY = packY_;
    packX_ += width;
    rowHeight_ = std::max(rowHeight_, height);

    return true;
}

void SDFFont::markAtlasRegionUsed(i32 x, i32 y, i32 width, i32 height) {
    (void)x; (void)y; (void)width; (void)height;
}

void SDFFont::markAtlasRegionFree(i32 x, i32 y, i32 width, i32 height) {
    (void)x; (void)y; (void)width; (void)height;
}

void SDFFont::rebuildAtlasTexture() {
    if (atlasTextureId_ == 0) return;

    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
#ifdef ES_PLATFORM_WEB
    glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, atlasWidth_, atlasHeight_, 0,
                 GL_LUMINANCE, GL_UNSIGNED_BYTE, atlasData_.data());
#else
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RED, atlasWidth_, atlasHeight_, 0,
                 GL_RED, GL_UNSIGNED_BYTE, atlasData_.data());
#endif
    glBindTexture(GL_TEXTURE_2D, 0);
}

// =============================================================================
// Preloading
// =============================================================================

void SDFFont::preloadASCII() {
    for (u32 c = 32; c < 127; ++c) {
        loadGlyph(c);
    }
    ES_LOG_DEBUG("SDFFont: Preloaded {} ASCII glyphs", glyphs_.size());
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 SDFFont::measureText(const std::string& text, f32 fontSize) {
    if (text.empty()) return {0.0f, 0.0f};

    f32 scale = fontSize / sdfSize_;
    f32 width = 0.0f;
    f32 maxWidth = 0.0f;
    i32 lines = 1;

    const u8* ptr = reinterpret_cast<const u8*>(text.data());
    const u8* end = ptr + text.size();

    while (ptr < end) {
        u32 codepoint;
        if ((*ptr & 0x80) == 0) {
            codepoint = *ptr++;
        } else if ((*ptr & 0xE0) == 0xC0) {
            codepoint = (*ptr++ & 0x1F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else if ((*ptr & 0xF0) == 0xE0) {
            codepoint = (*ptr++ & 0x0F) << 12;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else if ((*ptr & 0xF8) == 0xF0) {
            codepoint = (*ptr++ & 0x07) << 18;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 12;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else {
            ptr++;
            continue;
        }

        if (codepoint == '\n') {
            maxWidth = std::max(maxWidth, width);
            width = 0.0f;
            lines++;
            continue;
        }

        const auto* glyph = getGlyph(codepoint);
        if (glyph) {
            width += glyph->advance * scale;
        }
    }

    maxWidth = std::max(maxWidth, width);
    f32 height = static_cast<f32>(lines) * fontSize * 1.2f;

    return {maxWidth, height};
}

f32 SDFFont::getCharWidth(u32 codepoint, f32 fontSize) {
    const auto* glyph = getGlyph(codepoint);
    if (!glyph) return 0.0f;

    f32 scale = fontSize / sdfSize_;
    return glyph->advance * scale;
}

}  // namespace esengine::ui
