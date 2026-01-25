/**
 * @file    DockTypes.hpp
 * @brief   Core types and enumerations for the docking system
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

#include "../../core/Types.hpp"

#include <limits>

namespace esengine::ui {

// =============================================================================
// Type Aliases
// =============================================================================

/** @brief Unique identifier for dock nodes */
using DockNodeId = u32;

/** @brief Invalid dock node ID constant */
constexpr DockNodeId INVALID_DOCK_NODE_ID = 0;

/** @brief Unique identifier for dock panels */
using DockPanelId = u32;

/** @brief Invalid dock panel ID constant */
constexpr DockPanelId INVALID_DOCK_PANEL_ID = 0;

// =============================================================================
// Enumerations
// =============================================================================

/**
 * @brief Direction for splitting dock nodes
 */
enum class DockSplitDirection : u8 {
    Horizontal,  ///< Left | Right split
    Vertical     ///< Top / Bottom split
};

/**
 * @brief Type of node in the dock tree
 */
enum class DockNodeType : u8 {
    Split,  ///< Node with two children divided by a splitter
    Tabs    ///< Node with one or more panels in tabs
};

/**
 * @brief Drop zone positions for drag-and-drop docking
 */
enum class DockDropZone : u8 {
    None,    ///< No valid drop zone
    Left,    ///< Dock to the left edge
    Right,   ///< Dock to the right edge
    Top,     ///< Dock to the top edge
    Bottom,  ///< Dock to the bottom edge
    Center,  ///< Tab into existing container
    Root     ///< Dock to window edge (root level)
};

/**
 * @brief State of a dock tab
 */
enum class DockTabState : u8 {
    Normal,   ///< Default state
    Hovered,  ///< Mouse hovering over tab
    Active,   ///< Currently selected tab
    Dragging  ///< Tab is being dragged
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * @brief Get the opposite split direction
 */
inline constexpr DockSplitDirection oppositeSplitDirection(DockSplitDirection dir) {
    return dir == DockSplitDirection::Horizontal
               ? DockSplitDirection::Vertical
               : DockSplitDirection::Horizontal;
}

/**
 * @brief Check if a drop zone creates a split
 */
inline constexpr bool isEdgeDropZone(DockDropZone zone) {
    return zone == DockDropZone::Left || zone == DockDropZone::Right ||
           zone == DockDropZone::Top || zone == DockDropZone::Bottom;
}

/**
 * @brief Get the split direction for an edge drop zone
 */
inline constexpr DockSplitDirection dropZoneToSplitDirection(DockDropZone zone) {
    return (zone == DockDropZone::Left || zone == DockDropZone::Right)
               ? DockSplitDirection::Horizontal
               : DockSplitDirection::Vertical;
}

/**
 * @brief Check if the drop zone inserts before (first child) or after (second child)
 */
inline constexpr bool dropZoneIsFirst(DockDropZone zone) {
    return zone == DockDropZone::Left || zone == DockDropZone::Top;
}

}  // namespace esengine::ui
