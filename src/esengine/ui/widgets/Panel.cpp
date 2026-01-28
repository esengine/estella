/**
 * @file    Panel.cpp
 * @brief   Panel widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Panel.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Panel::Panel(const WidgetId& id) : Widget(id) {}

// =============================================================================
// Configuration
// =============================================================================

void Panel::setBackgroundColor(const glm::vec4& color) {
    backgroundColor_ = color;
    customBackground_ = true;
}

void Panel::setBorderColor(const glm::vec4& color) {
    borderColor_ = color;
    customBorder_ = true;
}

void Panel::setBorderWidth(const BorderWidth& width) {
    borderWidth_ = width;
    drawBorder_ = width.hasAny();
}

// =============================================================================
// Rendering
// =============================================================================

void Panel::render(UIBatchRenderer& renderer) {
    if (!drawBackground_ && !drawBorder_) return;

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getPanelStyle();
    }

    const Rect& bounds = getBounds();

    if (drawBackground_) {
        glm::vec4 bgColor = customBackground_ ? backgroundColor_
                                               : style.getBackgroundColor(getState());

        CornerRadii radii = cornerRadii_.isZero() ? style.cornerRadii : cornerRadii_;

        if (radii.isZero()) {
            renderer.drawRect(bounds, bgColor);
        } else {
            renderer.drawRoundedRect(bounds, bgColor, radii);
        }
    }

    if (drawBorder_) {
        glm::vec4 brColor = customBorder_ ? borderColor_ : style.getBorderColor(getState());

        if (borderWidth_.hasAny()) {
            if (borderWidth_.top > 0.0f) {
                Rect topBorder{bounds.x, bounds.y, bounds.width, borderWidth_.top};
                renderer.drawRect(topBorder, brColor);
            }
            if (borderWidth_.right > 0.0f) {
                Rect rightBorder{bounds.x + bounds.width - borderWidth_.right, bounds.y,
                                 borderWidth_.right, bounds.height};
                renderer.drawRect(rightBorder, brColor);
            }
            if (borderWidth_.bottom > 0.0f) {
                Rect bottomBorder{bounds.x, bounds.y + bounds.height - borderWidth_.bottom,
                                  bounds.width, borderWidth_.bottom};
                renderer.drawRect(bottomBorder, brColor);
            }
            if (borderWidth_.left > 0.0f) {
                Rect leftBorder{bounds.x, bounds.y, borderWidth_.left, bounds.height};
                renderer.drawRect(leftBorder, brColor);
            }
        } else if (style.borderWidth > 0.0f) {
            CornerRadii radii = cornerRadii_.isZero() ? style.cornerRadii : cornerRadii_;
            renderer.drawRoundedRectOutline(bounds, brColor, radii, style.borderWidth);
        }
    }
}

}  // namespace esengine::ui
