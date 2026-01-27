/**
 * @file    TreeView.cpp
 * @brief   Tree view widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "TreeView.hpp"
#include "../UIContext.hpp"
#include "../font/SDFFont.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../core/Log.hpp"
#include "../../math/Math.hpp"

#include <algorithm>

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

TreeView::TreeView(const WidgetId& id) : Widget(id) {}

// =============================================================================
// Node Management
// =============================================================================

TreeNodeId TreeView::addNode(TreeNodeId parentId, const std::string& label) {
    TreeNodeId newId = generateNodeId();

    TreeNode node;
    node.id = newId;
    node.parentId = parentId;
    node.label = label;
    node.expanded = false;

    if (parentId == INVALID_TREE_NODE) {
        node.depth = 0;
        rootNodes_.push_back(newId);
    } else {
        TreeNode* parent = getNode(parentId);
        if (parent) {
            node.depth = parent->depth + 1;
            parent->children.push_back(newId);
        } else {
            ES_LOG_WARN("TreeView: Parent node {} not found", parentId);
            node.depth = 0;
            rootNodes_.push_back(newId);
        }
    }

    nodes_[newId] = node;
    visibleNodesDirty_ = true;
    invalidateLayout();

    return newId;
}

void TreeView::removeNode(TreeNodeId nodeId) {
    TreeNode* node = getNode(nodeId);
    if (!node) {
        return;
    }

    // Remove from parent's children
    if (node->parentId != INVALID_TREE_NODE) {
        TreeNode* parent = getNode(node->parentId);
        if (parent) {
            auto& children = parent->children;
            children.erase(std::remove(children.begin(), children.end(), nodeId), children.end());
        }
    } else {
        // Remove from root nodes
        rootNodes_.erase(std::remove(rootNodes_.begin(), rootNodes_.end(), nodeId),
                          rootNodes_.end());
    }

    // Recursively remove children
    std::vector<TreeNodeId> childrenCopy = node->children;
    for (TreeNodeId childId : childrenCopy) {
        removeNode(childId);
    }

    // Remove from selection
    selectedNodes_.erase(nodeId);

    // Remove node
    nodes_.erase(nodeId);

    visibleNodesDirty_ = true;
    invalidateLayout();
}

void TreeView::clear() {
    nodes_.clear();
    rootNodes_.clear();
    visibleNodes_.clear();
    selectedNodes_.clear();
    visibleNodesDirty_ = true;
    invalidateLayout();
}

TreeNode* TreeView::getNode(TreeNodeId nodeId) {
    auto it = nodes_.find(nodeId);
    return it != nodes_.end() ? &it->second : nullptr;
}

const TreeNode* TreeView::getNode(TreeNodeId nodeId) const {
    auto it = nodes_.find(nodeId);
    return it != nodes_.end() ? &it->second : nullptr;
}

void TreeView::setNodeLabel(TreeNodeId nodeId, const std::string& label) {
    TreeNode* node = getNode(nodeId);
    if (node) {
        node->label = label;
    }
}

// =============================================================================
// Expand/Collapse
// =============================================================================

void TreeView::setNodeExpanded(TreeNodeId nodeId, bool expanded) {
    TreeNode* node = getNode(nodeId);
    if (!node || node->expanded == expanded) {
        return;
    }

    node->expanded = expanded;
    visibleNodesDirty_ = true;
    invalidateLayout();

    if (expanded) {
        onNodeExpanded.publish(nodeId);
    } else {
        onNodeCollapsed.publish(nodeId);
    }
}

void TreeView::toggleNodeExpanded(TreeNodeId nodeId) {
    TreeNode* node = getNode(nodeId);
    if (node) {
        setNodeExpanded(nodeId, !node->expanded);
    }
}

bool TreeView::isNodeExpanded(TreeNodeId nodeId) const {
    const TreeNode* node = getNode(nodeId);
    return node && node->expanded;
}

void TreeView::expandAll() {
    for (auto& pair : nodes_) {
        pair.second.expanded = true;
    }
    visibleNodesDirty_ = true;
    invalidateLayout();
}

void TreeView::collapseAll() {
    for (auto& pair : nodes_) {
        pair.second.expanded = false;
    }
    visibleNodesDirty_ = true;
    invalidateLayout();
}

// =============================================================================
// Selection
// =============================================================================

void TreeView::selectNode(TreeNodeId nodeId, bool clearPrevious) {
    if (!getNode(nodeId)) {
        return;
    }

    if (clearPrevious && !multiSelect_) {
        auto previousSelection = selectedNodes_;
        selectedNodes_.clear();

        for (TreeNodeId prevId : previousSelection) {
            onNodeDeselected.publish(prevId);
        }
    }

    if (selectedNodes_.insert(nodeId).second) {
        onNodeSelected.publish(nodeId);
    }
}

void TreeView::deselectNode(TreeNodeId nodeId) {
    if (selectedNodes_.erase(nodeId) > 0) {
        onNodeDeselected.publish(nodeId);
    }
}

void TreeView::clearSelection() {
    auto previousSelection = selectedNodes_;
    selectedNodes_.clear();

    for (TreeNodeId nodeId : previousSelection) {
        onNodeDeselected.publish(nodeId);
    }
}

bool TreeView::isNodeSelected(TreeNodeId nodeId) const {
    return selectedNodes_.count(nodeId) > 0;
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 TreeView::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    if (visibleNodesDirty_) {
        rebuildVisibleNodes();
    }

    f32 contentHeight = static_cast<f32>(visibleNodes_.size()) * rowHeight_;

    const SizeConstraints& constraints = getConstraints();
    f32 width = glm::clamp(availableWidth, constraints.minWidth, constraints.maxWidth);
    f32 height = glm::clamp(contentHeight, constraints.minHeight, constraints.maxHeight);

    return glm::vec2(width, height);
}

// =============================================================================
// Rendering
// =============================================================================

void TreeView::render(UIBatchRenderer& renderer) {
    if (visibleNodesDirty_) {
        rebuildVisibleNodes();
    }

    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 y = bounds.y + padding.top;

    for (TreeNodeId nodeId : visibleNodes_) {
        const TreeNode* node = getNode(nodeId);
        if (!node) {
            continue;
        }

        bool isHovered = (hoveredNode_ == nodeId);
        renderNode(renderer, *node, y, isHovered);

        y += rowHeight_;
    }
}

void TreeView::renderNode(UIBatchRenderer& renderer, const TreeNode& node, f32 y,
                           bool isHovered) {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 x = bounds.x + padding.left + node.depth * indentSize_;
    f32 rowWidth = bounds.width - padding.left - padding.right;

    Rect rowBounds{bounds.x + padding.left, y, rowWidth, rowHeight_};

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getPanelStyle();
    }

    bool isSelected = isNodeSelected(node.id);

    if (isSelected) {
        glm::vec4 selectionColor = style.backgroundColor;
        if (getContext()) {
            selectionColor = getContext()->getTheme().colors.selection;
        }
        renderer.drawRect(rowBounds, selectionColor);
    } else if (isHovered) {
        glm::vec4 hoverColor = style.getBackgroundColor(
            WidgetState{.hovered = true, .pressed = false, .focused = false, .disabled = false,
                        .visible = true});
        renderer.drawRect(rowBounds, hoverColor);
    }

    bool hasChild = hasChildren(node);

    if (hasChild) {
        Rect iconBounds = getIconBounds(node, y);

        glm::vec4 iconColor = style.textColor;
        if (getContext()) {
            iconColor = getContext()->getTheme().colors.textPrimary;
        }

        if (node.expanded) {
            // Draw expanded icon (▼)
            f32 cx = iconBounds.x + iconBounds.width * 0.5f;
            f32 cy = iconBounds.y + iconBounds.height * 0.5f;
            f32 size = iconSize_ * 0.3f;

            Rect arrowRect{cx - size, cy - size * 0.3f, size * 2.0f, size * 0.6f};
            renderer.drawRect(arrowRect, iconColor);
        } else {
            // Draw collapsed icon (▶)
            f32 cx = iconBounds.x + iconBounds.width * 0.5f;
            f32 cy = iconBounds.y + iconBounds.height * 0.5f;
            f32 size = iconSize_ * 0.3f;

            Rect arrowRect{cx - size * 0.3f, cy - size, size * 0.6f, size * 2.0f};
            renderer.drawRect(arrowRect, iconColor);
        }

        x += iconSize_ + 4.0f;
    } else {
        x += iconSize_ + 4.0f;
    }

    glm::vec4 textColor = style.textColor;
    if (getContext()) {
        textColor = getContext()->getTheme().colors.textPrimary;
    }

    f32 fontSize = style.fontSize;
    if (getContext()) {
        fontSize = getContext()->getTheme().typography.fontSizeNormal;
    }

    f32 textY = y + (rowHeight_ - fontSize) * 0.5f;

    if (getContext() && getContext()->getDefaultFont()) {
        renderer.drawText(node.label, glm::vec2(x, textY), *getContext()->getDefaultFont(),
                          fontSize, textColor);
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool TreeView::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    if (visibleNodesDirty_) {
        rebuildVisibleNodes();
    }

    TreeNodeId clickedNode = getNodeAtY(event.y);
    if (clickedNode == INVALID_TREE_NODE) {
        return false;
    }

    const TreeNode* node = getNode(clickedNode);
    if (!node) {
        return false;
    }

    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    usize index = 0;
    for (; index < visibleNodes_.size(); ++index) {
        if (visibleNodes_[index] == clickedNode) {
            break;
        }
    }

    if (index >= visibleNodes_.size()) {
        return false;
    }

    f32 y = bounds.y + padding.top + static_cast<f32>(index) * rowHeight_;

    if (hasChildren(*node)) {
        Rect iconBounds = getIconBounds(*node, y);
        if (iconBounds.contains(event.x, event.y)) {
            toggleNodeExpanded(clickedNode);
            return true;
        }
    }

    // Simple double-click detection without time tracking
    // TODO: Implement proper time tracking when platform provides it
    bool isDoubleClick = (clickedNode == lastClickedNode_);

    if (isDoubleClick) {
        onNodeDoubleClicked.publish(clickedNode);

        if (hasChildren(*node)) {
            toggleNodeExpanded(clickedNode);
        }

        lastClickedNode_ = INVALID_TREE_NODE;
    } else {
        selectNode(clickedNode, true);
        onNodeClicked.publish(clickedNode);

        lastClickedNode_ = clickedNode;
    }

    return true;
}

// =============================================================================
// Private Methods
// =============================================================================

TreeNodeId TreeView::generateNodeId() {
    return nextNodeId_++;
}

void TreeView::rebuildVisibleNodes() {
    visibleNodes_.clear();

    for (TreeNodeId rootId : rootNodes_) {
        addVisibleNodesRecursive(rootId);
    }

    visibleNodesDirty_ = false;
}

void TreeView::addVisibleNodesRecursive(TreeNodeId nodeId) {
    visibleNodes_.push_back(nodeId);

    const TreeNode* node = getNode(nodeId);
    if (!node || !node->expanded) {
        return;
    }

    for (TreeNodeId childId : node->children) {
        addVisibleNodesRecursive(childId);
    }
}

TreeNodeId TreeView::getNodeAtY(f32 y) const {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 relativeY = y - bounds.y - padding.top;

    if (relativeY < 0.0f) {
        return INVALID_TREE_NODE;
    }

    usize index = static_cast<usize>(relativeY / rowHeight_);

    if (index >= visibleNodes_.size()) {
        return INVALID_TREE_NODE;
    }

    return visibleNodes_[index];
}

Rect TreeView::getIconBounds(const TreeNode& node, f32 y) const {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 x = bounds.x + padding.left + node.depth * indentSize_;

    return Rect{
        x,
        y + (rowHeight_ - iconSize_) * 0.5f,
        iconSize_,
        iconSize_
    };
}

bool TreeView::hasChildren(const TreeNode& node) const {
    return !node.children.empty();
}

}  // namespace esengine::ui
