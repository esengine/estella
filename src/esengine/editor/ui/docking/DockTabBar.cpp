/**
 * @file    DockTabBar.cpp
 * @brief   DockTabBar implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockTabBar.hpp"
#include "DockArea.hpp"
#include "DockNode.hpp"
#include "DockPanel.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../../ui/font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../../../ui/font/BitmapFont.hpp"
#endif

#include "../../../ui/font/SystemFont.hpp"

#include <cmath>

namespace esengine::ui {

// =============================================================================
// Constructor / Destructor
// =============================================================================

DockTabBar::DockTabBar(const WidgetId& id, DockNode* ownerNode)
    : Widget(id)
    , ownerNode_(ownerNode) {}

DockTabBar::~DockTabBar() = default;

// =============================================================================
// Tab Data
// =============================================================================

void DockTabBar::updateTabs() {
    tabs_.clear();

    if (!ownerNode_ || !ownerNode_->isTabs()) return;

    i32 activeIndex = ownerNode_->getActiveTabIndex();
    const auto& panels = ownerNode_->getPanels();

    for (usize i = 0; i < panels.size(); ++i) {
        const auto& panel = panels[i];
        if (!panel) continue;

        DockTabInfo tab;
        tab.panelId = panel->getPanelId();
        tab.title = panel->getTitle();
        tab.iconTextureId = panel->getIconTextureId();
        tab.closable = panel->isClosable();
        tab.active = (static_cast<i32>(i) == activeIndex);
        tab.hovered = (static_cast<i32>(i) == hoveredTabIndex_);
        tab.closeHovered = (static_cast<i32>(i) == hoveredCloseIndex_);

        tabs_.push_back(tab);
    }

    layoutTabs();
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 DockTabBar::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;
    return {availableWidth, tabHeight_};
}

void DockTabBar::layoutTabs() {
    if (tabs_.empty()) return;

    const Rect& bounds = getBounds();
    f32 totalWidth = bounds.width - tabPadding_ * 2.0f;
    f32 tabWidth = totalWidth / static_cast<f32>(tabs_.size()) - tabSpacing_;
    tabWidth = std::clamp(tabWidth, tabMinWidth_, tabMaxWidth_);

    f32 x = bounds.x + tabPadding_;

    for (auto& tab : tabs_) {
        tab.bounds = Rect{
            x,
            bounds.y,
            tabWidth,
            tabHeight_
        };

        if (tab.closable) {
            f32 closeX = x + tabWidth - closeButtonSize_ - 4.0f;
            f32 closeY = bounds.y + (tabHeight_ - closeButtonSize_) * 0.5f;
            tab.closeButtonBounds = Rect{
                closeX,
                closeY,
                closeButtonSize_,
                closeButtonSize_
            };
        }

        x += tabWidth + tabSpacing_;
    }
}

// =============================================================================
// Rendering
// =============================================================================

void DockTabBar::render(UIBatchRenderer& renderer) {
    UIContext* ctx = getContext();
    if (!ctx) return;

    updateTabs();

    const Rect& bounds = getBounds();
    const Theme& theme = ctx->getTheme();

    renderer.drawRect(bounds, theme.colors.backgroundDark);

    for (usize i = 0; i < tabs_.size(); ++i) {
        renderTab(renderer, tabs_[i], i);
    }
}

void DockTabBar::renderTab(UIBatchRenderer& renderer, const DockTabInfo& tab, usize /*index*/) {
    UIContext* ctx = getContext();
    if (!ctx) return;

    const Theme& theme = ctx->getTheme();

    glm::vec4 bgColor;
    if (tab.active) {
        bgColor = theme.colors.backgroundLight;
    } else if (tab.hovered) {
        bgColor = theme.colors.backgroundMedium;
    } else {
        bgColor = theme.colors.backgroundDark;
    }

    renderer.drawRect(tab.bounds, bgColor);

    if (tab.active) {
        Rect indicator{
            tab.bounds.x,
            tab.bounds.y + tab.bounds.height - 2.0f,
            tab.bounds.width,
            2.0f
        };
        renderer.drawRect(indicator, theme.colors.accent);
    }

    f32 textX = tab.bounds.x + tabPadding_;
    f32 maxTextWidth = tab.bounds.width - tabPadding_ * 2.0f;

    if (tab.closable) {
        maxTextWidth -= closeButtonSize_ + 4.0f;
    }

    glm::vec4 textColor = tab.active ? theme.colors.textPrimary : theme.colors.textSecondary;

    Rect textBounds{
        textX,
        tab.bounds.y,
        maxTextWidth,
        tab.bounds.height
    };

#if ES_FEATURE_SDF_FONT
    MSDFFont* font = ctx->getDefaultMSDFFont();
    if (font) {
        renderer.drawTextInBounds(tab.title, textBounds, *font,
                                   theme.typography.fontSizeSmall, textColor,
                                   HAlign::Left, VAlign::Center);
    }
#elif ES_FEATURE_BITMAP_FONT
    BitmapFont* font = ctx->getDefaultBitmapFont();
    if (font) {
        renderer.drawTextInBounds(tab.title, textBounds, *font,
                                   theme.typography.fontSizeSmall, textColor,
                                   HAlign::Left, VAlign::Center);
    }
#else
    SystemFont* font = ctx->getDefaultSystemFont();
    if (font) {
        renderer.drawTextInBounds(tab.title, textBounds, *font,
                                   theme.typography.fontSizeSmall, textColor,
                                   HAlign::Left, VAlign::Center);
    }
#endif

    if (tab.closable) {
        glm::vec4 closeColor = tab.closeHovered
                                   ? theme.colors.error
                                   : theme.colors.textSecondary;

        f32 cx = tab.closeButtonBounds.x + tab.closeButtonBounds.width * 0.5f;
        f32 cy = tab.closeButtonBounds.y + tab.closeButtonBounds.height * 0.5f;
        f32 size = closeButtonSize_ * 0.3f;

        renderer.drawLine({cx - size, cy - size}, {cx + size, cy + size}, closeColor, 1.5f);
        renderer.drawLine({cx - size, cy + size}, {cx + size, cy - size}, closeColor, 1.5f);
    }
}

// =============================================================================
// Hit Testing
// =============================================================================

i32 DockTabBar::hitTestTab(f32 x, f32 y) const {
    for (usize i = 0; i < tabs_.size(); ++i) {
        if (tabs_[i].bounds.contains({x, y})) {
            return static_cast<i32>(i);
        }
    }
    return -1;
}

i32 DockTabBar::hitTestCloseButton(f32 x, f32 y) const {
    for (usize i = 0; i < tabs_.size(); ++i) {
        if (tabs_[i].closable && tabs_[i].closeButtonBounds.contains({x, y})) {
            return static_cast<i32>(i);
        }
    }
    return -1;
}

void DockTabBar::updateHoverState(f32 x, f32 y) {
    i32 oldHoveredTab = hoveredTabIndex_;
    i32 oldHoveredClose = hoveredCloseIndex_;

    hoveredCloseIndex_ = hitTestCloseButton(x, y);
    hoveredTabIndex_ = hitTestTab(x, y);

    if (hoveredCloseIndex_ != oldHoveredClose || hoveredTabIndex_ != oldHoveredTab) {
        for (usize i = 0; i < tabs_.size(); ++i) {
            tabs_[i].hovered = (static_cast<i32>(i) == hoveredTabIndex_);
            tabs_[i].closeHovered = (static_cast<i32>(i) == hoveredCloseIndex_);
        }
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool DockTabBar::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) return false;

    i32 closeIndex = hitTestCloseButton(event.x, event.y);
    if (closeIndex >= 0) {
        return true;
    }

    i32 tabIndex = hitTestTab(event.x, event.y);
    if (tabIndex >= 0) {
        pressedTabIndex_ = tabIndex;
        pressStartPos_ = {event.x, event.y};
        potentialDrag_ = true;

        if (ownerNode_) {
            ownerNode_->setActiveTabIndex(tabIndex);
        }
        onTabSelected.publish(tabIndex);
        return true;
    }

    return false;
}

bool DockTabBar::onMouseUp(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) return false;

    if (isDragging_) {
        DockArea* area = ownerNode_ ? ownerNode_->getArea() : nullptr;
        if (area) {
            area->onMouseUp(event);
        }
        isDragging_ = false;
        pressedTabIndex_ = -1;
        return true;
    }

    i32 closeIndex = hitTestCloseButton(event.x, event.y);
    if (closeIndex >= 0 && closeIndex < static_cast<i32>(tabs_.size())) {
        onTabCloseRequested.publish(tabs_[static_cast<usize>(closeIndex)].panelId);
        return true;
    }

    potentialDrag_ = false;
    isDragging_ = false;
    pressedTabIndex_ = -1;

    return false;
}

bool DockTabBar::onMouseMove(const MouseMoveEvent& event) {
    updateHoverState(event.x, event.y);

    if (isDragging_) {
        DockArea* area = ownerNode_ ? ownerNode_->getArea() : nullptr;
        if (area) {
            area->onMouseMove(event);
        }
        return true;
    }

    if (potentialDrag_ && pressedTabIndex_ >= 0) {
        f32 dx = event.x - pressStartPos_.x;
        f32 dy = event.y - pressStartPos_.y;
        f32 distance = std::sqrt(dx * dx + dy * dy);

        if (distance > dragThreshold_) {
            isDragging_ = true;
            potentialDrag_ = false;

            if (pressedTabIndex_ < static_cast<i32>(tabs_.size())) {
                onTabDragStart.publish(
                    tabs_[static_cast<usize>(pressedTabIndex_)].panelId,
                    {event.x, event.y}
                );

                DockArea* area = ownerNode_ ? ownerNode_->getArea() : nullptr;
                if (area) {
                    area->onMouseMove(event);
                }
            }
        }
    }

    return false;
}

bool DockTabBar::onMouseEnter(const MouseEnterEvent& event) {
    updateHoverState(event.x, event.y);
    return false;
}

bool DockTabBar::onMouseLeave(const MouseLeaveEvent& event) {
    (void)event;
    hoveredTabIndex_ = -1;
    hoveredCloseIndex_ = -1;

    for (auto& tab : tabs_) {
        tab.hovered = false;
        tab.closeHovered = false;
    }

    return false;
}

}  // namespace esengine::ui
