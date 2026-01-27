/**
 * @file    StackLayout.cpp
 * @brief   Stack layout implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "StackLayout.hpp"
#include "../widgets/Widget.hpp"

#include <algorithm>

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

StackLayout::StackLayout(StackDirection direction, f32 spacing)
    : direction_(direction), spacing_(spacing) {}

// =============================================================================
// Measure
// =============================================================================

glm::vec2 StackLayout::measure(Widget& container, f32 availableWidth, f32 availableHeight) {
    const auto& children = container.getChildren();

    f32 mainSize = 0.0f;
    f32 crossSize = 0.0f;
    usize visibleCount = 0;

    bool isVertical = (direction_ == StackDirection::Vertical);

    for (const auto& child : children) {
        if (!child->isVisible()) continue;

        f32 childAvailW = isVertical ? availableWidth : (availableWidth - mainSize);
        f32 childAvailH = isVertical ? (availableHeight - mainSize) : availableHeight;

        auto childSize = child->measure(childAvailW, childAvailH);
        const auto& margin = child->getMargin();

        f32 childMainSize = isVertical ? (childSize.y + margin.totalVertical())
                                        : (childSize.x + margin.totalHorizontal());

        f32 childCrossSize = isVertical ? (childSize.x + margin.totalHorizontal())
                                         : (childSize.y + margin.totalVertical());

        mainSize += childMainSize;
        crossSize = (childCrossSize > crossSize) ? childCrossSize : crossSize;
        visibleCount++;
    }

    if (visibleCount > 1) {
        mainSize += spacing_ * static_cast<f32>(visibleCount - 1);
    }

    return isVertical ? glm::vec2{crossSize, mainSize} : glm::vec2{mainSize, crossSize};
}

// =============================================================================
// Layout
// =============================================================================

void StackLayout::layout(Widget& container, const Rect& bounds) {
    const auto& children = container.getChildren();

    if (children.empty()) return;

    bool isVertical = (direction_ == StackDirection::Vertical);

    std::vector<Widget*> visibleChildren;
    std::vector<glm::vec2> childSizes;

    f32 usedMainSize = 0.0f;
    for (const auto& child : children) {
        if (child->isVisible()) {
            visibleChildren.push_back(child.get());

            f32 childAvailW = isVertical ? bounds.width : (bounds.width - usedMainSize);
            f32 childAvailH = isVertical ? (bounds.height - usedMainSize) : bounds.height;
            auto size = child->measure(childAvailW, childAvailH);
            childSizes.push_back(size);

            const auto& margin = child->getMargin();
            f32 childMainSize = isVertical ? (size.y + margin.totalVertical())
                                           : (size.x + margin.totalHorizontal());
            usedMainSize += childMainSize + spacing_;
        }
    }

    if (visibleChildren.empty()) return;

    if (reverse_) {
        std::reverse(visibleChildren.begin(), visibleChildren.end());
        std::reverse(childSizes.begin(), childSizes.end());
    }

    f32 position = isVertical ? bounds.y : bounds.x;

    for (usize i = 0; i < visibleChildren.size(); ++i) {
        Widget* child = visibleChildren[i];
        const auto& childSize = childSizes[i];
        const auto& margin = child->getMargin();

        f32 childMainSize = isVertical ? childSize.y : childSize.x;
        f32 childCrossSize = isVertical ? childSize.x : childSize.y;

        f32 crossStart = isVertical ? bounds.x : bounds.y;
        f32 crossAvail = isVertical ? bounds.width : bounds.height;

        f32 crossOffset = 0.0f;
        f32 crossFinal = childCrossSize;

        if (isVertical) {
            switch (crossHAlign_) {
                case HAlign::Left:
                    crossOffset = margin.left;
                    break;
                case HAlign::Center:
                    crossOffset = (crossAvail - childCrossSize) * 0.5f;
                    break;
                case HAlign::Right:
                    crossOffset = crossAvail - childCrossSize - margin.right;
                    break;
                case HAlign::Stretch:
                    crossOffset = margin.left;
                    crossFinal = crossAvail - margin.totalHorizontal();
                    break;
            }
        } else {
            switch (crossVAlign_) {
                case VAlign::Top:
                    crossOffset = margin.top;
                    break;
                case VAlign::Center:
                    crossOffset = (crossAvail - childCrossSize) * 0.5f;
                    break;
                case VAlign::Bottom:
                    crossOffset = crossAvail - childCrossSize - margin.bottom;
                    break;
                case VAlign::Stretch:
                    crossOffset = margin.top;
                    crossFinal = crossAvail - margin.totalVertical();
                    break;
            }
        }

        f32 mainOffset = isVertical ? margin.top : margin.left;

        Rect childBounds;
        if (isVertical) {
            childBounds = Rect(crossStart + crossOffset, position + mainOffset, crossFinal,
                               childMainSize);
        } else {
            childBounds = Rect(position + mainOffset, crossStart + crossOffset, childMainSize,
                               crossFinal);
        }

        child->layout(childBounds);

        f32 totalMainSize = childMainSize + (isVertical ? margin.totalVertical()
                                                        : margin.totalHorizontal());

        position += totalMainSize + spacing_;
    }
}

}  // namespace esengine::ui
