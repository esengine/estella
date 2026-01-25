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

    if (drawBorder_ && style.borderWidth > 0.0f) {
        glm::vec4 brColor = customBorder_ ? borderColor_ : style.getBorderColor(getState());

        CornerRadii radii = cornerRadii_.isZero() ? style.cornerRadii : cornerRadii_;

        renderer.drawRoundedRectOutline(bounds, brColor, radii, style.borderWidth);
    }
}

}  // namespace esengine::ui
