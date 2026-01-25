/**
 * @file    DockEvents.hpp
 * @brief   Event definitions for docking system
 * @details Defines event structures for dock panel operations,
 *          layout changes, and drag-drop actions.
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

#include <glm/glm.hpp>

#include <string>

namespace esengine::ui {

// =============================================================================
// Panel Events
// =============================================================================

/**
 * @brief Emitted when a panel is closed
 */
struct DockPanelClosedEvent {
    DockPanelId panelId;
};

/**
 * @brief Emitted when a panel is activated (selected)
 */
struct DockPanelActivatedEvent {
    DockPanelId panelId;
};

/**
 * @brief Emitted when a panel's title changes
 */
struct DockPanelTitleChangedEvent {
    DockPanelId panelId;
    std::string newTitle;
};

/**
 * @brief Emitted when a panel is added to the dock area
 */
struct DockPanelAddedEvent {
    DockPanelId panelId;
    DockNodeId nodeId;
};

/**
 * @brief Emitted when a panel is removed from the dock area
 */
struct DockPanelRemovedEvent {
    DockPanelId panelId;
};

// =============================================================================
// Layout Events
// =============================================================================

/**
 * @brief Emitted when the dock layout changes
 */
struct DockLayoutChangedEvent {
    // No data - just notification that layout changed
};

/**
 * @brief Emitted when a node is split
 */
struct DockNodeSplitEvent {
    DockNodeId parentId;
    DockNodeId newNodeId;
    DockSplitDirection direction;
};

/**
 * @brief Emitted when nodes are merged
 */
struct DockNodeMergedEvent {
    DockNodeId removedNodeId;
    DockNodeId remainingNodeId;
};

/**
 * @brief Emitted when a splitter ratio changes
 */
struct DockSplitterChangedEvent {
    DockNodeId nodeId;
    f32 oldRatio;
    f32 newRatio;
};

// =============================================================================
// Tab Events
// =============================================================================

/**
 * @brief Emitted when a tab is selected
 */
struct DockTabSelectedEvent {
    DockNodeId nodeId;
    i32 tabIndex;
    DockPanelId panelId;
};

/**
 * @brief Emitted when tab order changes within a node
 */
struct DockTabReorderedEvent {
    DockNodeId nodeId;
    i32 oldIndex;
    i32 newIndex;
};

// =============================================================================
// Drag Events
// =============================================================================

/**
 * @brief Emitted when panel drag starts
 */
struct DockDragStartEvent {
    DockPanelId panelId;
    glm::vec2 startPosition;
};

/**
 * @brief Emitted during panel drag
 */
struct DockDragUpdateEvent {
    DockPanelId panelId;
    glm::vec2 currentPosition;
    DockDropZone hoveredZone;
    DockNodeId targetNodeId;
};

/**
 * @brief Emitted when panel drag ends
 */
struct DockDragEndEvent {
    DockPanelId panelId;
    DockDropZone dropZone;
    DockNodeId targetNodeId;
    bool cancelled;
};

// =============================================================================
// Floating Panel Events (for future floating window support)
// =============================================================================

/**
 * @brief Emitted when a panel becomes floating
 */
struct DockPanelFloatEvent {
    DockPanelId panelId;
    glm::vec2 position;
    glm::vec2 size;
};

/**
 * @brief Emitted when a floating panel is docked
 */
struct DockPanelDockedEvent {
    DockPanelId panelId;
    DockNodeId targetNodeId;
    DockDropZone dropZone;
};

}  // namespace esengine::ui
