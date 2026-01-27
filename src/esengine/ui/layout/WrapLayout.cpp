/**
 * @file    WrapLayout.cpp
 * @brief   Wrap layout implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "WrapLayout.hpp"
#include "../widgets/Widget.hpp"

#include <algorithm>

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

WrapLayout::WrapLayout(f32 hSpacing, f32 vSpacing)
    : hSpacing_(hSpacing), vSpacing_(vSpacing) {}

// =============================================================================
// Measure
// =============================================================================

glm::vec2 WrapLayout::measure(Widget& container, f32 availableWidth, f32 availableHeight) {
    const auto& children = container.getChildren();

    f32 x = 0.0f;
    f32 y = 0.0f;
    f32 rowHeight = 0.0f;
    f32 maxWidth = 0.0f;

    f32 effectiveWidth = availableWidth;
    if (effectiveWidth > 10000.0f || effectiveWidth <= 0.0f) {
        effectiveWidth = 800.0f;
    }

    for (const auto& child : children) {
        if (!child->isVisible()) continue;

        auto childSize = child->measure(effectiveWidth, availableHeight);

        if (x + childSize.x > effectiveWidth && x > 0) {
            x = 0;
            y += rowHeight + vSpacing_;
            rowHeight = 0;
        }

        x += childSize.x + hSpacing_;
        rowHeight = std::max(rowHeight, childSize.y);
        maxWidth = std::max(maxWidth, x - hSpacing_);
    }

    f32 totalHeight = y + rowHeight;
    f32 totalWidth = maxWidth;

    return {totalWidth, totalHeight};
}

// =============================================================================
// Layout
// =============================================================================

void WrapLayout::layout(Widget& container, const Rect& bounds) {
    const auto& children = container.getChildren();

    if (children.empty()) return;

    f32 startX = bounds.x;
    f32 startY = bounds.y;
    f32 contentWidth = bounds.width;

    f32 x = startX;
    f32 y = startY;
    f32 rowHeight = 0.0f;

    for (const auto& child : children) {
        if (!child->isVisible()) continue;

        auto childSize = child->measure(contentWidth, bounds.height);

        if (x - startX + childSize.x > contentWidth && x > startX) {
            x = startX;
            y += rowHeight + vSpacing_;
            rowHeight = 0;
        }

        child->layout(Rect{x, y, childSize.x, childSize.y});

        x += childSize.x + hSpacing_;
        rowHeight = std::max(rowHeight, childSize.y);
    }
}

}  // namespace esengine::ui
