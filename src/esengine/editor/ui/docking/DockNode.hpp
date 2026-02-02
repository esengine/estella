/**
 * @file    DockNode.hpp
 * @brief   Binary tree node for the docking system
 * @details Represents either a Split node with two children or a Tabs node
 *          containing one or more DockPanels.
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
#include "../../../ui/core/Types.hpp"

#include <functional>
#include <vector>

namespace esengine::ui {

// Forward declarations
class DockPanel;
class DockArea;

// =============================================================================
// DockNode Class
// =============================================================================

/**
 * @brief A node in the docking binary tree structure
 *
 * @details Each node is either:
 *          - **Split**: Has two child nodes divided by a splitter
 *          - **Tabs**: Contains one or more DockPanels displayed as tabs
 *
 * @code
 * // Create a tabs node
 * auto tabsNode = DockNode::createTabs(1);
 * tabsNode->addPanel(std::move(panel));
 *
 * // Create a split node
 * auto splitNode = DockNode::createSplit(2, DockSplitDirection::Horizontal);
 * splitNode->setFirst(std::move(leftNode));
 * splitNode->setSecond(std::move(rightNode));
 * @endcode
 */
class DockNode {
public:
    // =========================================================================
    // Factory Methods
    // =========================================================================

    /**
     * @brief Create a Tabs node
     * @param id Unique node identifier
     */
    static Unique<DockNode> createTabs(DockNodeId id);

    /**
     * @brief Create a Split node
     * @param id Unique node identifier
     * @param direction Split direction (Horizontal or Vertical)
     */
    static Unique<DockNode> createSplit(DockNodeId id, DockSplitDirection direction);

    ~DockNode();

    // Non-copyable
    DockNode(const DockNode&) = delete;
    DockNode& operator=(const DockNode&) = delete;

    // =========================================================================
    // Identity
    // =========================================================================

    /** @brief Gets the node's unique identifier */
    DockNodeId getId() const { return id_; }

    /** @brief Gets the node type (Split or Tabs) */
    DockNodeType getType() const { return type_; }

    /** @brief Returns true if this is a Split node */
    bool isSplit() const { return type_ == DockNodeType::Split; }

    /** @brief Returns true if this is a Tabs node */
    bool isTabs() const { return type_ == DockNodeType::Tabs; }

    // =========================================================================
    // Tree Structure
    // =========================================================================

    /** @brief Gets the parent node (nullptr if root) */
    DockNode* getParent() const { return parent_; }

    /** @brief Gets the owning DockArea */
    DockArea* getArea() const { return area_; }

    /** @brief Gets the first child (Split nodes only) */
    DockNode* getFirst() const { return first_.get(); }

    /** @brief Gets the second child (Split nodes only) */
    DockNode* getSecond() const { return second_.get(); }

    /**
     * @brief Sets the first child node
     * @param node Child node (ownership transferred)
     */
    void setFirst(Unique<DockNode> node);

    /**
     * @brief Sets the second child node
     * @param node Child node (ownership transferred)
     */
    void setSecond(Unique<DockNode> node);

    /**
     * @brief Detach and return the first child
     */
    Unique<DockNode> detachFirst();

    /**
     * @brief Detach and return the second child
     */
    Unique<DockNode> detachSecond();

    // =========================================================================
    // Split Properties (Split nodes only)
    // =========================================================================

    /** @brief Gets the split direction */
    DockSplitDirection getSplitDirection() const { return splitDirection_; }

    /** @brief Sets the split direction */
    void setSplitDirection(DockSplitDirection direction) { splitDirection_ = direction; }

    /** @brief Gets the split ratio (0.0 to 1.0) */
    f32 getSplitRatio() const { return splitRatio_; }

    /**
     * @brief Sets the split ratio
     * @param ratio Value between 0.1 and 0.9 (clamped)
     */
    void setSplitRatio(f32 ratio);

    // =========================================================================
    // Tab Properties (Tabs nodes only)
    // =========================================================================

    /** @brief Gets all panels in this node */
    const std::vector<Unique<DockPanel>>& getPanels() const { return panels_; }

    /** @brief Gets the number of panels */
    usize getPanelCount() const { return panels_.size(); }

    /** @brief Gets the active tab index */
    i32 getActiveTabIndex() const { return activeTabIndex_; }

    /**
     * @brief Sets the active tab index
     * @param index Index of tab to activate
     */
    void setActiveTabIndex(i32 index);

    /** @brief Gets the currently active panel (may be nullptr) */
    DockPanel* getActivePanel() const;

    // =========================================================================
    // Panel Management (Tabs nodes only)
    // =========================================================================

    /**
     * @brief Add a panel to the end of the tab list
     * @param panel Panel to add (ownership transferred)
     */
    void addPanel(Unique<DockPanel> panel);

    /**
     * @brief Insert a panel at a specific index
     * @param panel Panel to insert (ownership transferred)
     * @param index Position to insert at
     */
    void insertPanel(Unique<DockPanel> panel, i32 index);

    /**
     * @brief Remove a panel by pointer
     * @param panel Panel to remove
     * @return The removed panel
     */
    Unique<DockPanel> removePanel(DockPanel* panel);

    /**
     * @brief Remove a panel by index
     * @param index Index of panel to remove
     * @return The removed panel
     */
    Unique<DockPanel> removePanelAt(i32 index);

    /**
     * @brief Find panel index by pointer
     * @param panel Panel to find
     * @return Index or -1 if not found
     */
    i32 findPanelIndex(DockPanel* panel) const;

    /**
     * @brief Find panel by ID
     * @param id Panel ID to search for
     * @return Panel pointer or nullptr
     */
    DockPanel* findPanel(DockPanelId id) const;

    // =========================================================================
    // Layout
    // =========================================================================

    /** @brief Gets the node's bounding rectangle */
    const Rect& getBounds() const { return bounds_; }

    /**
     * @brief Sets the node's bounding rectangle
     * @param bounds New bounds
     */
    void setBounds(const Rect& bounds) { bounds_ = bounds; }

    /**
     * @brief Perform layout on this node and children
     * @param splitterThickness Thickness of splitters in pixels
     * @param tabBarHeight Height of tab bars in pixels
     */
    void layout(f32 splitterThickness, f32 tabBarHeight);

    /**
     * @brief Gets the content area (excluding tab bar for Tabs nodes)
     */
    Rect getContentBounds() const { return contentBounds_; }

    // =========================================================================
    // Splitter (Split nodes only)
    // =========================================================================

    /**
     * @brief Get the splitter bounds for rendering/hit testing
     * @param thickness Splitter thickness in pixels
     */
    Rect getSplitterBounds(f32 thickness = 4.0f) const;

    /**
     * @brief Test if a point hits the splitter
     * @param x X coordinate
     * @param y Y coordinate
     * @param tolerance Hit tolerance in pixels
     */
    bool hitTestSplitter(f32 x, f32 y, f32 tolerance = 4.0f) const;

    // =========================================================================
    // Tree Traversal
    // =========================================================================

    /**
     * @brief Find a node by ID in this subtree
     * @param id Node ID to find
     * @return Node pointer or nullptr
     */
    DockNode* findNode(DockNodeId id);

    /**
     * @brief Find the node containing a specific panel
     * @param panelId Panel ID to search for
     * @return Node pointer or nullptr
     */
    DockNode* findNodeContainingPanel(DockPanelId panelId);

    /**
     * @brief Find the leaf node at a given point
     * @param x X coordinate
     * @param y Y coordinate
     * @return Leaf node pointer or nullptr
     */
    DockNode* findLeafAt(f32 x, f32 y);

    /**
     * @brief Execute a callback for each leaf (Tabs) node
     * @param callback Function to call
     */
    void forEachLeaf(const std::function<void(DockNode&)>& callback);

    /**
     * @brief Execute a callback for each node (pre-order traversal)
     * @param callback Function to call
     */
    void forEachNode(const std::function<void(DockNode&)>& callback);

    // =========================================================================
    // Validation
    // =========================================================================

    /** @brief Returns true if this is an empty Tabs node */
    bool isEmpty() const { return isTabs() && panels_.empty(); }

    /** @brief Returns true if this is a leaf node (Tabs) */
    bool isLeaf() const { return isTabs(); }

private:
    DockNode(DockNodeId id, DockNodeType type);

    void updateChildParents();
    void layoutSplit(f32 splitterThickness, f32 tabBarHeight);
    void layoutTabs(f32 tabBarHeight);

    DockNodeId id_;
    DockNodeType type_;
    DockNode* parent_ = nullptr;
    DockArea* area_ = nullptr;

    // Split node data
    DockSplitDirection splitDirection_ = DockSplitDirection::Horizontal;
    f32 splitRatio_ = 0.5f;
    Unique<DockNode> first_;
    Unique<DockNode> second_;

    // Tabs node data
    std::vector<Unique<DockPanel>> panels_;
    i32 activeTabIndex_ = 0;

    // Layout
    Rect bounds_;
    Rect contentBounds_;

    friend class DockArea;
};

}  // namespace esengine::ui
