/**
 * @file    DockLayoutSerializer.hpp
 * @brief   Serialization and deserialization for dock layouts
 * @details Saves and loads dock tree structure to/from JSON format.
 *          Panels are identified by ID; actual panel restoration
 *          is delegated to the application.
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
#include "../../../core/Types.hpp"

#include <string>
#include <vector>
#include <functional>

namespace esengine::ui {

// Forward declarations
class DockArea;
class DockNode;
class DockPanel;

// =============================================================================
// Serialized Data Structures
// =============================================================================

/**
 * @brief Serialized representation of a dock node
 */
struct DockNodeData {
    DockNodeId id = 0;
    DockNodeType type = DockNodeType::Tabs;

    // Split node data
    DockSplitDirection splitDirection = DockSplitDirection::Horizontal;
    f32 splitRatio = 0.5f;

    // Tabs node data
    std::vector<DockPanelId> panelIds;
    i32 activeTabIndex = 0;

    // Children (for split nodes)
    i32 firstChildIndex = -1;
    i32 secondChildIndex = -1;
};

/**
 * @brief Complete serialized dock layout
 */
struct DockLayoutData {
    std::vector<DockNodeData> nodes;
    i32 rootNodeIndex = -1;
    DockNodeId nextNodeId = 1;

    // Metadata
    std::string layoutName;
    u32 version = 1;
};

// =============================================================================
// DockLayoutSerializer Class
// =============================================================================

/**
 * @brief Panel factory callback for deserialization
 * @param panelId The panel ID to create
 * @return Created panel or nullptr if panel cannot be restored
 */
using PanelFactory = std::function<Unique<DockPanel>(DockPanelId)>;

/**
 * @brief Serializes and deserializes dock layouts
 *
 * @details The serializer captures the structural layout (splits, tabs,
 *          ratios) but not panel contents. During deserialization, a
 *          PanelFactory callback is used to create panels by ID.
 *
 * @code
 * // Save layout
 * DockLayoutSerializer serializer;
 * std::string json = serializer.serialize(dockArea);
 * saveToFile("layout.json", json);
 *
 * // Load layout
 * std::string json = loadFromFile("layout.json");
 * serializer.deserialize(dockArea, json, [](DockPanelId id) {
 *     return createPanelById(id);
 * });
 * @endcode
 */
class DockLayoutSerializer {
public:
    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * @brief Serialize dock area to JSON string
     * @param area The dock area to serialize
     * @return JSON string representation
     */
    std::string serialize(const DockArea& area) const;

    /**
     * @brief Serialize dock area to layout data
     * @param area The dock area to serialize
     * @return Layout data structure
     */
    DockLayoutData serializeToData(const DockArea& area) const;

    // =========================================================================
    // Deserialization
    // =========================================================================

    /**
     * @brief Deserialize dock area from JSON string
     * @param area The dock area to populate
     * @param json JSON string to parse
     * @param factory Factory function to create panels
     * @return True if successful
     */
    bool deserialize(DockArea& area, const std::string& json,
                     const PanelFactory& factory) const;

    /**
     * @brief Deserialize dock area from layout data
     * @param area The dock area to populate
     * @param data Layout data structure
     * @param factory Factory function to create panels
     * @return True if successful
     */
    bool deserializeFromData(DockArea& area, const DockLayoutData& data,
                             const PanelFactory& factory) const;

    // =========================================================================
    // JSON Conversion
    // =========================================================================

    /**
     * @brief Convert layout data to JSON string
     * @param data Layout data to convert
     * @return JSON string
     */
    std::string toJson(const DockLayoutData& data) const;

    /**
     * @brief Parse JSON string to layout data
     * @param json JSON string to parse
     * @param outData Output layout data
     * @return True if parsing successful
     */
    bool fromJson(const std::string& json, DockLayoutData& outData) const;

private:
    void serializeNode(const DockNode* node, DockLayoutData& data,
                       std::vector<i32>& nodeIndexMap) const;

    DockNode* deserializeNode(DockArea& area, const DockLayoutData& data,
                              i32 nodeIndex, const PanelFactory& factory) const;
};

}  // namespace esengine::ui
