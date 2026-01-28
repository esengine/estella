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
#include "../rendering/UIBatchRenderer.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

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

    if (textSizeDirty_) {
#if ES_FEATURE_SDF_FONT
        MSDFFont* font = fontName_.empty() ? ctx->getDefaultMSDFFont() : ctx->getMSDFFont(fontName_);
        if (font) {
            cachedTextSize_ = font->measureText(text_, fontSize_);
            textSizeDirty_ = false;
        }
#elif ES_FEATURE_BITMAP_FONT
        BitmapFont* font = fontName_.empty() ? ctx->getDefaultBitmapFont() : ctx->getBitmapFont(fontName_);
        if (font) {
            cachedTextSize_ = font->measureText(text_, fontSize_);
            textSizeDirty_ = false;
        }
#endif
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

    bool drawBackground = true;
    if (buttonStyle_ == ButtonStyle::Text) {
        drawBackground = false;
    } else if (buttonStyle_ == ButtonStyle::Ghost) {
        drawBackground = state.hovered || state.pressed;
        if (drawBackground) {
            bgColor = ctx->getTheme().colors.buttonHover;
        }
    }

    if (drawBackground) {
        if (radii.isZero()) {
            renderer.drawRect(bounds, bgColor);
        } else {
            renderer.drawRoundedRect(bounds, bgColor, radii);
        }
    }

    if (state.focused && buttonStyle_ != ButtonStyle::Text && buttonStyle_ != ButtonStyle::Ghost) {
        glm::vec4 focusColor = ctx->getTheme().colors.accent;
        focusColor.a = 0.3f;
        renderer.drawRoundedRectOutline(bounds, focusColor, radii, 2.0f);
    }

    if (!text_.empty()) {
        glm::vec4 textColor = style.getTextColor(state);
        Rect textBounds = style.padding.shrink(bounds);

#if ES_FEATURE_SDF_FONT
        MSDFFont* font = fontName_.empty() ? ctx->getDefaultMSDFFont() : ctx->getMSDFFont(fontName_);
        if (font) {
            renderer.drawTextInBounds(text_, textBounds, *font, fontSize_, textColor,
                                      textAlign_, VAlign::Center);
        }
#elif ES_FEATURE_BITMAP_FONT
        BitmapFont* font = fontName_.empty() ? ctx->getDefaultBitmapFont() : ctx->getBitmapFont(fontName_);
        if (font) {
            renderer.drawTextInBounds(text_, textBounds, *font, fontSize_, textColor,
                                      textAlign_, VAlign::Center);
        }
#endif
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
