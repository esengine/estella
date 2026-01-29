/**
 * @file    Button.hpp
 * @brief   Clickable button widget
 * @details A button widget that responds to mouse/touch input and
 *          triggers an onClick callback.
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
#include "../../events/Signal.hpp"

#include <functional>
#include <string>

namespace esengine::ui {

// =============================================================================
// Button Style
// =============================================================================

/**
 * @brief Visual style variant for buttons
 */
enum class ButtonStyle : u8 {
    Default,
    Primary,
    Secondary,
    Text,
    Ghost
};

// =============================================================================
// Button Class
// =============================================================================

/**
 * @brief Clickable button widget
 *
 * @details Renders a button with text and responds to mouse/touch
 *          interactions. Emits a signal when clicked.
 *
 * @code
 * auto button = makeUnique<Button>(WidgetId("submit"), "Submit");
 * button->onClick.connect([]() {
 *     ES_LOG_INFO("Button clicked!");
 * });
 * @endcode
 */
class Button : public Widget {
public:
    /**
     * @brief Creates a button with text
     * @param id Widget identifier
     * @param text Button label text
     */
    Button(const WidgetId& id, const std::string& text = "");

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Signal emitted when the button is clicked */
    Signal<void()> onClick;

    // =========================================================================
    // Text
    // =========================================================================

    /** @brief Sets the button label text */
    void setText(const std::string& text);

    /** @brief Gets the button label text */
    const std::string& getText() const { return text_; }

    // =========================================================================
    // Appearance
    // =========================================================================

    /** @brief Sets the button style variant */
    void setButtonStyle(ButtonStyle style) { buttonStyle_ = style; }

    /** @brief Gets the button style variant */
    ButtonStyle getButtonStyle() const { return buttonStyle_; }

    /** @brief Sets the font size in pixels */
    void setFontSize(f32 size) { fontSize_ = size; invalidateLayout(); }

    /** @brief Gets the font size */
    f32 getFontSize() const { return fontSize_; }

    /** @brief Sets the font name */
    void setFontName(const std::string& name) { fontName_ = name; }

    /** @brief Gets the font name */
    const std::string& getFontName() const { return fontName_; }

    /** @brief Sets the corner radii */
    void setCornerRadii(const CornerRadii& radii) { cornerRadii_ = radii; }

    /** @brief Gets the corner radii */
    const CornerRadii& getCornerRadii() const { return cornerRadii_; }

    /** @brief Sets the text horizontal alignment */
    void setTextAlignment(HAlign align) { textAlign_ = align; }

    /** @brief Gets the text horizontal alignment */
    HAlign getTextAlignment() const { return textAlign_; }

    /** @brief Sets custom background color (overrides style) */
    void setBackgroundColor(const glm::vec4& color) {
        customBgColor_ = color;
        useCustomColors_ = true;
    }

    /** @brief Sets custom hover color (overrides style) */
    void setHoverColor(const glm::vec4& color) {
        customHoverColor_ = color;
        useCustomColors_ = true;
    }

    /** @brief Sets custom pressed color (overrides style) */
    void setPressedColor(const glm::vec4& color) {
        customPressedColor_ = color;
        useCustomColors_ = true;
    }

    /** @brief Sets custom text color (overrides style) */
    void setTextColor(const glm::vec4& color) {
        customTextColor_ = color;
        useCustomColors_ = true;
    }

    /** @brief Clears custom colors and uses theme styles */
    void clearCustomColors() { useCustomColors_ = false; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    bool isFocusable() const override { return true; }

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;

    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onMouseEnter(const MouseEnterEvent& event) override;
    bool onMouseLeave(const MouseLeaveEvent& event) override;
    bool onKeyDown(const KeyEvent& event) override;

protected:
    void onStateChanged() override;

private:
    std::string text_;
    std::string fontName_;
    f32 fontSize_ = 14.0f;
    ButtonStyle buttonStyle_ = ButtonStyle::Default;
    CornerRadii cornerRadii_;
    HAlign textAlign_ = HAlign::Center;

    bool useCustomColors_ = false;
    glm::vec4 customBgColor_{0.0f};
    glm::vec4 customHoverColor_{0.0f};
    glm::vec4 customPressedColor_{0.0f};
    glm::vec4 customTextColor_{1.0f};

    glm::vec2 cachedTextSize_{0.0f};
    bool textSizeDirty_ = true;
};

}  // namespace esengine::ui
