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
#include "../../ui/layout/StackLayout.hpp"

#include <algorithm>
#include <cctype>
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

    buildUI();

    // Connect tree view signals using sink helper
    nodeSelectedConnection_ = sink(treeView_->onNodeSelected).connect(
        [this](ui::TreeNodeId nodeId) { onNodeSelected(nodeId); }
    );

    nodeDoubleClickedConnection_ = sink(treeView_->onNodeDoubleClicked).connect(
        [this](ui::TreeNodeId nodeId) { onNodeDoubleClicked(nodeId); }
    );

    searchChangedConnection_ = sink(searchField_->onTextChanged).connect(
        [this](const std::string& text) { onSearchTextChanged(text); }
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
// UI Building
// =============================================================================

void HierarchyPanel::buildUI() {
    constexpr glm::vec4 panelBg{0.145f, 0.145f, 0.149f, 1.0f};          // #252526
    constexpr glm::vec4 toolbarBg{0.176f, 0.176f, 0.188f, 1.0f};        // #2d2d30
    constexpr glm::vec4 mainBg{0.118f, 0.118f, 0.118f, 1.0f};           // #1e1e1e
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};      // #3c3c3c

    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    rootPanel->setDrawBackground(true);
    rootPanel->setBackgroundColor(mainBg);

    auto toolbar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_toolbar"));
    toolbar->setHeight(ui::SizeValue::px(38.0f));
    toolbar->setWidth(ui::SizeValue::flex(1.0f));
    toolbar->setPadding(ui::Insets(6.0f, 12.0f, 6.0f, 12.0f));
    toolbar->setDrawBackground(true);
    toolbar->setBackgroundColor(toolbarBg);
    toolbar->setBorderColor(borderColor);
    toolbar->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto searchField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_search"));
    searchField->setPlaceholder("Search...");
    searchField->setWidth(ui::SizeValue::flex(1.0f));
    searchField->setHeight(ui::SizeValue::px(26.0f));
    searchField_ = searchField.get();
    toolbar->addChild(std::move(searchField));

    toolbar_ = toolbar.get();
    rootPanel->addChild(std::move(toolbar));

    auto scrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_scroll"));
    scrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    scrollView->setWidth(ui::SizeValue::flex(1.0f));
    scrollView->setHeight(ui::SizeValue::flex(1.0f));

    auto treeView = makeUnique<ui::TreeView>(ui::WidgetId(getId().path + "_tree"));
    treeView->setMultiSelect(false);
    treeView->setRowHeight(22.0f);
    treeView->setIndentSize(16.0f);
    treeView->setWidth(ui::SizeValue::flex(1.0f));
    treeView->setHeight(ui::SizeValue::autoSize());
    treeView_ = treeView.get();

    scrollView->setContent(std::move(treeView));
    scrollView_ = scrollView.get();
    rootPanel->addChild(std::move(scrollView));

    rootPanel_ = rootPanel.get();
    setContent(std::move(rootPanel));
}

void HierarchyPanel::onSearchTextChanged(const std::string& text) {
    searchFilter_ = text;
    rebuildTree();
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

    // Convert search filter to lowercase for case-insensitive search
    std::string lowerFilter = searchFilter_;
    std::transform(lowerFilter.begin(), lowerFilter.end(), lowerFilter.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    // Build tree starting from root entities (entities without Parent component)
    usize rootCount = 0;
    for (Entity entity : allEntities) {
        // Skip if entity has a parent (will be added as child)
        if (registry_.has<ecs::Parent>(entity)) {
            continue;
        }

        // If we have a search filter, check if entity or any descendant matches
        if (!searchFilter_.empty()) {
            bool matches = false;
            std::string displayName = getEntityDisplayName(entity);
            std::string lowerName = displayName;
            std::transform(lowerName.begin(), lowerName.end(), lowerName.begin(),
                           [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (lowerName.find(lowerFilter) != std::string::npos) {
                matches = true;
            }
            if (!matches) continue;
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
