/**
 * @file    Label.cpp
 * @brief   Label widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Label.hpp"
#include "../UIContext.hpp"
#include "../font/Font.hpp"
#include "../rendering/UIBatchRenderer.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Label::Label(const WidgetId& id, const std::string& text)
    : Widget(id), text_(text) {}

// =============================================================================
// Text
// =============================================================================

void Label::setText(const std::string& text) {
    if (text_ != text) {
        text_ = text;
        textSizeDirty_ = true;
        invalidateLayout();
    }
}

// =============================================================================
// Appearance
// =============================================================================

void Label::setColor(const glm::vec4& color) {
    color_ = color;
    customColor_ = true;
}

// =============================================================================
// Measurement
// =============================================================================

glm::vec2 Label::measure(f32 availableWidth, f32 availableHeight) {
    if (!getContext()) {
        return Widget::measure(availableWidth, availableHeight);
    }

    Font* font = fontName_.empty() ? getContext()->getDefaultFont()
                                   : getContext()->getFont(fontName_);

    if (font && textSizeDirty_) {
        cachedTextSize_ = font->measureText(text_, fontSize_);
        textSizeDirty_ = false;
    }

    f32 contentWidth = cachedTextSize_.x + getPadding().totalHorizontal();
    f32 contentHeight = cachedTextSize_.y + getPadding().totalVertical();

    f32 width = getWidth().resolve(availableWidth, contentWidth);
    f32 height = getHeight().resolve(availableHeight, contentHeight);

    width = getConstraints().constrainWidth(width);
    height = getConstraints().constrainHeight(height);

    return {width, height};
}

// =============================================================================
// Rendering
// =============================================================================

void Label::render(UIBatchRenderer& renderer) {
    if (text_.empty()) return;

    UIContext* ctx = getContext();
    if (!ctx) return;

    WidgetStyle style = ctx->getTheme().getLabelStyle();
    glm::vec4 textColor = customColor_ ? color_ : style.getTextColor(getState());
    Rect contentBounds = getContentBounds();

    Font* font = fontName_.empty() ? ctx->getDefaultFont() : ctx->getFont(fontName_);
    if (font) {
        renderer.drawTextInBounds(text_, contentBounds, *font, fontSize_, textColor, hAlign_, vAlign_);
    }
}

}  // namespace esengine::ui
