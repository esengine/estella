/**
 * @file    ClickablePanel.hpp
 * @brief   Clickable panel widget
 * @details A panel that can respond to mouse click events.
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

#include "Panel.hpp"
#include "../../events/Signal.hpp"

namespace esengine::ui {

// =============================================================================
// ClickablePanel Class
// =============================================================================

/**
 * @brief Panel that responds to mouse clicks
 *
 * @details Extends Panel with click handling capabilities and an onClick signal.
 */
class ClickablePanel : public Panel {
public:
    explicit ClickablePanel(const WidgetId& id);

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Signal emitted when the panel is clicked */
    Signal<void(const MouseButtonEvent&)> onClick;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    bool onMouseDown(const MouseButtonEvent& event) override;
    Widget* hitTest(f32 x, f32 y) override;
};

}  // namespace esengine::ui
