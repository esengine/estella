/**
 * @file    HierarchyPanel.cpp
 * @brief   Hierarchy panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "HierarchyPanel.hpp"
#include "../../ecs/components/Common.hpp"
#include "../../ecs/components/Hierarchy.hpp"
#include "../../core/Log.hpp"
#include "../../events/Sink.hpp"

#include <sstream>

namespace esengine::editor {

// =============================================================================
// Constructor / Destructor
// =============================================================================

HierarchyPanel::HierarchyPanel(ecs::Registry& registry, EntitySelection& selection)
    : DockPanel(ui::WidgetId("hierarchy_panel"), "Hierarchy"),
      registry_(registry),
      selection_(selection) {

    setPanelType("Hierarchy");
    setClosable(false);
    setMinSize(glm::vec2(200.0f, 200.0f));

    // Create tree view
    auto treeView = makeUnique<ui::TreeView>(ui::WidgetId("hierarchy_tree"));
    treeView->setMultiSelect(false);
    treeView->setRowHeight(22.0f);
    treeView->setIndentSize(16.0f);

    treeView_ = treeView.get();
    setContent(std::move(treeView));

    // Connect tree view signals using sink helper
    nodeSelectedConnection_ = sink(treeView_->onNodeSelected).connect(
        [this](ui::TreeNodeId nodeId) { onNodeSelected(nodeId); }
    );

    nodeDoubleClickedConnection_ = sink(treeView_->onNodeDoubleClicked).connect(
        [this](ui::TreeNodeId nodeId) { onNodeDoubleClicked(nodeId); }
    );

    // Connect selection change events
    u32 listenerId = selection_.addListener(
        [this](const std::vector<Entity>& prev, const std::vector<Entity>& curr) {
            onSelectionChanged(prev, curr);
        }
    );
    selectionChangedConnection_ = Connection(listenerId, [&selection](CallbackId id) {
        selection.removeListener(static_cast<u32>(id));
    });

    // Initial tree build
    rebuildTree();
}

HierarchyPanel::~HierarchyPanel() {
    // Connections are automatically cleaned up by Connection RAII
}

// =============================================================================
// Public Methods
// =============================================================================

void HierarchyPanel::refresh() {
    needsRebuild_ = true;
}

void HierarchyPanel::setShowOrphans(bool showOrphans) {
    if (showOrphans_ != showOrphans) {
        showOrphans_ = showOrphans;
        needsRebuild_ = true;
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

void HierarchyPanel::onActivated() {
    if (needsRebuild_) {
        rebuildTree();
        needsRebuild_ = false;
    }
}

void HierarchyPanel::onDeactivated() {
    // Nothing to do
}

// =============================================================================
// Tree Building
// =============================================================================

void HierarchyPanel::rebuildTree() {
    if (!treeView_) {
        return;
    }

    // Clear tree and mappings
    treeView_->clear();
    nodeToEntity_.clear();
    entityToNode_.clear();

    // Collect all entities
    std::vector<Entity> allEntities;
    registry_.forEachEntity([&allEntities](Entity entity) {
        allEntities.push_back(entity);
    });

    ES_LOG_DEBUG("HierarchyPanel::rebuildTree: Found {} entities", allEntities.size());

    // Build tree starting from root entities (entities without Parent component)
    usize rootCount = 0;
    for (Entity entity : allEntities) {
        // Skip if entity has a parent (will be added as child)
        if (registry_.has<ecs::Parent>(entity)) {
            continue;
        }

        // Add as root node
        addEntityToTree(entity, ui::INVALID_TREE_NODE);
        rootCount++;
    }
    ES_LOG_DEBUG("HierarchyPanel::rebuildTree: Added {} root nodes", rootCount);

    // Sync with current selection
    if (!selection_.empty()) {
        Entity selectedEntity = selection_.getFirst();
        auto it = entityToNode_.find(selectedEntity);
        if (it != entityToNode_.end()) {
            treeView_->selectNode(it->second, true);
        }
    }
}

ui::TreeNodeId HierarchyPanel::addEntityToTree(Entity entity, ui::TreeNodeId parentNodeId) {
    // Get display name
    std::string displayName = getEntityDisplayName(entity);

    // Add to tree
    ui::TreeNodeId nodeId = treeView_->addNode(parentNodeId, displayName);

    // Store bidirectional mapping
    nodeToEntity_[nodeId] = entity;
    entityToNode_[entity] = nodeId;

    // Add children if entity has Children component
    if (registry_.has<ecs::Children>(entity)) {
        const auto& children = registry_.get<ecs::Children>(entity);
        for (Entity childEntity : children.entities) {
            // Verify child is valid
            if (!registry_.valid(childEntity)) {
                ES_LOG_WARN("HierarchyPanel: Invalid child entity {} for parent {}",
                            childEntity, entity);
                continue;
            }

            addEntityToTree(childEntity, nodeId);
        }

        // Expand node if it has children
        if (!children.empty()) {
            treeView_->setNodeExpanded(nodeId, true);
        }
    }

    return nodeId;
}

std::string HierarchyPanel::getEntityDisplayName(Entity entity) const {
    // Try to get Name component
    if (registry_.has<ecs::Name>(entity)) {
        const auto& name = registry_.get<ecs::Name>(entity);
        if (!name.value.empty()) {
            return name.value;
        }
    }

    // Fallback to "Entity {id}"
    std::ostringstream oss;
    oss << "Entity " << entity;
    return oss.str();
}

// =============================================================================
// Event Handlers
// =============================================================================

void HierarchyPanel::onNodeSelected(ui::TreeNodeId nodeId) {
    // Get entity for node
    Entity entity = getEntityForNode(nodeId);
    if (entity == INVALID_ENTITY) {
        return;
    }

    // Update selection (this will trigger onSelectionChanged via listener)
    if (!selection_.isSelected(entity)) {
        selection_.select(entity);
    }
}

void HierarchyPanel::onNodeDoubleClicked(ui::TreeNodeId nodeId) {
    // Double-click could be used for "focus" or "rename" functionality
    // For now, just toggle expand/collapse (TreeView already handles this)
    (void)nodeId;
}

void HierarchyPanel::onSelectionChanged(const std::vector<Entity>& previous,
                                         const std::vector<Entity>& current) {
    if (!treeView_) {
        return;
    }

    // Deselect all previous nodes
    for (Entity entity : previous) {
        auto it = entityToNode_.find(entity);
        if (it != entityToNode_.end()) {
            treeView_->deselectNode(it->second);
        }
    }

    // Select all current nodes
    for (Entity entity : current) {
        auto it = entityToNode_.find(entity);
        if (it != entityToNode_.end()) {
            treeView_->selectNode(it->second, false);  // Don't clear previous
        }
    }
}

// =============================================================================
// Mapping Helpers
// =============================================================================

Entity HierarchyPanel::getEntityForNode(ui::TreeNodeId nodeId) const {
    auto it = nodeToEntity_.find(nodeId);
    return it != nodeToEntity_.end() ? it->second : INVALID_ENTITY;
}

ui::TreeNodeId HierarchyPanel::getNodeForEntity(Entity entity) const {
    auto it = entityToNode_.find(entity);
    return it != entityToNode_.end() ? it->second : ui::INVALID_TREE_NODE;
}

}  // namespace esengine::editor
