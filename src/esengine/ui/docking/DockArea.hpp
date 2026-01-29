/**
 * @file    DockArea.hpp
 * @brief   Main container widget for the docking system
 * @details Manages the dock tree, handles panel operations,
 *          splitter dragging, and drag-drop coordination.
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
#include "DockNode.hpp"
#include "DockZone.hpp"
#include "../widgets/Widget.hpp"
#include "../../events/Signal.hpp"
#include "../../events/Connection.hpp"

#include <unordered_map>
#include <vector>

namespace esengine::ui {

// Forward declarations
class DockPanel;
class DockTabBar;

// =============================================================================
// DockArea Class
// =============================================================================

/**
 * @brief Main container widget for dockable panels
 *
 * @details DockArea manages the entire docking tree structure including:
 *          - Tree manipulation (splitting, merging, tabbing)
 *          - Drag and drop operations
 *          - Splitter dragging for resizing
 *          - Layout calculation for all nodes
 *
 * @code
 * auto dockArea = makeUnique<DockArea>(WidgetId("editor.dock"));
 *
 * // Add panels
 * dockArea->addPanel(makeUnique<HierarchyPanel>(), DockDropZone::Left);
 * dockArea->addPanel(makeUnique<InspectorPanel>(), DockDropZone::Right);
 * dockArea->addPanel(makeUnique<ScenePanel>(), DockDropZone::Center);
 *
 * uiContext.setRoot(std::move(dockArea));
 * @endcode
 */
class DockArea : public Widget {
public:
    explicit DockArea(const WidgetId& id);
    ~DockArea() override;

    // =========================================================================
    // Tree Access
    // =========================================================================

    /** @brief Gets the root dock node */
    DockNode* getRootNode() const { return rootNode_.get(); }

    /** @brief Find a node by ID */
    DockNode* findNode(DockNodeId id);

    /** @brief Find a panel by ID */
    DockPanel* findPanel(DockPanelId id);

    /** @brief Find the node containing a panel */
    DockNode* findNodeContainingPanel(DockPanelId panelId);

    // =========================================================================
    // Panel Management
    // =========================================================================

    /**
     * @brief Add a panel to the dock area
     * @param panel Panel to add (ownership transferred)
     * @param zone Dock zone (Left, Right, Top, Bottom, Center)
     * @param targetNode Node to dock relative to (nullptr = root)
     * @param ratio Split ratio for edge docking
     */
    void addPanel(Unique<DockPanel> panel,
                  DockDropZone zone = DockDropZone::Center,
                  DockNode* targetNode = nullptr,
                  f32 ratio = 0.3f);

    /**
     * @brief Remove a panel from the dock area
     * @param panelId ID of panel to remove
     * @return The removed panel
     */
    Unique<DockPanel> removePanel(DockPanelId panelId);

    /**
     * @brief Move a panel to a new location
     * @param panel Panel to move
     * @param target Drop target information
     */
    void movePanel(DockPanel* panel, const DockDropTarget& target);

    /**
     * @brief Close a panel
     * @param panelId ID of panel to close
     */
    void closePanel(DockPanelId panelId);

    /**
     * @brief Get all panels in the dock area
     */
    std::vector<DockPanel*> getAllPanels() const;

    // =========================================================================
    // Node Operations
    // =========================================================================

    /**
     * @brief Split a node to create space for docking
     * @param node Node to split
     * @param direction Split direction
     * @param ratio Split ratio
     * @param insertFirst Insert new node as first child
     * @return The new tabs node for adding panels
     */
    DockNode* splitNode(DockNode* node,
                        DockSplitDirection direction,
                        f32 ratio = 0.5f,
                        bool insertFirst = false);

    /**
     * @brief Try to merge empty nodes up the tree
     * @param node Node to start checking from
     */
    void tryMergeNode(DockNode* node);

    // =========================================================================
    // ID Generation
    // =========================================================================

    /** @brief Generate a unique node ID */
    DockNodeId generateNodeId() { return nextNodeId_++; }

    // =========================================================================
    // Drag and Drop
    // =========================================================================

    /** @brief Get the zone detector for drag operations */
    DockZoneDetector& getZoneDetector() { return zoneDetector_; }

    /** @brief Check if a drag operation is in progress */
    bool isDragging() const { return zoneDetector_.isDragging(); }

    /**
     * @brief Start dragging a panel
     * @param panel Panel to drag
     * @param startPos Initial mouse position
     */
    void beginPanelDrag(DockPanel* panel, const glm::vec2& startPos);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Set minimum panel size */
    void setMinPanelSize(const glm::vec2& size) { minPanelSize_ = size; }

    /** @brief Get minimum panel size */
    glm::vec2 getMinPanelSize() const { return minPanelSize_; }

    /** @brief Set splitter thickness in pixels */
    void setSplitterThickness(f32 thickness) { splitterThickness_ = thickness; }

    /** @brief Get splitter thickness */
    f32 getSplitterThickness() const { return splitterThickness_; }

    /** @brief Set tab bar height */
    void setTabBarHeight(f32 height) { tabBarHeight_ = height; }

    /** @brief Get tab bar height */
    f32 getTabBarHeight() const { return tabBarHeight_; }

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Emitted when a panel is closed */
    Signal<void(DockPanelId)> onPanelClosed;

    /** @brief Emitted when a panel is activated (selected) */
    Signal<void(DockPanelId)> onPanelActivated;

    /** @brief Emitted when the layout changes */
    Signal<void()> onLayoutChanged;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const Rect& bounds) override;
    void render(UIBatchRenderer& renderer) override;

    Widget* hitTest(f32 x, f32 y) override;
    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;

protected:
    void onStateChanged() override;

private:
    void layoutNode(DockNode* node);
    void renderNode(UIBatchRenderer& renderer, DockNode* node);
    void renderSplitter(UIBatchRenderer& renderer, DockNode* node);
    void renderTabBar(UIBatchRenderer& renderer, DockNode* node);

    DockNode* hitTestSplitter(f32 x, f32 y);
    void handleSplitterDrag(f32 x, f32 y);

    void setNodeArea(DockNode* node);
    void connectTabBarSignals(DockNode* node);

    DockTabBar* getOrCreateTabBar(DockNode* node);

    Unique<DockNode> rootNode_;
    DockNodeId nextNodeId_ = 1;

    DockZoneDetector zoneDetector_;

    std::unordered_map<DockNodeId, Unique<DockTabBar>> tabBars_;
    std::unordered_map<DockNodeId, std::vector<Connection>> tabBarConnections_;

    DockNode* draggedSplitter_ = nullptr;
    glm::vec2 splitterDragStart_{0.0f};
    f32 splitterDragStartRatio_ = 0.0f;

    glm::vec2 minPanelSize_{100.0f, 100.0f};
    f32 splitterThickness_ = 4.0f;
    f32 tabBarHeight_ = 24.0f;

    f32 lastMouseX_ = 0.0f;
    f32 lastMouseY_ = 0.0f;
};

}  // namespace esengine::ui
