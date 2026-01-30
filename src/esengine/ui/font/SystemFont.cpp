/**
 * @file    SystemFont.cpp
 * @brief   System font rendering implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "SystemFont.hpp"
#include "../../core/Log.hpp"

#ifdef ES_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

#ifdef ES_PLATFORM_WEB
#include <emscripten.h>
#include <emscripten/html5.h>
#endif

#ifndef ES_PLATFORM_WEB
#include <glad/glad.h>
#endif

namespace esengine::ui {

// =============================================================================
// Platform-specific Data
// =============================================================================

#ifdef ES_PLATFORM_WINDOWS
struct SystemFont::PlatformData {
    HDC hdc = nullptr;
    HFONT hFont = nullptr;
    HBITMAP hBitmap = nullptr;
    void* bitmapBits = nullptr;
    i32 bitmapWidth = 256;
    i32 bitmapHeight = 256;
};
#elif defined(ES_PLATFORM_WEB)
struct SystemFont::PlatformData {
    i32 canvasId = 0;
};
#else
struct SystemFont::PlatformData {};
#endif

// =============================================================================
// Constructor / Destructor
// =============================================================================

SystemFont::~SystemFont() {
#ifdef ES_PLATFORM_WINDOWS
    if (platformData_) {
        if (platformData_->hFont) DeleteObject(platformData_->hFont);
        if (platformData_->hBitmap) DeleteObject(platformData_->hBitmap);
        if (platformData_->hdc) DeleteDC(platformData_->hdc);
    }
#endif

#ifndef ES_PLATFORM_WEB
    if (atlasTextureId_) {
        glDeleteTextures(1, &atlasTextureId_);
    }
#endif
}

SystemFont::SystemFont(SystemFont&& other) noexcept
    : platformData_(std::move(other.platformData_))
    , fontFamily_(std::move(other.fontFamily_))
    , fontSize_(other.fontSize_)
    , ascent_(other.ascent_)
    , descent_(other.descent_)
    , lineHeight_(other.lineHeight_)
    , atlasTextureId_(other.atlasTextureId_)
    , atlasWidth_(other.atlasWidth_)
    , atlasHeight_(other.atlasHeight_)
    , atlasData_(std::move(other.atlasData_))
    , glyphs_(std::move(other.glyphs_))
    , lruList_(std::move(other.lruList_))
    , lruMap_(std::move(other.lruMap_))
    , maxCachedGlyphs_(other.maxCachedGlyphs_)
    , packX_(other.packX_)
    , packY_(other.packY_)
    , rowHeight_(other.rowHeight_) {
    other.atlasTextureId_ = 0;
}

SystemFont& SystemFont::operator=(SystemFont&& other) noexcept {
    if (this != &other) {
        platformData_ = std::move(other.platformData_);
        fontFamily_ = std::move(other.fontFamily_);
        fontSize_ = other.fontSize_;
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

Unique<SystemFont> SystemFont::create(const std::string& fontFamily, f32 fontSize) {
    auto font = Unique<SystemFont>(new SystemFont());
    if (!font->init(fontFamily, fontSize)) {
        return nullptr;
    }
    return font;
}

bool SystemFont::init(const std::string& fontFamily, f32 fontSize) {
    fontFamily_ = fontFamily;
    fontSize_ = fontSize;
    platformData_ = std::make_unique<PlatformData>();

#ifdef ES_PLATFORM_WINDOWS
    platformData_->hdc = CreateCompatibleDC(nullptr);
    if (!platformData_->hdc) {
        ES_LOG_ERROR("SystemFont: Failed to create DC");
        return false;
    }

    platformData_->hFont = CreateFontA(
        -static_cast<int>(fontSize),
        0, 0, 0,
        FW_NORMAL,
        FALSE, FALSE, FALSE,
        DEFAULT_CHARSET,
        OUT_TT_PRECIS,
        CLIP_DEFAULT_PRECIS,
        ANTIALIASED_QUALITY,
        DEFAULT_PITCH | FF_DONTCARE,
        fontFamily.c_str()
    );

    if (!platformData_->hFont) {
        ES_LOG_ERROR("SystemFont: Failed to create font '{}'", fontFamily);
        return false;
    }

    SelectObject(platformData_->hdc, platformData_->hFont);

    TEXTMETRICA tm;
    GetTextMetricsA(platformData_->hdc, &tm);
    ascent_ = static_cast<f32>(tm.tmAscent);
    descent_ = static_cast<f32>(tm.tmDescent);
    lineHeight_ = static_cast<f32>(tm.tmHeight);

    BITMAPINFO bmi = {};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = platformData_->bitmapWidth;
    bmi.bmiHeader.biHeight = -platformData_->bitmapHeight;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;

    platformData_->hBitmap = CreateDIBSection(
        platformData_->hdc, &bmi, DIB_RGB_COLORS,
        &platformData_->bitmapBits, nullptr, 0
    );

    if (!platformData_->hBitmap) {
        ES_LOG_ERROR("SystemFont: Failed to create bitmap");
        return false;
    }

    SelectObject(platformData_->hdc, platformData_->hBitmap);
    SetBkMode(platformData_->hdc, TRANSPARENT);
    SetTextColor(platformData_->hdc, RGB(255, 255, 255));

#elif defined(ES_PLATFORM_WEB)
    EM_ASM({
        if (!Module._systemFontCanvases) Module._systemFontCanvases = {};
        var id = Object.keys(Module._systemFontCanvases).length;
        var canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        var ctx = canvas.getContext('2d');
        ctx.font = $1 + 'px ' + UTF8ToString($0);
        ctx.textBaseline = 'top';
        ctx.fillStyle = 'white';
        Module._systemFontCanvases[id] = { canvas: canvas, ctx: ctx };

        var metrics = ctx.measureText('M');
        Module._systemFontMetrics = {
            ascent: metrics.actualBoundingBoxAscent || $1 * 0.8,
            descent: metrics.actualBoundingBoxDescent || $1 * 0.2
        };
    }, fontFamily.c_str(), static_cast<int>(fontSize));

    ascent_ = fontSize * 0.8f;
    descent_ = fontSize * 0.2f;
    lineHeight_ = fontSize * 1.2f;
#endif

    atlasData_.resize(static_cast<size_t>(atlasWidth_) * atlasHeight_, 0);

#ifndef ES_PLATFORM_WEB
    glGenTextures(1, &atlasTextureId_);
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, atlasWidth_, atlasHeight_, 0,
                 GL_RED, GL_UNSIGNED_BYTE, atlasData_.data());
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
#endif

    ES_LOG_INFO("SystemFont: Created '{}' at {}px", fontFamily, fontSize);
    return true;
}

// =============================================================================
// Glyph Access
// =============================================================================

const GlyphInfo* SystemFont::getGlyph(u32 codepoint) {
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

    return renderGlyph(codepoint);
}

GlyphInfo* SystemFont::renderGlyph(u32 codepoint) {
    if (glyphs_.size() >= maxCachedGlyphs_) {
        evictLRU();
    }

    GlyphInfo glyph;

#ifdef ES_PLATFORM_WINDOWS
    wchar_t wc[2] = { static_cast<wchar_t>(codepoint), 0 };

    SIZE size;
    GetTextExtentPoint32W(platformData_->hdc, wc, 1, &size);

    i32 glyphWidth = size.cx + 2;
    i32 glyphHeight = size.cy + 2;

    if (glyphWidth > platformData_->bitmapWidth || glyphHeight > platformData_->bitmapHeight) {
        return nullptr;
    }

    memset(platformData_->bitmapBits, 0,
           static_cast<size_t>(platformData_->bitmapWidth) * platformData_->bitmapHeight * 4);

    TextOutW(platformData_->hdc, 1, 1, wc, 1);

    i32 atlasX, atlasY;
    if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
        rebuildAtlasTexture();
        if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
            return nullptr;
        }
    }

    u8* src = static_cast<u8*>(platformData_->bitmapBits);
    for (i32 y = 0; y < glyphHeight; ++y) {
        for (i32 x = 0; x < glyphWidth; ++x) {
            i32 srcIdx = (y * platformData_->bitmapWidth + x) * 4;
            i32 dstIdx = (atlasY + y) * atlasWidth_ + (atlasX + x);
            atlasData_[dstIdx] = src[srcIdx];
        }
    }

    ABC abc;
    if (GetCharABCWidthsW(platformData_->hdc, codepoint, codepoint, &abc)) {
        glyph.bearingX = static_cast<f32>(abc.abcA);
        glyph.advance = static_cast<f32>(abc.abcA + abc.abcB + abc.abcC);
    } else {
        glyph.bearingX = 0;
        glyph.advance = static_cast<f32>(size.cx);
    }

    glyph.width = static_cast<f32>(glyphWidth);
    glyph.height = static_cast<f32>(glyphHeight);
    glyph.bearingY = ascent_;
    glyph.u0 = static_cast<f32>(atlasX) / atlasWidth_;
    glyph.v0 = static_cast<f32>(atlasY) / atlasHeight_;
    glyph.u1 = static_cast<f32>(atlasX + glyphWidth) / atlasWidth_;
    glyph.v1 = static_cast<f32>(atlasY + glyphHeight) / atlasHeight_;

#elif defined(ES_PLATFORM_WEB)
    i32 glyphWidth = static_cast<i32>(fontSize_ * 1.5f);
    i32 glyphHeight = static_cast<i32>(fontSize_ * 1.5f);

    i32 atlasX, atlasY;
    if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
        rebuildAtlasTexture();
        if (!findAtlasSpace(glyphWidth, glyphHeight, atlasX, atlasY)) {
            return nullptr;
        }
    }

    f32 advance = EM_ASM_DOUBLE({
        var canvasData = Module._systemFontCanvases[0];
        if (!canvasData) return $4;

        var ctx = canvasData.ctx;
        var canvas = canvasData.canvas;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var char = String.fromCodePoint($0);
        ctx.fillText(char, 1, 1);

        var metrics = ctx.measureText(char);
        return metrics.width;
    }, codepoint, atlasX, atlasY, glyphWidth, fontSize_);

    glyph.width = static_cast<f32>(glyphWidth);
    glyph.height = static_cast<f32>(glyphHeight);
    glyph.bearingX = 0;
    glyph.bearingY = ascent_;
    glyph.advance = static_cast<f32>(advance);
    glyph.u0 = static_cast<f32>(atlasX) / atlasWidth_;
    glyph.v0 = static_cast<f32>(atlasY) / atlasHeight_;
    glyph.u1 = static_cast<f32>(atlasX + glyphWidth) / atlasWidth_;
    glyph.v1 = static_cast<f32>(atlasY + glyphHeight) / atlasHeight_;
#endif

    glyphs_[codepoint] = glyph;
    lruList_.push_front(codepoint);
    lruMap_[codepoint] = lruList_.begin();

#ifndef ES_PLATFORM_WEB
    glBindTexture(GL_TEXTURE_2D, atlasTextureId_);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, atlasWidth_, atlasHeight_,
                    GL_RED, GL_UNSIGNED_BYTE, atlasData_.data());
#endif

    return &glyphs_[codepoint];
}

// =============================================================================
// Atlas Management
// =============================================================================

bool SystemFont::findAtlasSpace(i32 width, i32 height, i32& outX, i32& outY) {
    if (packX_ + width > atlasWidth_) {
        packX_ = 1;
        packY_ += rowHeight_ + 1;
        rowHeight_ = 0;
    }

    if (packY_ + height > atlasHeight_) {
        return false;
    }

    outX = packX_;
    outY = packY_;
    packX_ += width + 1;
    rowHeight_ = std::max(rowHeight_, height);
    return true;
}

void SystemFont::rebuildAtlasTexture() {
    glyphs_.clear();
    lruList_.clear();
    lruMap_.clear();
    std::fill(atlasData_.begin(), atlasData_.end(), 0);
    packX_ = 1;
    packY_ = 1;
    rowHeight_ = 0;
}

void SystemFont::evictLRU() {
    if (lruList_.empty()) return;

    u32 oldest = lruList_.back();
    lruList_.pop_back();
    lruMap_.erase(oldest);
    glyphs_.erase(oldest);
}

void SystemFont::clearCache() {
    rebuildAtlasTexture();
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 SystemFont::measureText(const std::string& text, f32 fontSize) {
    f32 scale = fontSize / fontSize_;
    f32 width = 0.0f;
    f32 maxHeight = lineHeight_ * scale;

    const char* ptr = text.c_str();
    const char* end = ptr + text.size();

    while (ptr < end) {
        u32 codepoint = static_cast<u8>(*ptr);
        i32 len = 1;

        if ((codepoint & 0x80) == 0) {
            len = 1;
        } else if ((codepoint & 0xE0) == 0xC0) {
            len = 2;
            codepoint = codepoint & 0x1F;
        } else if ((codepoint & 0xF0) == 0xE0) {
            len = 3;
            codepoint = codepoint & 0x0F;
        } else if ((codepoint & 0xF8) == 0xF0) {
            len = 4;
            codepoint = codepoint & 0x07;
        }

        for (i32 i = 1; i < len && ptr + i < end; ++i) {
            codepoint = (codepoint << 6) | (static_cast<u8>(ptr[i]) & 0x3F);
        }
        ptr += len;

        if (codepoint == '\n') {
            maxHeight += lineHeight_ * scale;
            continue;
        }

        const GlyphInfo* glyph = getGlyph(codepoint);
        if (glyph) {
            width += glyph->advance * scale;
        }
    }

    return {width, maxHeight};
}

f32 SystemFont::getCharWidth(u32 codepoint, f32 fontSize) {
    f32 scale = fontSize / fontSize_;
    const GlyphInfo* glyph = getGlyph(codepoint);
    return glyph ? glyph->advance * scale : 0.0f;
}

// =============================================================================
// Preloading
// =============================================================================

void SystemFont::preloadASCII() {
    for (u32 c = 32; c < 127; ++c) {
        getGlyph(c);
    }
}

void SystemFont::preloadChars(const std::string& chars) {
    const char* ptr = chars.c_str();
    const char* end = ptr + chars.size();

    while (ptr < end) {
        u32 codepoint = static_cast<u8>(*ptr);
        i32 len = 1;

        if ((codepoint & 0x80) == 0) {
            len = 1;
        } else if ((codepoint & 0xE0) == 0xC0) {
            len = 2;
            codepoint = codepoint & 0x1F;
        } else if ((codepoint & 0xF0) == 0xE0) {
            len = 3;
            codepoint = codepoint & 0x0F;
        } else if ((codepoint & 0xF8) == 0xF0) {
            len = 4;
            codepoint = codepoint & 0x07;
        }

        for (i32 i = 1; i < len && ptr + i < end; ++i) {
            codepoint = (codepoint << 6) | (static_cast<u8>(ptr[i]) & 0x3F);
        }
        ptr += len;

        getGlyph(codepoint);
    }
}

}  // namespace esengine::ui
