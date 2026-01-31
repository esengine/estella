/**
 * @file    TextMeasureHelper.cpp
 * @brief   TextMeasureHelper implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "TextMeasureHelper.hpp"
#include "../UIContext.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

#include "../font/SystemFont.hpp"

namespace esengine::ui {

// =============================================================================
// Font Resolution
// =============================================================================

#if ES_FEATURE_SDF_FONT
MSDFFont* TextMeasureHelper::resolveFont(UIContext* ctx, const std::string& fontName,
                                          bool useIconFont) {
    if (!ctx) return nullptr;

    if (!fontName.empty()) {
        return ctx->getMSDFFont(fontName);
    }

    if (useIconFont) {
        return ctx->getIconMSDFFont();
    }

    return ctx->getDefaultMSDFFont();
}
#endif

#if ES_FEATURE_BITMAP_FONT
BitmapFont* TextMeasureHelper::resolveBitmapFont(UIContext* ctx, const std::string& fontName) {
    if (!ctx) return nullptr;

    if (!fontName.empty()) {
        return ctx->getBitmapFont(fontName);
    }

    return ctx->getDefaultBitmapFont();
}
#endif

// =============================================================================
// Icon Detection
// =============================================================================

bool TextMeasureHelper::isIconText(const std::string& text) {
    if (text.empty()) return false;

    u8 firstByte = static_cast<u8>(text[0]);
    if ((firstByte & 0xF0) == 0xE0 && text.size() >= 3) {
        u32 codepoint = ((firstByte & 0x0F) << 12) |
                       ((static_cast<u8>(text[1]) & 0x3F) << 6) |
                       (static_cast<u8>(text[2]) & 0x3F);
        return (codepoint >= 0xE000 && codepoint <= 0xF8FF);
    }
    return false;
}

// =============================================================================
// Text Measurement
// =============================================================================

glm::vec2 TextMeasureHelper::measureText(UIContext* ctx, const std::string& text, f32 fontSize,
                                          const std::string& fontName, bool useIconFont) {
    if (!ctx || text.empty()) return {0.0f, 0.0f};

#if ES_FEATURE_SDF_FONT
    bool isIcon = useIconFont || (fontName.empty() && isIconText(text));
    MSDFFont* font = resolveFont(ctx, fontName, isIcon);
    if (font) {
        return font->measureText(text, fontSize);
    }
#elif ES_FEATURE_BITMAP_FONT
    BitmapFont* font = resolveBitmapFont(ctx, fontName);
    if (font) {
        return font->measureText(text, fontSize);
    }
#else
    bool isIcon = useIconFont || (fontName.empty() && isIconText(text));
    SystemFont* font = nullptr;
    if (!fontName.empty()) {
        font = ctx->getSystemFont(fontName);
    } else if (isIcon) {
        font = ctx->getIconSystemFont();
    } else {
        font = ctx->getDefaultSystemFont();
    }
    if (font) {
        return font->measureText(text, fontSize);
    }
#endif

    return {0.0f, 0.0f};
}

glm::vec2 TextMeasureHelper::measureTextCached(UIContext* ctx, const std::string& text,
                                                f32 fontSize, MeasureCache& cache,
                                                const std::string& fontName, bool useIconFont) {
    if (cache.isValid(text, fontSize)) {
        return cache.cachedSize;
    }

    glm::vec2 size = measureText(ctx, text, fontSize, fontName, useIconFont);
    cache.update(text, fontSize, size);
    return size;
}

}  // namespace esengine::ui
