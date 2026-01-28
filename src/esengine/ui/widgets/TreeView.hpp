/**
 * @file    TreeView.hpp
 * @brief   Tree view widget for hierarchical data
 * @details A widget that displays hierarchical data in a tree structure with
 *          expandable/collapsible nodes, selection, and customizable rendering.
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

#include "Widget.hpp"
#include "../../events/Signal.hpp"

#include <functional>
#include <unordered_set>
#include <vector>

namespace esengine::ui {

// =============================================================================
// TreeNodeId
// =============================================================================

/**
 * @brief Unique identifier for tree nodes
 */
using TreeNodeId = u64;

constexpr TreeNodeId INVALID_TREE_NODE = 0;

// =============================================================================
// TreeNode
// =============================================================================

/**
 * @brief Represents a node in the tree
 *
 * @details TreeNode is a lightweight value type that represents a node's
 *          identity and state. The actual data is stored externally and
 *          accessed via callbacks.
 */
struct TreeNode {
    TreeNodeId id = INVALID_TREE_NODE;       ///< Unique node identifier
    TreeNodeId parentId = INVALID_TREE_NODE; ///< Parent node ID
    std::string label;                       ///< Display label
    std::string icon;                        ///< Icon Unicode character
    std::string type;                        ///< Type label for right column
    std::vector<TreeNodeId> children;        ///< Child node IDs
    bool expanded = false;                   ///< Expanded state
    bool visible = true;                     ///< Visibility state for eye icon
    u32 depth = 0;                           ///< Depth in tree (0 = root)
};

// =============================================================================
// TreeView Class
// =============================================================================

/**
 * @brief Tree view widget for displaying hierarchical data
 *
 * @details TreeView displays hierarchical data with expand/collapse functionality.
 *          It supports:
 *          - Single and multi-selection
 *          - Expand/collapse with visual indicators
 *          - Customizable node rendering
 *          - Click and double-click events
 *          - Keyboard navigation (future)
 *
 * @code
 * auto tree = makeUnique<TreeView>(WidgetId("tree"));
 *
 * // Add root node
 * TreeNodeId root = tree->addNode(INVALID_TREE_NODE, "Root");
 * tree->addNode(root, "Child 1");
 * tree->addNode(root, "Child 2");
 *
 * // Handle selection
 * tree->onNodeSelected.connect([](TreeNodeId nodeId) {
 *     ES_LOG_INFO("Selected: {}", nodeId);
 * });
 *
 * // Expand root
 * tree->setNodeExpanded(root, true);
 * @endcode
 */
class TreeView : public Widget {
public:
    /**
     * @brief Creates a tree view
     * @param id Widget identifier
     */
    explicit TreeView(const WidgetId& id);

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets whether multiple nodes can be selected
     * @param multiSelect True to enable multi-selection
     */
    void setMultiSelect(bool multiSelect) { multiSelect_ = multiSelect; }

    /**
     * @brief Returns true if multi-selection is enabled
     */
    bool isMultiSelect() const { return multiSelect_; }

    /**
     * @brief Sets the indent size per level
     * @param indent Indent in pixels
     */
    void setIndentSize(f32 indent) { indentSize_ = indent; invalidateLayout(); }

    /**
     * @brief Gets the indent size
     */
    f32 getIndentSize() const { return indentSize_; }

    /**
     * @brief Sets the row height
     * @param height Row height in pixels
     */
    void setRowHeight(f32 height) { rowHeight_ = height; invalidateLayout(); }

    /**
     * @brief Gets the row height
     */
    f32 getRowHeight() const { return rowHeight_; }

    /**
     * @brief Sets the expand/collapse icon size
     * @param size Icon size in pixels
     */
    void setIconSize(f32 size) { iconSize_ = size; }

    /**
     * @brief Gets the icon size
     */
    f32 getIconSize() const { return iconSize_; }

    // =========================================================================
    // Node Management
    // =========================================================================

    /**
     * @brief Adds a new node
     * @param parentId Parent node ID (INVALID_TREE_NODE for root)
     * @param label Node label
     * @return The new node's ID
     */
    TreeNodeId addNode(TreeNodeId parentId, const std::string& label);

    /**
     * @brief Removes a node and all its children
     * @param nodeId Node to remove
     */
    void removeNode(TreeNodeId nodeId);

    /**
     * @brief Removes all nodes
     */
    void clear();

    /**
     * @brief Gets a node by ID
     * @param nodeId Node ID
     * @return Pointer to node, or nullptr if not found
     */
    TreeNode* getNode(TreeNodeId nodeId);

    /**
     * @brief Gets a node by ID (const)
     * @param nodeId Node ID
     * @return Const pointer to node, or nullptr if not found
     */
    const TreeNode* getNode(TreeNodeId nodeId) const;

    /**
     * @brief Sets a node's label
     * @param nodeId Node ID
     * @param label New label
     */
    void setNodeLabel(TreeNodeId nodeId, const std::string& label);

    /** @brief Sets a node's icon */
    void setNodeIcon(TreeNodeId nodeId, const std::string& icon);

    /** @brief Sets a node's type label */
    void setNodeType(TreeNodeId nodeId, const std::string& type);

    /** @brief Sets a node's visibility state */
    void setNodeVisible(TreeNodeId nodeId, bool visible);

    /** @brief Gets all root nodes */
    const std::vector<TreeNodeId>& getRootNodes() const { return rootNodes_; }

    // =========================================================================
    // Expand/Collapse
    // =========================================================================

    /**
     * @brief Sets a node's expanded state
     * @param nodeId Node ID
     * @param expanded True to expand, false to collapse
     */
    void setNodeExpanded(TreeNodeId nodeId, bool expanded);

    /**
     * @brief Toggles a node's expanded state
     * @param nodeId Node ID
     */
    void toggleNodeExpanded(TreeNodeId nodeId);

    /**
     * @brief Returns true if a node is expanded
     * @param nodeId Node ID
     */
    bool isNodeExpanded(TreeNodeId nodeId) const;

    /**
     * @brief Expands all nodes
     */
    void expandAll();

    /**
     * @brief Collapses all nodes
     */
    void collapseAll();

    // =========================================================================
    // Selection
    // =========================================================================

    /**
     * @brief Selects a node
     * @param nodeId Node ID
     * @param clearPrevious True to clear previous selection (default)
     */
    void selectNode(TreeNodeId nodeId, bool clearPrevious = true);

    /**
     * @brief Deselects a node
     * @param nodeId Node ID
     */
    void deselectNode(TreeNodeId nodeId);

    /**
     * @brief Clears all selection
     */
    void clearSelection();

    /**
     * @brief Returns true if a node is selected
     * @param nodeId Node ID
     */
    bool isNodeSelected(TreeNodeId nodeId) const;

    /**
     * @brief Gets all selected nodes
     * @return Set of selected node IDs
     */
    const std::unordered_set<TreeNodeId>& getSelectedNodes() const { return selectedNodes_; }

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Emitted when a node is selected */
    Signal<void(TreeNodeId)> onNodeSelected;

    /** @brief Emitted when a node is deselected */
    Signal<void(TreeNodeId)> onNodeDeselected;

    /** @brief Emitted when a node is clicked */
    Signal<void(TreeNodeId)> onNodeClicked;

    /** @brief Emitted when a node is double-clicked */
    Signal<void(TreeNodeId)> onNodeDoubleClicked;

    /** @brief Emitted when a node is expanded */
    Signal<void(TreeNodeId)> onNodeExpanded;

    /** @brief Emitted when a node is collapsed */
    Signal<void(TreeNodeId)> onNodeCollapsed;

    /** @brief Emitted when a node is right-clicked (with screen coordinates) */
    Signal<void(TreeNodeId, f32, f32)> onNodeRightClicked;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;
    bool onMouseDown(const MouseButtonEvent& event) override;

protected:
    /**
     * @brief Renders a single node row
     * @param renderer Batch renderer
     * @param node Node to render
     * @param y Y position
     * @param isHovered True if mouse is over this row
     */
    virtual void renderNode(UIBatchRenderer& renderer, const TreeNode& node, f32 y, bool isHovered);

private:
    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * @brief Generates a unique node ID
     */
    TreeNodeId generateNodeId();

    /**
     * @brief Rebuilds the visible node list
     */
    void rebuildVisibleNodes();

    /**
     * @brief Recursively adds visible nodes
     */
    void addVisibleNodesRecursive(TreeNodeId nodeId);

    /**
     * @brief Finds the node at a screen Y coordinate
     * @param y Y coordinate
     * @return Node ID, or INVALID_TREE_NODE if none
     */
    TreeNodeId getNodeAtY(f32 y) const;

    /**
     * @brief Gets the expand/collapse icon bounds for a node
     * @param node Node
     * @param y Y position
     * @return Icon bounds
     */
    Rect getIconBounds(const TreeNode& node, f32 y) const;

    /**
     * @brief Checks if a node has children
     */
    bool hasChildren(const TreeNode& node) const;

    // =========================================================================
    // Member Variables
    // =========================================================================

    // Node storage
    std::unordered_map<TreeNodeId, TreeNode> nodes_;
    std::vector<TreeNodeId> rootNodes_;
    std::vector<TreeNodeId> visibleNodes_;          ///< Flattened list of visible nodes
    bool visibleNodesDirty_ = true;

    // Selection
    std::unordered_set<TreeNodeId> selectedNodes_;
    bool multiSelect_ = false;

    // Layout
    f32 indentSize_ = 20.0f;
    f32 rowHeight_ = 24.0f;
    f32 iconSize_ = 12.0f;

    // ID generation
    TreeNodeId nextNodeId_ = 1;

    // Interaction state
    TreeNodeId hoveredNode_ = INVALID_TREE_NODE;
    TreeNodeId lastClickedNode_ = INVALID_TREE_NODE;
};

}  // namespace esengine::ui
