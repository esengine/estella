/**
 * @file    DockTabBar.hpp
 * @brief   Tab bar widget for dock nodes
 * @details Renders tabs for panels in a Tabs node and handles
 *          tab selection, drag initiation, and close buttons.
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

#include "DockTypes.hpp"
#include "../../../ui/widgets/Widget.hpp"
#include "../../../events/Signal.hpp"

#include <string>
#include <vector>

namespace esengine::ui {

// Forward declarations
class DockNode;

// =============================================================================
// DockTabInfo
// =============================================================================

/**
 * @brief Information about a single tab for rendering
 */
struct DockTabInfo {
    DockPanelId panelId = INVALID_DOCK_PANEL_ID;
    std::string title;
    Rect bounds;
    Rect closeButtonBounds;
    u32 iconTextureId = 0;
    bool closable = true;
    bool hovered = false;
    bool active = false;
    bool closeHovered = false;
};

// =============================================================================
// DockTabBar Class
// =============================================================================

/**
 * @brief Tab bar widget for a dock node with tabs
 *
 * @details Renders tab buttons and handles:
 *          - Tab selection on click
 *          - Close button clicks
 *          - Drag initiation for panel reordering/undocking
 */
class DockTabBar : public Widget {
public:
    /**
     * @brief Constructs a tab bar for a dock node
     * @param id Widget identifier
     * @param ownerNode The Tabs node this bar belongs to
     */
    DockTabBar(const WidgetId& id, DockNode* ownerNode);

    ~DockTabBar() override;

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets the tab height in pixels */
    void setTabHeight(f32 height) { tabHeight_ = height; invalidateLayout(); }

    /** @brief Gets the tab height */
    f32 getTabHeight() const { return tabHeight_; }

    /** @brief Sets the minimum tab width */
    void setTabMinWidth(f32 width) { tabMinWidth_ = width; }

    /** @brief Sets the maximum tab width */
    void setTabMaxWidth(f32 width) { tabMaxWidth_ = width; }

    /** @brief Sets the drag threshold in pixels */
    void setDragThreshold(f32 pixels) { dragThreshold_ = pixels; }

    // =========================================================================
    // Tab Data
    // =========================================================================

    /** @brief Refresh tab info from owner node */
    void updateTabs();

    /** @brief Gets the tab info list */
    const std::vector<DockTabInfo>& getTabs() const { return tabs_; }

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Emitted when a tab is selected (index) */
    Signal<void(i32)> onTabSelected;

    /** @brief Emitted when a tab close is requested (panel ID) */
    Signal<void(DockPanelId)> onTabCloseRequested;

    /** @brief Emitted when tab drag starts (panel ID, position) */
    Signal<void(DockPanelId, glm::vec2)> onTabDragStart;

    /** @brief Emitted when tabs are reordered (from index, to index) */
    Signal<void(i32, i32)> onTabReordered;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;

    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;
    bool onMouseEnter(const MouseEnterEvent& event) override;
    bool onMouseLeave(const MouseLeaveEvent& event) override;

private:
    i32 hitTestTab(f32 x, f32 y) const;
    i32 hitTestCloseButton(f32 x, f32 y) const;
    void layoutTabs();
    void renderTab(UIBatchRenderer& renderer, const DockTabInfo& tab, usize index);
    void updateHoverState(f32 x, f32 y);

    DockNode* ownerNode_;
    std::vector<DockTabInfo> tabs_;

    // Dimensions
    f32 tabHeight_ = 24.0f;
    f32 tabMinWidth_ = 60.0f;
    f32 tabMaxWidth_ = 200.0f;
    f32 tabPadding_ = 8.0f;
    f32 tabSpacing_ = 1.0f;
    f32 closeButtonSize_ = 14.0f;

    // Drag state
    f32 dragThreshold_ = 5.0f;
    bool isDragging_ = false;
    bool potentialDrag_ = false;
    i32 pressedTabIndex_ = -1;
    glm::vec2 pressStartPos_{0.0f};

    // Hover state
    i32 hoveredTabIndex_ = -1;
    i32 hoveredCloseIndex_ = -1;
};

}  // namespace esengine::ui
