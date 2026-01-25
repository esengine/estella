/**
 * @file    Label.hpp
 * @brief   Text label widget
 * @details A simple widget for displaying static text.
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

#include "Widget.hpp"
#include "../layout/SizeValue.hpp"

#include <string>

namespace esengine::ui {

// =============================================================================
// Label Class
// =============================================================================

/**
 * @brief Widget for displaying text
 *
 * @details Renders a single line or multi-line text with configurable
 *          font, size, color, and alignment.
 *
 * @code
 * auto label = makeUnique<Label>(WidgetId("title"), "Hello World");
 * label->setFontSize(18.0f);
 * label->setColor({1.0f, 1.0f, 0.0f, 1.0f});
 * @endcode
 */
class Label : public Widget {
public:
    /**
     * @brief Creates a label with text
     * @param id Widget identifier
     * @param text Initial text to display
     */
    Label(const WidgetId& id, const std::string& text = "");

    // =========================================================================
    // Text
    // =========================================================================

    /** @brief Sets the displayed text */
    void setText(const std::string& text);

    /** @brief Gets the displayed text */
    const std::string& getText() const { return text_; }

    // =========================================================================
    // Font
    // =========================================================================

    /** @brief Sets the font name (must be loaded in UIContext) */
    void setFontName(const std::string& name) { fontName_ = name; }

    /** @brief Gets the font name */
    const std::string& getFontName() const { return fontName_; }

    /** @brief Sets the font size in pixels */
    void setFontSize(f32 size) { fontSize_ = size; invalidateLayout(); }

    /** @brief Gets the font size */
    f32 getFontSize() const { return fontSize_; }

    // =========================================================================
    // Appearance
    // =========================================================================

    /** @brief Sets a custom text color (overrides theme) */
    void setColor(const glm::vec4& color);

    /** @brief Clears the custom color (use theme) */
    void clearColor() { customColor_ = false; }

    // =========================================================================
    // Alignment
    // =========================================================================

    /** @brief Sets horizontal text alignment */
    void setHAlign(HAlign align) { hAlign_ = align; }

    /** @brief Gets horizontal text alignment */
    HAlign getHAlign() const { return hAlign_; }

    /** @brief Sets vertical text alignment */
    void setVAlign(VAlign align) { vAlign_ = align; }

    /** @brief Gets vertical text alignment */
    VAlign getVAlign() const { return vAlign_; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;

private:
    std::string text_;
    std::string fontName_;
    f32 fontSize_ = 14.0f;

    bool customColor_ = false;
    glm::vec4 color_{1.0f};

    HAlign hAlign_ = HAlign::Left;
    VAlign vAlign_ = VAlign::Center;

    glm::vec2 cachedTextSize_{0.0f};
    bool textSizeDirty_ = true;
};

}  // namespace esengine::ui
