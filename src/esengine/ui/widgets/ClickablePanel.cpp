/**
 * @file    ClickablePanel.cpp
 * @brief   ClickablePanel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ClickablePanel.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

ClickablePanel::ClickablePanel(const WidgetId& id)
    : Panel(id) {
}

// =============================================================================
// Event Handling
// =============================================================================

bool ClickablePanel::onMouseDown(const MouseButtonEvent& event) {
    onClick.publish(event);
    return true;
}

Widget* ClickablePanel::hitTest(f32 x, f32 y) {
    if (!getState().visible || getState().disabled) {
        return nullptr;
    }

    if (!containsPoint(x, y)) {
        return nullptr;
    }

    for (auto it = getChildren().rbegin(); it != getChildren().rend(); ++it) {
        if (auto* hit = (*it)->hitTest(x, y)) {
            if (hit->isFocusable()) {
                return hit;
            }
        }
    }

    return this;
}

}  // namespace esengine::ui
