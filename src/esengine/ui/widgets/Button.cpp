/**
 * @file    Button.cpp
 * @brief   Button widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Button.hpp"
#include "../UIContext.hpp"
#include "../font/SDFFont.hpp"
#include "../rendering/UIBatchRenderer.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Button::Button(const WidgetId& id, const std::string& text)
    : Widget(id), text_(text) {}

// =============================================================================
// Text
// =============================================================================

void Button::setText(const std::string& text) {
    if (text_ != text) {
        text_ = text;
        textSizeDirty_ = true;
        invalidateLayout();
    }
}

// =============================================================================
// State
// =============================================================================

void Button::onStateChanged() {
    Widget::onStateChanged();
}

// =============================================================================
// Measurement
// =============================================================================

glm::vec2 Button::measure(f32 availableWidth, f32 availableHeight) {
    UIContext* ctx = getContext();
    if (!ctx) {
        return Widget::measure(availableWidth, availableHeight);
    }

    WidgetStyle style = (buttonStyle_ == ButtonStyle::Primary)
                            ? ctx->getTheme().getPrimaryButtonStyle()
                            : ctx->getTheme().getButtonStyle();

    // Use regular font for measurement
    SDFFont* font = fontName_.empty() ? ctx->getDefaultFont() : ctx->getFont(fontName_);
    if (font && textSizeDirty_) {
        cachedTextSize_ = font->measureText(text_, fontSize_);
        textSizeDirty_ = false;
    }

    f32 contentWidth = cachedTextSize_.x + style.padding.totalHorizontal() +
                       getPadding().totalHorizontal();
    f32 contentHeight = cachedTextSize_.y + style.padding.totalVertical() +
                        getPadding().totalVertical();

    contentHeight = (contentHeight < 32.0f) ? 32.0f : contentHeight;

    f32 width = getWidth().resolve(availableWidth, contentWidth);
    f32 height = getHeight().resolve(availableHeight, contentHeight);

    width = getConstraints().constrainWidth(width);
    height = getConstraints().constrainHeight(height);

    return {width, height};
}

// =============================================================================
// Rendering
// =============================================================================

void Button::render(UIBatchRenderer& renderer) {
    UIContext* ctx = getContext();
    if (!ctx) return;

    WidgetStyle style = (buttonStyle_ == ButtonStyle::Primary)
                            ? ctx->getTheme().getPrimaryButtonStyle()
                            : ctx->getTheme().getButtonStyle();

    const Rect& bounds = getBounds();
    const WidgetState& state = getState();

    glm::vec4 bgColor = style.getBackgroundColor(state);
    CornerRadii radii = cornerRadii_.isZero() ? style.cornerRadii : cornerRadii_;

    if (buttonStyle_ != ButtonStyle::Text) {
        if (radii.isZero()) {
            renderer.drawRect(bounds, bgColor);
        } else {
            renderer.drawRoundedRect(bounds, bgColor, radii);
        }
    }

    if (state.focused && buttonStyle_ != ButtonStyle::Text) {
        glm::vec4 focusColor = ctx->getTheme().colors.accent;
        focusColor.a = 0.3f;
        renderer.drawRoundedRectOutline(bounds, focusColor, radii, 2.0f);
    }

    if (!text_.empty()) {
        glm::vec4 textColor = style.getTextColor(state);
        Rect textBounds = style.padding.shrink(bounds);

        // Use regular font for now
        SDFFont* font = fontName_.empty() ? ctx->getDefaultFont() : ctx->getFont(fontName_);
        if (font) {
            renderer.drawTextInBounds(text_, textBounds, *font, fontSize_, textColor,
                                      HAlign::Center, VAlign::Center);
        }
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool Button::onMouseDown(const MouseButtonEvent& event) {
    if (event.button == MouseButton::Left && getState().isInteractive()) {
        setState(true, true);
        return true;
    }
    return false;
}

bool Button::onMouseUp(const MouseButtonEvent& event) {
    if (event.button == MouseButton::Left && getState().pressed) {
        bool wasPressed = getState().pressed;
        setState(getState().hovered, false);

        if (wasPressed && containsPoint(event.x, event.y)) {
            onClick.publish();
        }
        return true;
    }
    return false;
}

bool Button::onMouseEnter(const MouseEnterEvent& event) {
    (void)event;
    if (getState().isInteractive()) {
        setState(true, getState().pressed);
        return true;
    }
    return false;
}

bool Button::onMouseLeave(const MouseLeaveEvent& event) {
    (void)event;
    setState(false, getState().pressed);
    return true;
}

bool Button::onKeyDown(const KeyEvent& event) {
    if ((event.key == KeyCode::Space || event.key == KeyCode::Enter) &&
        getState().focused && getState().isInteractive()) {
        onClick.publish();
        return true;
    }
    return false;
}

}  // namespace esengine::ui
