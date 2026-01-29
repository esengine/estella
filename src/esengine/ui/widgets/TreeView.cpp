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
#include "../icons/Icons.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../core/Log.hpp"
#include "../../math/Math.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

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

void TreeView::setNodeIcon(TreeNodeId nodeId, const std::string& icon) {
    TreeNode* node = getNode(nodeId);
    if (node) {
        node->icon = icon;
    }
}

void TreeView::setNodeType(TreeNodeId nodeId, const std::string& type) {
    TreeNode* node = getNode(nodeId);
    if (node) {
        node->type = type;
    }
}

void TreeView::setNodeVisible(TreeNodeId nodeId, bool visible) {
    TreeNode* node = getNode(nodeId);
    if (node) {
        node->visible = visible;
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

    constexpr f32 ROW_PADDING_X = 8.0f;
    constexpr f32 ICON_SIZE = 14.0f;
    constexpr f32 ARROW_SIZE = 16.0f;
    constexpr f32 FONT_SIZE = 12.0f;
    constexpr f32 TYPE_COLUMN_WIDTH = 80.0f;
    constexpr f32 VISIBILITY_COLUMN_WIDTH = 20.0f;

    constexpr glm::vec4 hoverBg{0.165f, 0.176f, 0.180f, 1.0f};
    constexpr glm::vec4 selectedBg{0.216f, 0.216f, 0.239f, 1.0f};
    constexpr glm::vec4 textColor{0.8f, 0.8f, 0.8f, 1.0f};
    constexpr glm::vec4 dimTextColor{0.5f, 0.5f, 0.5f, 1.0f};
    constexpr glm::vec4 arrowColor{0.8f, 0.8f, 0.8f, 1.0f};
    constexpr glm::vec4 folderColor{0.863f, 0.714f, 0.478f, 1.0f};
    constexpr glm::vec4 entityIconColor{0.525f, 0.725f, 0.855f, 1.0f};
    constexpr glm::vec4 visibleIconColor{0.5f, 0.5f, 0.5f, 1.0f};
    constexpr glm::vec4 hiddenIconColor{0.3f, 0.3f, 0.3f, 1.0f};

    f32 rowWidth = bounds.width - padding.left - padding.right;
    Rect rowBounds{bounds.x + padding.left, y, rowWidth, rowHeight_};

    bool isSelected = isNodeSelected(node.id);

    if (isSelected) {
        renderer.drawRect(rowBounds, selectedBg);
    } else if (isHovered) {
        renderer.drawRect(rowBounds, hoverBg);
    }

#if ES_FEATURE_SDF_FONT
    MSDFFont* iconFont = getContext() ? getContext()->getIconMSDFFont() : nullptr;
    MSDFFont* textFont = getContext() ? getContext()->getDefaultMSDFFont() : nullptr;

    f32 x = bounds.x + padding.left + ROW_PADDING_X;

    // Visibility icon
    if (iconFont) {
        Rect eyeBounds{x, y + (rowHeight_ - ICON_SIZE) * 0.5f, ICON_SIZE, ICON_SIZE};
        const char* eyeIcon = node.visible ? icons::Eye : icons::EyeOff;
        glm::vec4 eyeColor = node.visible ? visibleIconColor : hiddenIconColor;
        renderer.drawTextInBounds(eyeIcon, eyeBounds, *iconFont, 12.0f, eyeColor,
                                   HAlign::Center, VAlign::Center);
    }
    x += VISIBILITY_COLUMN_WIDTH;

    // Indent + expand arrow
    x += static_cast<f32>(node.depth) * indentSize_;

    bool hasChild = hasChildren(node);
    Rect arrowBounds{x, y + (rowHeight_ - ARROW_SIZE) * 0.5f, ARROW_SIZE, ARROW_SIZE};

    if (iconFont && hasChild) {
        const char* arrowIcon = node.expanded ? icons::ChevronDown : icons::ChevronRight;
        renderer.drawTextInBounds(arrowIcon, arrowBounds, *iconFont, 12.0f, arrowColor,
                                   HAlign::Center, VAlign::Center);
    }
    x += ARROW_SIZE + 2.0f;

    // Entity icon
    if (iconFont) {
        Rect iconBounds{x, y + (rowHeight_ - ICON_SIZE) * 0.5f, ICON_SIZE, ICON_SIZE};

        if (!node.icon.empty()) {
            renderer.drawTextInBounds(node.icon, iconBounds, *iconFont, 14.0f, entityIconColor,
                                       HAlign::Center, VAlign::Center);
        } else {
            const char* folderIcon = hasChild && node.expanded ? icons::FolderOpen : icons::Folder;
            renderer.drawTextInBounds(folderIcon, iconBounds, *iconFont, 14.0f, folderColor,
                                       HAlign::Center, VAlign::Center);
        }
    }
    x += ICON_SIZE + 6.0f;

    // Label
    f32 labelMaxWidth = bounds.x + bounds.width - padding.right - TYPE_COLUMN_WIDTH - x;
    f32 textY = y + (rowHeight_ - FONT_SIZE) * 0.5f;

    if (textFont && labelMaxWidth > 0) {
        Rect labelClipRect{x, y, labelMaxWidth, rowHeight_};
        renderer.pushClipRect(labelClipRect);
        renderer.drawText(node.label, glm::vec2(x, textY), *textFont, FONT_SIZE, textColor);
        renderer.popClipRect();
    }

    // Type column (right-aligned)
    if (textFont && !node.type.empty()) {
        f32 typeX = bounds.x + bounds.width - padding.right - TYPE_COLUMN_WIDTH;
        renderer.drawText(node.type, glm::vec2(typeX, textY), *textFont, 11.0f, dimTextColor);
    }

#elif ES_FEATURE_BITMAP_FONT
    f32 x = bounds.x + padding.left + ROW_PADDING_X + static_cast<f32>(node.depth) * indentSize_;
    f32 textY = y + (rowHeight_ - FONT_SIZE) * 0.5f;
    if (getContext() && getContext()->getDefaultBitmapFont()) {
        renderer.drawText(node.label, glm::vec2(x, textY), *getContext()->getDefaultBitmapFont(),
                          FONT_SIZE, textColor);
    }
#endif
}

// =============================================================================
// Event Handling
// =============================================================================

bool TreeView::onMouseDown(const MouseButtonEvent& event) {
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

    if (event.button == MouseButton::Right) {
        selectNode(clickedNode, true);
        onNodeRightClicked.publish(clickedNode, event.x, event.y);
        return true;
    }

    if (event.button != MouseButton::Left) {
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

    constexpr f32 ROW_PADDING_X = 8.0f;
    constexpr f32 ARROW_SIZE = 16.0f;
    constexpr f32 VISIBILITY_COLUMN_WIDTH = 20.0f;

    f32 x = bounds.x + padding.left + ROW_PADDING_X + VISIBILITY_COLUMN_WIDTH
            + static_cast<f32>(node.depth) * indentSize_;

    return Rect{
        x,
        y + (rowHeight_ - ARROW_SIZE) * 0.5f,
        ARROW_SIZE,
        ARROW_SIZE
    };
}

bool TreeView::hasChildren(const TreeNode& node) const {
    return !node.children.empty();
}

}  // namespace esengine::ui
