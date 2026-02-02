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
#include "../../ecs/components/Transform.hpp"
#include "../../ecs/components/Camera.hpp"
#include "../../ecs/components/Sprite.hpp"
#include "../../core/Log.hpp"
#include "../../events/Sink.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/icons/Icons.hpp"

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
    setMinSize(glm::vec2(280.0f, 200.0f));

    buildUI();

    nodeSelectedConnection_ = sink(treeView_->onNodeSelected).connect(
        [this](ui::TreeNodeId nodeId) { onNodeSelected(nodeId); }
    );

    nodeDoubleClickedConnection_ = sink(treeView_->onNodeDoubleClicked).connect(
        [this](ui::TreeNodeId nodeId) { onNodeDoubleClicked(nodeId); }
    );

    nodeRightClickedConnection_ = sink(treeView_->onNodeRightClicked).connect(
        [this](ui::TreeNodeId nodeId, f32 x, f32 y) { onNodeRightClicked(nodeId, x, y); }
    );

    searchChangedConnection_ = sink(searchField_->onTextChanged).connect(
        [this](const std::string& text) { onSearchTextChanged(text); }
    );

    addEntityClickedConnection_ = sink(addEntityButton_->onClick).connect(
        [this]() { createEntity(); }
    );

    createFolderClickedConnection_ = sink(createFolderButton_->onClick).connect(
        [this]() { createFolder(); }
    );

    contextMenu_ = makeUnique<ui::ContextMenu>(ui::WidgetId("hierarchy_context_menu"));
    contextMenuItemSelectedConnection_ = sink(contextMenu_->onItemSelected).connect(
        [this](const std::string& itemId) { onContextMenuItemSelected(itemId); }
    );
    contextMenuClosedConnection_ = sink(contextMenu_->onClosed).connect(
        [this]() {
            if (getContext()) {
                getContext()->removeOverlay(contextMenu_.get());
            }
        }
    );

    u32 listenerId = selection_.addListener(
        [this](const std::vector<Entity>& prev, const std::vector<Entity>& curr) {
            onSelectionChanged(prev, curr);
        }
    );
    selectionChangedConnection_ = Connection(listenerId, [this](CallbackId id) {
        selection_.removeListener(static_cast<u32>(id));
    });

    rebuildTree();
}

HierarchyPanel::~HierarchyPanel() {
    // Connections are automatically cleaned up by Connection RAII
}

// =============================================================================
// UI Building
// =============================================================================

void HierarchyPanel::buildUI() {
    constexpr glm::vec4 toolbarBg{0.2f, 0.2f, 0.2f, 1.0f};              // #333333
    constexpr glm::vec4 mainBg{0.165f, 0.165f, 0.165f, 1.0f};           // #2a2a2a
    constexpr glm::vec4 borderColor{0.102f, 0.102f, 0.102f, 1.0f};      // #1a1a1a
    constexpr glm::vec4 headerIconColor{0.4f, 0.4f, 0.4f, 1.0f};        // #666666
    constexpr glm::vec4 headerTextColor{0.6f, 0.6f, 0.6f, 1.0f};        // #999999

    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    rootPanel->setDrawBackground(true);
    rootPanel->setBackgroundColor(mainBg);

    // =========================================================================
    // Toolbar
    // =========================================================================
    auto toolbar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_toolbar"));
    toolbar->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 4.0f));
    toolbar->setHeight(ui::SizeValue::px(34.0f));
    toolbar->setWidth(ui::SizeValue::flex(1.0f));
    toolbar->setPadding(ui::Insets(4.0f, 8.0f, 4.0f, 8.0f));
    toolbar->setDrawBackground(true);
    toolbar->setBackgroundColor(toolbarBg);
    toolbar->setBorderColor(borderColor);
    toolbar->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto filterButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_filter_btn"), ui::icons::Filter);
    filterButton->setButtonStyle(ui::ButtonStyle::Ghost);
    filterButton->setWidth(ui::SizeValue::px(26.0f));
    filterButton->setHeight(ui::SizeValue::px(26.0f));
    filterButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(filterButton));

    auto searchField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_search"));
    searchField->setPlaceholder("Search...");
    searchField->setWidth(ui::SizeValue::flex(1.0f));
    searchField->setHeight(ui::SizeValue::px(26.0f));
    searchField_ = searchField.get();
    toolbar->addChild(std::move(searchField));

    auto addButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_add_btn"), ui::icons::Plus);
    addButton->setButtonStyle(ui::ButtonStyle::Ghost);
    addButton->setWidth(ui::SizeValue::px(26.0f));
    addButton->setHeight(ui::SizeValue::px(26.0f));
    addButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    addEntityButton_ = addButton.get();
    toolbar->addChild(std::move(addButton));

    auto folderButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_folder_btn"), ui::icons::FolderPlus);
    folderButton->setButtonStyle(ui::ButtonStyle::Ghost);
    folderButton->setWidth(ui::SizeValue::px(26.0f));
    folderButton->setHeight(ui::SizeValue::px(26.0f));
    folderButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    createFolderButton_ = folderButton.get();
    toolbar->addChild(std::move(folderButton));

    auto settingsButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_settings_btn"), ui::icons::Settings);
    settingsButton->setButtonStyle(ui::ButtonStyle::Ghost);
    settingsButton->setWidth(ui::SizeValue::px(26.0f));
    settingsButton->setHeight(ui::SizeValue::px(26.0f));
    settingsButton->setCornerRadii(ui::CornerRadii::all(3.0f));
    toolbar->addChild(std::move(settingsButton));

    toolbar_ = toolbar.get();
    rootPanel->addChild(std::move(toolbar));

    // =========================================================================
    // Column Headers
    // =========================================================================
    auto columnHeader = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_header"));
    columnHeader->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 6.0f));
    columnHeader->setHeight(ui::SizeValue::px(24.0f));
    columnHeader->setWidth(ui::SizeValue::flex(1.0f));
    columnHeader->setPadding(ui::Insets(0.0f, 8.0f, 0.0f, 8.0f));
    columnHeader->setDrawBackground(true);
    columnHeader->setBackgroundColor(toolbarBg);
    columnHeader->setBorderColor(borderColor);
    columnHeader->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));

    auto headerIcons = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_header_icons"));
    headerIcons->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 6.0f));
    headerIcons->setWidth(ui::SizeValue::px(54.0f));
    headerIcons->setHeight(ui::SizeValue::flex(1.0f));

    auto eyeLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_eye_icon"), ui::icons::Eye);
    eyeLabel->setFontSize(12.0f);
    eyeLabel->setColor(headerIconColor);
    eyeLabel->setIsIconFont(true);
    headerIcons->addChild(std::move(eyeLabel));

    auto starLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_star_icon"), ui::icons::Star);
    starLabel->setFontSize(12.0f);
    starLabel->setColor(headerIconColor);
    starLabel->setIsIconFont(true);
    headerIcons->addChild(std::move(starLabel));

    auto lockLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_lock_icon"), ui::icons::Lock);
    lockLabel->setFontSize(12.0f);
    lockLabel->setColor(headerIconColor);
    lockLabel->setIsIconFont(true);
    headerIcons->addChild(std::move(lockLabel));

    columnHeader->addChild(std::move(headerIcons));

    auto itemLabelHeader = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label_header"), "Item Label");
    itemLabelHeader->setFontSize(11.0f);
    itemLabelHeader->setColor(headerTextColor);
    itemLabelHeader->setWidth(ui::SizeValue::flex(1.0f));
    itemLabelHeader->setClipContent(true);
    columnHeader->addChild(std::move(itemLabelHeader));

    auto typeHeader = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_type_header"), "Type");
    typeHeader->setFontSize(11.0f);
    typeHeader->setColor(headerTextColor);
    typeHeader->setWidth(ui::SizeValue::px(80.0f));
    columnHeader->addChild(std::move(typeHeader));

    columnHeader_ = columnHeader.get();
    rootPanel->addChild(std::move(columnHeader));

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

    auto statusBar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_status"));
    statusBar->setHeight(ui::SizeValue::px(24.0f));
    statusBar->setWidth(ui::SizeValue::flex(1.0f));
    statusBar->setPadding(ui::Insets(4.0f, 8.0f, 4.0f, 8.0f));
    statusBar->setDrawBackground(true);
    statusBar->setBackgroundColor(toolbarBg);
    statusBar->setBorderColor(borderColor);
    statusBar->setBorderWidth(ui::BorderWidth(1.0f, 0.0f, 0.0f, 0.0f));

    auto entityCountLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_count"), "0 entities");
    entityCountLabel->setFontSize(11.0f);
    entityCountLabel->setColor({0.6f, 0.6f, 0.6f, 1.0f});
    entityCountLabel_ = entityCountLabel.get();
    statusBar->addChild(std::move(entityCountLabel));

    statusBar_ = statusBar.get();
    rootPanel->addChild(std::move(statusBar));

    rootPanel_ = rootPanel.get();
    setContent(std::move(rootPanel));
}

void HierarchyPanel::onSearchTextChanged(const std::string& text) {
    searchFilter_ = text;
    rebuildTree();
}

// =============================================================================
// Widget Interface
// =============================================================================

void HierarchyPanel::render(ui::UIBatchRenderer& renderer) {
    DockPanel::render(renderer);
}

bool HierarchyPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button == ui::MouseButton::Right) {
        if (scrollView_ && scrollView_->getBounds().contains(event.x, event.y)) {
            contextMenuTargetEntity_ = INVALID_ENTITY;

            contextMenu_->clearItems();
            contextMenu_->addItem(ui::MenuItem::action("create_entity", "Create Empty Entity", ui::icons::Plus));
            contextMenu_->addItem(ui::MenuItem::action("create_folder", "Create Folder", ui::icons::FolderPlus));
            contextMenu_->addItem(ui::MenuItem::divider());
            contextMenu_->addItem(ui::MenuItem::action("paste", "Paste", ui::icons::Clipboard, "Ctrl+V"));

            if (getContext()) {
                getContext()->addOverlay(contextMenu_.get());
            }
            contextMenu_->show(event.x, event.y);
            return true;
        }
    }

    return DockPanel::onMouseDown(event);
}

bool HierarchyPanel::onKeyDown(const ui::KeyEvent& event) {
    if (event.key == KeyCode::Delete) {
        deleteSelectedEntity();
        return true;
    }

    if (event.ctrl && event.key == KeyCode::D) {
        // TODO: Duplicate selected entity
        ES_LOG_INFO("Duplicate entity: not yet implemented");
        return true;
    }

    return DockPanel::onKeyDown(event);
}

// =============================================================================
// Public Methods
// =============================================================================

void HierarchyPanel::refresh() {
    rebuildTree();
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

    // Sort entities by name for consistent ordering
    std::sort(allEntities.begin(), allEntities.end(), [this](Entity a, Entity b) {
        std::string nameA = getEntityDisplayName(a);
        std::string nameB = getEntityDisplayName(b);
        return nameA < nameB;
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

    updateStatusBar();
}

ui::TreeNodeId HierarchyPanel::addEntityToTree(Entity entity, ui::TreeNodeId parentNodeId) {
    std::string displayName = getEntityDisplayName(entity);

    ui::TreeNodeId nodeId = treeView_->addNode(parentNodeId, displayName);

    treeView_->setNodeIcon(nodeId, getEntityIcon(entity));
    treeView_->setNodeType(nodeId, getEntityType(entity));

    nodeToEntity_[nodeId] = entity;
    entityToNode_[entity] = nodeId;

    // Add children if entity has Children component
    if (registry_.has<ecs::Children>(entity)) {
        const auto& children = registry_.get<ecs::Children>(entity);

        // Sort children by name for consistent ordering
        std::vector<Entity> sortedChildren;
        for (Entity childEntity : children.entities) {
            if (registry_.valid(childEntity)) {
                sortedChildren.push_back(childEntity);
            } else {
                ES_LOG_WARN("HierarchyPanel: Invalid child entity {} for parent {}",
                            childEntity, entity);
            }
        }
        std::sort(sortedChildren.begin(), sortedChildren.end(), [this](Entity a, Entity b) {
            return getEntityDisplayName(a) < getEntityDisplayName(b);
        });

        for (Entity childEntity : sortedChildren) {
            addEntityToTree(childEntity, nodeId);
        }

        // Expand node if it has children
        if (!sortedChildren.empty()) {
            treeView_->setNodeExpanded(nodeId, true);
        }
    }

    return nodeId;
}

std::string HierarchyPanel::getEntityDisplayName(Entity entity) const {
    if (registry_.has<ecs::Name>(entity)) {
        const auto& name = registry_.get<ecs::Name>(entity);
        if (!name.value.empty()) {
            return name.value;
        }
    }

    std::ostringstream oss;
    oss << "Entity " << entity;
    return oss.str();
}

std::string HierarchyPanel::getEntityIcon(Entity entity) const {
    if (registry_.has<ecs::Folder>(entity)) {
        return ui::icons::Folder;
    }
    if (registry_.has<ecs::Camera>(entity)) {
        return ui::icons::Camera;
    }
    if (registry_.has<ecs::Sprite>(entity)) {
        return ui::icons::Image;
    }
    return ui::icons::Box;
}

std::string HierarchyPanel::getEntityType(Entity entity) const {
    if (registry_.has<ecs::Folder>(entity)) {
        return "Folder";
    }
    if (registry_.has<ecs::Camera>(entity)) {
        return "Camera";
    }
    if (registry_.has<ecs::Sprite>(entity)) {
        return "Sprite";
    }
    return "Entity";
}

// =============================================================================
// Event Handlers
// =============================================================================

void HierarchyPanel::onNodeSelected(ui::TreeNodeId nodeId) {
    if (processingSelection_) {
        return;
    }

    Entity entity = getEntityForNode(nodeId);
    if (entity == INVALID_ENTITY) {
        return;
    }

    if (!selection_.isSelected(entity)) {
        processingSelection_ = true;
        selection_.select(entity);
        processingSelection_ = false;
    }
}

void HierarchyPanel::onNodeDoubleClicked(ui::TreeNodeId nodeId) {
    (void)nodeId;
}

void HierarchyPanel::onNodeRightClicked(ui::TreeNodeId nodeId, f32 x, f32 y) {
    ES_LOG_DEBUG("HierarchyPanel::onNodeRightClicked nodeId={} x={} y={}", nodeId, x, y);

    Entity entity = getEntityForNode(nodeId);
    if (entity == INVALID_ENTITY) {
        ES_LOG_DEBUG("  -> entity not found for node");
        return;
    }

    contextMenuTargetEntity_ = entity;

    contextMenu_->clearItems();
    contextMenu_->addItem(ui::MenuItem::action("create_entity", "Create Empty Entity", ui::icons::Plus));
    contextMenu_->addItem(ui::MenuItem::action("create_child", "Create Child Entity", ui::icons::Plus));
    contextMenu_->addItem(ui::MenuItem::action("create_folder", "Create Folder", ui::icons::FolderPlus));
    contextMenu_->addItem(ui::MenuItem::divider());
    contextMenu_->addItem(ui::MenuItem::action("rename", "Rename", ui::icons::Edit2, "F2"));
    contextMenu_->addItem(ui::MenuItem::action("duplicate", "Duplicate", ui::icons::Copy, "Ctrl+D"));
    contextMenu_->addItem(ui::MenuItem::divider());
    contextMenu_->addItem(ui::MenuItem::action("delete", "Delete", ui::icons::Trash2, "Del"));

    if (getContext()) {
        getContext()->addOverlay(contextMenu_.get());
    }
    contextMenu_->show(x, y);
}

void HierarchyPanel::onContextMenuItemSelected(const std::string& itemId) {
    if (getContext()) {
        getContext()->removeOverlay(contextMenu_.get());
    }

    if (itemId == "create_entity") {
        createEntity();
    } else if (itemId == "create_child") {
        if (contextMenuTargetEntity_ != INVALID_ENTITY) {
            createChildEntity(contextMenuTargetEntity_);
        }
    } else if (itemId == "create_folder") {
        createFolder();
    } else if (itemId == "rename") {
        renameSelectedEntity();
    } else if (itemId == "duplicate") {
        // TODO: Implement entity duplication
        ES_LOG_INFO("Duplicate entity: not yet implemented");
    } else if (itemId == "delete") {
        deleteSelectedEntity();
    }

    contextMenuTargetEntity_ = INVALID_ENTITY;
}

void HierarchyPanel::onSelectionChanged(const std::vector<Entity>& previous,
                                         const std::vector<Entity>& current) {
    if (!treeView_ || processingSelection_) {
        return;
    }

    processingSelection_ = true;

    for (Entity entity : previous) {
        auto it = entityToNode_.find(entity);
        if (it != entityToNode_.end()) {
            treeView_->deselectNode(it->second);
        }
    }

    for (Entity entity : current) {
        auto it = entityToNode_.find(entity);
        if (it != entityToNode_.end()) {
            treeView_->selectNode(it->second, false);
        }
    }

    processingSelection_ = false;
}

// =============================================================================
// Entity Operations
// =============================================================================

void HierarchyPanel::createEntity() {
    Entity entity = registry_.create();

    registry_.emplace<ecs::Name>(entity, ecs::Name{"Entity"});
    registry_.emplace<ecs::LocalTransform>(entity);

    rebuildTree();
    selection_.select(entity);

    ES_LOG_DEBUG("Created entity: {}", entity);
}

void HierarchyPanel::createChildEntity(Entity parent) {
    if (!registry_.valid(parent)) {
        return;
    }

    Entity child = registry_.create();
    registry_.emplace<ecs::Name>(child, ecs::Name{"Entity"});
    registry_.emplace<ecs::LocalTransform>(child);
    registry_.emplace<ecs::Parent>(child, parent);

    if (!registry_.has<ecs::Children>(parent)) {
        registry_.emplace<ecs::Children>(parent);
    }
    registry_.get<ecs::Children>(parent).entities.push_back(child);

    rebuildTree();
    selection_.select(child);

    ES_LOG_DEBUG("Created child entity: {} under parent: {}", child, parent);
}

void HierarchyPanel::createFolder() {
    Entity folder = registry_.create();
    registry_.emplace<ecs::Name>(folder, ecs::Name{"Folder"});
    registry_.emplace<ecs::Folder>(folder);

    rebuildTree();
    selection_.select(folder);

    ES_LOG_DEBUG("Created folder entity: {}", folder);
}

void HierarchyPanel::deleteSelectedEntity() {
    if (selection_.empty()) {
        return;
    }

    Entity entity = selection_.getFirst();
    if (!registry_.valid(entity)) {
        return;
    }

    selection_.clear();

    if (registry_.has<ecs::Parent>(entity)) {
        Entity parent = registry_.get<ecs::Parent>(entity).entity;
        if (registry_.valid(parent) && registry_.has<ecs::Children>(parent)) {
            auto& siblings = registry_.get<ecs::Children>(parent).entities;
            siblings.erase(std::remove(siblings.begin(), siblings.end(), entity), siblings.end());
        }
    }

    if (registry_.has<ecs::Children>(entity)) {
        auto children = registry_.get<ecs::Children>(entity).entities;
        for (Entity child : children) {
            if (registry_.valid(child)) {
                registry_.destroy(child);
            }
        }
    }

    registry_.destroy(entity);
    rebuildTree();

    ES_LOG_DEBUG("Deleted entity: {}", entity);
}

void HierarchyPanel::renameSelectedEntity() {
    // TODO: Implement inline renaming via TreeView
    ES_LOG_INFO("Rename entity: not yet implemented");
}

void HierarchyPanel::updateStatusBar() {
    if (!entityCountLabel_) return;

    usize count = registry_.entityCount();
    std::ostringstream oss;
    oss << count << (count == 1 ? " entity" : " entities");
    entityCountLabel_->setText(oss.str());
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
