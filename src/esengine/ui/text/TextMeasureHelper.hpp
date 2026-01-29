/**
 * @file    TextMeasureHelper.hpp
 * @brief   Helper utilities for text measurement and font resolution
 * @details Provides centralized text measurement with caching and font
 *          resolution logic for UI widgets.
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

#include <glm/vec2.hpp>

#include <string>

namespace esengine::ui {

class UIContext;

#if ES_FEATURE_SDF_FONT
class MSDFFont;
#endif

#if ES_FEATURE_BITMAP_FONT
class BitmapFont;
#endif

// =============================================================================
// TextMeasureHelper
// =============================================================================

/**
 * @brief Helper for text measurement and font resolution
 */
class TextMeasureHelper {
public:
    /**
     * @brief Resolves the appropriate font from the context
     * @param ctx UI context
     * @param fontName Optional font name (empty for default)
     * @param useIconFont Whether to use icon font
     * @return Font pointer or nullptr if not found
     */
#if ES_FEATURE_SDF_FONT
    static MSDFFont* resolveFont(UIContext* ctx, const std::string& fontName = "",
                                  bool useIconFont = false);
#endif

#if ES_FEATURE_BITMAP_FONT
    static BitmapFont* resolveBitmapFont(UIContext* ctx, const std::string& fontName = "");
#endif

    /**
     * @brief Checks if text starts with an icon codepoint (Private Use Area)
     * @param text Text to check
     * @return true if text starts with an icon character
     */
    static bool isIconText(const std::string& text);

    /**
     * @brief Measures text size using the appropriate font
     * @param ctx UI context
     * @param text Text to measure
     * @param fontSize Font size
     * @param fontName Optional font name
     * @param useIconFont Whether to use icon font
     * @return Measured text size
     */
    static glm::vec2 measureText(UIContext* ctx, const std::string& text, f32 fontSize,
                                  const std::string& fontName = "", bool useIconFont = false);

    /**
     * @brief Cache for text measurement
     */
    struct MeasureCache {
        std::string cachedText;
        f32 cachedFontSize = 0.0f;
        glm::vec2 cachedSize{0.0f};
        bool dirty = true;

        void invalidate() { dirty = true; }

        bool isValid(const std::string& text, f32 fontSize) const {
            return !dirty && cachedText == text && cachedFontSize == fontSize;
        }

        void update(const std::string& text, f32 fontSize, glm::vec2 size) {
            cachedText = text;
            cachedFontSize = fontSize;
            cachedSize = size;
            dirty = false;
        }
    };

    /**
     * @brief Measures text with caching support
     * @param ctx UI context
     * @param text Text to measure
     * @param fontSize Font size
     * @param cache Cache to use/update
     * @param fontName Optional font name
     * @param useIconFont Whether to use icon font
     * @return Measured text size
     */
    static glm::vec2 measureTextCached(UIContext* ctx, const std::string& text, f32 fontSize,
                                        MeasureCache& cache, const std::string& fontName = "",
                                        bool useIconFont = false);
};

}  // namespace esengine::ui
