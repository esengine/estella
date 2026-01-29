/**
 * @file    AssetBrowserPanel.cpp
 * @brief   Asset browser panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "AssetBrowserPanel.hpp"
#include "AssetGridItem.hpp"
#include "../AssetDatabase.hpp"
#include "../ThumbnailGenerator.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/layout/WrapLayout.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../platform/FileDialog.hpp"
#include "../../platform/PathResolver.hpp"
#include "../../core/Log.hpp"
#include "../../events/Sink.hpp"
#include "../../ui/icons/Icons.hpp"

namespace icons = esengine::ui::icons;

#include <algorithm>
#include <fstream>
#include <cctype>
#include <filesystem>

namespace esengine::editor {

// =============================================================================
// Constructor / Destructor
// =============================================================================

AssetBrowserPanel::AssetBrowserPanel(AssetDatabase& assetDB, ThumbnailGenerator& thumbnailGen)
    : DockPanel(ui::WidgetId("asset_browser_panel"), "Assets"),
      assetDB_(assetDB),
      thumbnailGen_(thumbnailGen) {

    setPanelType("AssetBrowser");
    setClosable(true);
    setMinSize(glm::vec2(400.0f, 250.0f));

    rootPath_ = assetDB_.getProjectPath();
    if (rootPath_.empty()) {
        rootPath_ = "assets";
    }
    currentPath_ = rootPath_;

    engineResourcesPath_ = PathResolver::editorPath("data");
    ES_LOG_INFO("AssetBrowserPanel: rootPath = {}", rootPath_);
    ES_LOG_INFO("AssetBrowserPanel: engineResourcesPath = {}", engineResourcesPath_);
    ES_LOG_INFO("AssetBrowserPanel: directoryExists = {}", FileSystem::directoryExists(rootPath_));

    buildUI();

#ifndef ES_PLATFORM_WEB
    rebuildFolderTree();
    refreshAssetList();
    rebuildBreadcrumb();
#endif
}

AssetBrowserPanel::~AssetBrowserPanel() = default;

// =============================================================================
// Public Methods
// =============================================================================

void AssetBrowserPanel::refresh() {
    needsRebuild_ = true;
}

void AssetBrowserPanel::setRootPath(const std::string& path) {
    if (rootPath_ != path) {
        rootPath_ = path;
        currentPath_ = rootPath_;
        rebuildFolderTree();
        refreshAssetList();
    }
}

void AssetBrowserPanel::setViewMode(AssetViewMode mode) {
    if (viewMode_ != mode) {
        viewMode_ = mode;
        updateViewModeButtons();
        refreshAssetList();
    }
}

void AssetBrowserPanel::onActivated() {
    if (needsRebuild_) {
        rebuildFolderTree();
        refreshAssetList();
        needsRebuild_ = false;
    }
}

void AssetBrowserPanel::render(ui::UIBatchRenderer& renderer) {
    if (needsRefreshAssetList_) {
        needsRefreshAssetList_ = false;
        currentPath_ = pendingNavigatePath_;
        refreshAssetList();
        rebuildBreadcrumb();

        auto it = pathToNode_.find(pendingNavigatePath_);
        if (it != pathToNode_.end()) {
            folderTree_->selectNode(it->second);
            folderTree_->setNodeExpanded(it->second, true);
        }
        pendingNavigatePath_.clear();
    }

    DockPanel::render(renderer);
}

// =============================================================================
// UI Building
// =============================================================================

void AssetBrowserPanel::buildUI() {
    constexpr glm::vec4 panelBg{0.145f, 0.145f, 0.149f, 1.0f};
    constexpr glm::vec4 toolbarBg{0.176f, 0.176f, 0.188f, 1.0f};
    constexpr glm::vec4 mainBg{0.118f, 0.118f, 0.118f, 1.0f};
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};
    constexpr glm::vec4 buttonBg{0.235f, 0.235f, 0.235f, 1.0f};
    constexpr glm::vec4 primaryBg{0.231f, 0.510f, 0.965f, 1.0f};

    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 0.0f));
    rootPanel->setDrawBackground(true);
    rootPanel->setBackgroundColor(mainBg);

    auto leftPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_left"));
    leftPanel->setWidth(ui::SizeValue::px(200.0f));
    leftPanel->setHeight(ui::SizeValue::flex(1.0f));
    leftPanel->setDrawBackground(true);
    leftPanel->setBackgroundColor(panelBg);
    leftPanel->setBorderColor(borderColor);
    leftPanel->setBorderWidth(ui::BorderWidth(0.0f, 1.0f, 0.0f, 0.0f));

    auto leftScrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_left_scroll"));
    leftScrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    leftScrollView->setWidth(ui::SizeValue::flex(1.0f));
    leftScrollView->setHeight(ui::SizeValue::flex(1.0f));

    auto folderTree = makeUnique<ui::TreeView>(ui::WidgetId(getId().path + "_folder_tree"));
    folderTree->setMultiSelect(false);
    folderTree->setRowHeight(24.0f);
    folderTree->setIndentSize(16.0f);
    folderTree->setShowVisibilityColumn(false);
    folderTree->setShowTypeColumn(false);
    folderTree->setWidth(ui::SizeValue::flex(1.0f));
    folderTree->setHeight(ui::SizeValue::autoSize());
    folderTree_ = folderTree.get();

    leftScrollView->setContent(std::move(folderTree));
    leftPanel->addChild(std::move(leftScrollView));

    leftPanel_ = leftPanel.get();
    rootPanel->addChild(std::move(leftPanel));

    auto rightPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_right"));
    rightPanel->setWidth(ui::SizeValue::flex(1.0f));
    rightPanel->setHeight(ui::SizeValue::flex(1.0f));
    rightPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f));
    rightPanel->setDrawBackground(true);
    rightPanel->setBackgroundColor(mainBg);

    auto toolbar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_toolbar"));
    toolbar->setHeight(ui::SizeValue::px(38.0f));
    toolbar->setWidth(ui::SizeValue::flex(1.0f));
    toolbar->setPadding(ui::Insets(6.0f, 12.0f, 6.0f, 12.0f));
    toolbar->setDrawBackground(true);
    toolbar->setBackgroundColor(toolbarBg);
    toolbar->setBorderColor(borderColor);
    toolbar->setBorderWidth(ui::BorderWidth(0.0f, 0.0f, 1.0f, 0.0f));
    toolbar->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 8.0f));

    auto addBtn = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_add_btn"), icons::Plus);
    addBtn->setFontSize(14.0f);
    addBtn->setWidth(ui::SizeValue::px(32.0f));
    addBtn->setHeight(ui::SizeValue::px(26.0f));
    addBtn->setBackgroundColor(primaryBg);
    addBtn->setHoverColor({0.149f, 0.388f, 0.933f, 1.0f});
    toolbarConnections_.add(sink(addBtn->onClick).connect([this]() {
        if (getContext()) {
            contextMenu_->clearItems();
            contextMenu_->addItem(ui::MenuItem::action("create_folder", "New Folder", icons::FolderPlus));
            contextMenu_->addItem(ui::MenuItem::divider());
            contextMenu_->addItem(ui::MenuItem::action("create_scene", "New Scene", icons::Layers));
            contextMenu_->addItem(ui::MenuItem::action("create_script", "New Script", icons::File));
            getContext()->addOverlay(contextMenu_.get());
            auto bounds = getContentBounds();
            contextMenu_->show(bounds.x + 12.0f, bounds.y + 44.0f);
        }
    }));
    toolbar->addChild(std::move(addBtn));

    auto importBtn = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_import_btn"), icons::Download);
    importBtn->setFontSize(14.0f);
    importBtn->setWidth(ui::SizeValue::px(32.0f));
    importBtn->setHeight(ui::SizeValue::px(26.0f));
    importBtn->setBackgroundColor(buttonBg);
    importBtn->setHoverColor({0.3f, 0.3f, 0.3f, 1.0f});
    toolbarConnections_.add(sink(importBtn->onClick).connect([this]() { importAsset(); }));
    toolbar->addChild(std::move(importBtn));

    auto refreshBtn = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_refresh_btn"), icons::Refresh);
    refreshBtn->setFontSize(14.0f);
    refreshBtn->setWidth(ui::SizeValue::px(32.0f));
    refreshBtn->setHeight(ui::SizeValue::px(26.0f));
    refreshBtn->setBackgroundColor(buttonBg);
    refreshBtn->setHoverColor({0.3f, 0.3f, 0.3f, 1.0f});
    toolbarConnections_.add(sink(refreshBtn->onClick).connect([this]() {
        rebuildFolderTree();
        refreshAssetList();
    }));
    toolbar->addChild(std::move(refreshBtn));

    auto breadcrumbPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_breadcrumb"));
    breadcrumbPanel->setWidth(ui::SizeValue::flex(1.0f));
    breadcrumbPanel->setHeight(ui::SizeValue::px(26.0f));
    breadcrumbPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 2.0f));
    breadcrumbPanel->setDrawBackground(false);
    breadcrumbPanel_ = breadcrumbPanel.get();
    toolbar->addChild(std::move(breadcrumbPanel));

    auto searchField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_search"));
    searchField->setPlaceholder("Search...");
    searchField->setWidth(ui::SizeValue::px(150.0f));
    searchField->setHeight(ui::SizeValue::px(26.0f));
    searchField_ = searchField.get();
    toolbar->addChild(std::move(searchField));

    auto viewModePanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_viewmode"));
    viewModePanel->setWidth(ui::SizeValue::autoSize());
    viewModePanel->setHeight(ui::SizeValue::px(26.0f));
    viewModePanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 0.0f));
    viewModePanel->setDrawBackground(false);

    auto gridBtn = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_grid_btn"), icons::LayoutGrid);
    gridBtn->setFontSize(14.0f);
    gridBtn->setWidth(ui::SizeValue::px(28.0f));
    gridBtn->setHeight(ui::SizeValue::px(26.0f));
    gridBtn->setBackgroundColor(viewMode_ == AssetViewMode::Grid ? buttonBg : glm::vec4(0.0f));
    gridBtn->setHoverColor({0.3f, 0.3f, 0.3f, 1.0f});
    toolbarConnections_.add(sink(gridBtn->onClick).connect([this]() { setViewMode(AssetViewMode::Grid); }));
    viewModePanel->addChild(std::move(gridBtn));

    auto listBtn = makeUnique<ui::Button>(ui::WidgetId(getId().path + "_list_btn"), icons::List);
    listBtn->setFontSize(14.0f);
    listBtn->setWidth(ui::SizeValue::px(28.0f));
    listBtn->setHeight(ui::SizeValue::px(26.0f));
    listBtn->setBackgroundColor(viewMode_ == AssetViewMode::List ? buttonBg : glm::vec4(0.0f));
    listBtn->setHoverColor({0.3f, 0.3f, 0.3f, 1.0f});
    toolbarConnections_.add(sink(listBtn->onClick).connect([this]() { setViewMode(AssetViewMode::List); }));
    viewModePanel->addChild(std::move(listBtn));

    viewModePanel_ = viewModePanel.get();
    toolbar->addChild(std::move(viewModePanel));

    rightPanel->addChild(std::move(toolbar));

    auto scrollView = makeUnique<ui::ScrollView>(ui::WidgetId(getId().path + "_scroll"));
    scrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    scrollView->setWidth(ui::SizeValue::flex(1.0f));
    scrollView->setHeight(ui::SizeValue::flex(1.0f));

    auto gridPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_grid"));
    gridPanel->setDrawBackground(false);
    gridPanel->setWidth(ui::SizeValue::flex(1.0f));
    gridPanel->setHeight(ui::SizeValue::autoSize());
    gridPanel->setLayout(makeUnique<ui::WrapLayout>(8.0f, 8.0f));
    gridPanel->setPadding(ui::Insets::all(12.0f));
    assetGridPanel_ = gridPanel.get();
    scrollView->setContent(std::move(gridPanel));

    assetScrollView_ = scrollView.get();
    rightPanel->addChild(std::move(scrollView));

    auto statusBar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_status"));
    statusBar->setHeight(ui::SizeValue::px(24.0f));
    statusBar->setWidth(ui::SizeValue::flex(1.0f));
    statusBar->setPadding(ui::Insets(4.0f, 12.0f, 4.0f, 12.0f));
    statusBar->setDrawBackground(true);
    statusBar->setBackgroundColor(panelBg);
    statusBar->setBorderColor(borderColor);
    statusBar->setBorderWidth(ui::BorderWidth(1.0f, 0.0f, 0.0f, 0.0f));

    auto statusLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_status_label"), "0 items");
    statusLabel->setFontSize(11.0f);
    statusLabel->setColor({0.6f, 0.6f, 0.6f, 1.0f});
    statusLabel_ = statusLabel.get();
    statusBar->addChild(std::move(statusLabel));

    rightPanel->addChild(std::move(statusBar));

    rightPanel_ = rightPanel.get();
    rootPanel->addChild(std::move(rightPanel));

    setContent(std::move(rootPanel));

    folderSelectedConnection_ = sink(folderTree_->onNodeSelected).connect(
        [this](ui::TreeNodeId nodeId) { onFolderSelected(nodeId); }
    );

    searchChangedConnection_ = sink(searchField_->onTextChanged).connect(
        [this](const std::string& text) { onSearchTextChanged(text); }
    );

    contextMenu_ = makeUnique<ui::ContextMenu>(ui::WidgetId("asset_browser_context_menu"));
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
}

// =============================================================================
// Directory Scanning
// =============================================================================

void AssetBrowserPanel::rebuildFolderTree() {
#ifdef ES_PLATFORM_WEB
    auto label = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_web_msg"), "N/A on Web");
    label->setFontSize(12.0f);
    leftPanel_->clearChildren();
    leftPanel_->addChild(std::move(label));
    return;
#endif

    folderTree_->clear();
    nodeToPath_.clear();
    pathToNode_.clear();
    engineNodes_.clear();

    if (!FileSystem::directoryExists(rootPath_)) {
        ES_LOG_WARN("Asset root path does not exist: {}", rootPath_);
        return;
    }

    ui::TreeNodeId projectNodeId = folderTree_->addNode(ui::INVALID_TREE_NODE, "Project");
    nodeToPath_[projectNodeId] = rootPath_;
    pathToNode_[rootPath_] = projectNodeId;

    addFolderNodes(rootPath_, projectNodeId);

    folderTree_->setNodeExpanded(projectNodeId, true);
    folderTree_->selectNode(projectNodeId);

    if (FileSystem::directoryExists(engineResourcesPath_)) {
        ui::TreeNodeId engineNodeId = folderTree_->addNode(ui::INVALID_TREE_NODE, "Engine");
        nodeToPath_[engineNodeId] = engineResourcesPath_;
        pathToNode_[engineResourcesPath_] = engineNodeId;
        engineNodes_.insert(engineNodeId);

        addFolderNodes(engineResourcesPath_, engineNodeId, true);
    }
}

void AssetBrowserPanel::addFolderNodes(const std::string& path, ui::TreeNodeId parentNode, bool isEngine) {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::vector<std::string> entries = FileSystem::listDirectory(path, false);
    ES_LOG_INFO("AssetBrowserPanel::addFolderNodes: {} has {} entries", path, entries.size());

    for (const auto& entry : entries) {
        if (FileSystem::directoryExists(entry)) {
            std::string folderName = getFileName(entry);
            ES_LOG_DEBUG("  Found folder: {}", folderName);

            ui::TreeNodeId nodeId = folderTree_->addNode(parentNode, folderName);
            nodeToPath_[nodeId] = entry;
            pathToNode_[entry] = nodeId;

            if (isEngine) {
                engineNodes_.insert(nodeId);
            }

            addFolderNodes(entry, nodeId, isEngine);
        }
    }
}

void AssetBrowserPanel::refreshAssetList() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    itemConnections_.disconnectAll();
    currentAssets_.clear();
    assetGridPanel_->clearChildren();

    if (!FileSystem::directoryExists(currentPath_)) {
        ES_LOG_WARN("AssetBrowserPanel::refreshAssetList: directory not found: {}", currentPath_);
        return;
    }

    std::vector<std::string> files = FileSystem::listDirectory(currentPath_, false);
    ES_LOG_INFO("AssetBrowserPanel::refreshAssetList: {} has {} items", currentPath_, files.size());

    for (const auto& filePath : files) {
        AssetEntry entry;
        entry.path = filePath;
        entry.name = getFileName(filePath);
        entry.extension = getFileExtension(filePath);
        entry.isDirectory = FileSystem::directoryExists(filePath);

        if (entry.isDirectory) {
            entry.type = AssetType::Folder;
        } else {
            entry.type = getAssetTypeFromExtension(entry.extension);
            entry.fileSize = FileSystem::getFileSize(filePath);
            entry.modificationTime = FileSystem::getFileModificationTime(filePath);
        }

        if (!searchFilter_.empty()) {
            std::string lowerName = toLower(entry.name);
            std::string lowerFilter = toLower(searchFilter_);
            if (lowerName.find(lowerFilter) == std::string::npos) {
                continue;
            }
        }

        currentAssets_.push_back(entry);
    }

    std::sort(currentAssets_.begin(), currentAssets_.end(),
        [](const AssetEntry& a, const AssetEntry& b) {
            if (a.isDirectory != b.isDirectory) {
                return a.isDirectory;
            }
            return a.name < b.name;
        });

    for (usize i = 0; i < currentAssets_.size(); ++i) {
        const auto& entry = currentAssets_[i];

        auto item = makeUnique<AssetGridItem>(
            ui::WidgetId::indexed(assetGridPanel_->getId().path, "item", static_cast<u32>(i)),
            entry
        );

        itemConnections_.add(sink(item->onClick).connect([this](const std::string& path) {
            onAssetItemClicked(path);
        }));

        itemConnections_.add(sink(item->onDoubleClick).connect([this](const std::string& path) {
            onAssetItemDoubleClicked(path);
        }));

        assetGridPanel_->addChild(std::move(item));
    }

    ES_LOG_INFO("AssetBrowserPanel::refreshAssetList: added {} items to grid", currentAssets_.size());

    if (statusLabel_) {
        usize count = currentAssets_.size();
        std::string text = std::to_string(count) + (count == 1 ? " item" : " items");
        if (browsingEngineResources_) {
            text += " (Read-only)";
        }
        statusLabel_->setText(text);
    }
}

// =============================================================================
// Event Handlers
// =============================================================================

void AssetBrowserPanel::onFolderSelected(ui::TreeNodeId nodeId) {
    auto it = nodeToPath_.find(nodeId);
    if (it != nodeToPath_.end()) {
        if (currentPath_ != it->second) {
            currentPath_ = it->second;
            browsingEngineResources_ = (engineNodes_.find(nodeId) != engineNodes_.end());
            refreshAssetList();
            rebuildBreadcrumb();
        }
    }
}

void AssetBrowserPanel::onSearchTextChanged(const std::string& text) {
    searchFilter_ = text;
    refreshAssetList();
}

void AssetBrowserPanel::onAssetItemClicked(const std::string& path) {
    selectedAssetPath_ = path;

    for (auto& child : assetGridPanel_->getChildren()) {
        auto* item = dynamic_cast<AssetGridItem*>(child.get());
        if (item) {
            item->setSelected(item->getEntry().path == path);
        }
    }

    onAssetSelected.publish(path);
}

void AssetBrowserPanel::onAssetItemDoubleClicked(const std::string& path) {
    // Copy path - the source object will be destroyed when we refresh
    std::string pathCopy = path;

    if (FileSystem::directoryExists(pathCopy)) {
        // Defer the refresh to avoid deleting the object that's currently handling the event
        pendingNavigatePath_ = pathCopy;
        needsRefreshAssetList_ = true;
    } else {
        onAssetDoubleClicked.publish(pathCopy);
    }
}

bool AssetBrowserPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button == ui::MouseButton::Right) {
        if (assetScrollView_ && assetScrollView_->getBounds().contains(event.x, event.y)) {
            contextMenu_->clearItems();

            if (!browsingEngineResources_) {
                contextMenu_->addItem(ui::MenuItem::action("create_folder", "New Folder", ui::icons::FolderPlus));
                contextMenu_->addItem(ui::MenuItem::divider());
                contextMenu_->addItem(ui::MenuItem::action("create_scene", "New Scene", ui::icons::Layers));
                contextMenu_->addItem(ui::MenuItem::action("create_script", "New Script", ui::icons::File));
                contextMenu_->addItem(ui::MenuItem::divider());

                if (!selectedAssetPath_.empty()) {
                    contextMenu_->addItem(ui::MenuItem::action("rename", "Rename", ui::icons::Edit2, "F2"));
                    contextMenu_->addItem(ui::MenuItem::action("delete", "Delete", ui::icons::Trash2, "Del"));
                    contextMenu_->addItem(ui::MenuItem::divider());
                }
            }

            contextMenu_->addItem(ui::MenuItem::action("refresh", "Refresh", ui::icons::Refresh));

            if (getContext()) {
                getContext()->addOverlay(contextMenu_.get());
            }
            contextMenu_->show(event.x, event.y);
            return true;
        }
    }

    return DockPanel::onMouseDown(event);
}

void AssetBrowserPanel::onContextMenuItemSelected(const std::string& itemId) {
    if (getContext()) {
        getContext()->removeOverlay(contextMenu_.get());
    }

    if (itemId == "create_folder") {
        createFolder();
    } else if (itemId == "create_scene") {
        createScene();
    } else if (itemId == "create_script") {
        createScript();
    } else if (itemId == "rename") {
        renameSelectedAsset();
    } else if (itemId == "delete") {
        deleteSelectedAsset();
    } else if (itemId == "refresh") {
        rebuildFolderTree();
        refreshAssetList();
    }
}

void AssetBrowserPanel::createFolder() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string baseName = "New Folder";
    std::string folderPath = currentPath_ + "/" + baseName;

    i32 counter = 1;
    while (FileSystem::directoryExists(folderPath)) {
        folderPath = currentPath_ + "/" + baseName + " " + std::to_string(counter);
        ++counter;
    }

    if (FileSystem::createDirectory(folderPath)) {
        rebuildFolderTree();
        refreshAssetList();
        ES_LOG_INFO("Created folder: {}", folderPath);
    } else {
        ES_LOG_ERROR("Failed to create folder: {}", folderPath);
    }
}

void AssetBrowserPanel::createScene() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string baseName = "New Scene";
    std::string scenePath = currentPath_ + "/" + baseName + ".scene";

    i32 counter = 1;
    while (FileSystem::fileExists(scenePath)) {
        scenePath = currentPath_ + "/" + baseName + " " + std::to_string(counter) + ".scene";
        ++counter;
    }

    std::ofstream file(scenePath);
    if (file.is_open()) {
        file << "{\n";
        file << "  \"version\": 1,\n";
        file << "  \"name\": \"" << getFileName(scenePath) << "\",\n";
        file << "  \"entities\": []\n";
        file << "}\n";
        file.close();

        refreshAssetList();
        ES_LOG_INFO("Created scene: {}", scenePath);
    } else {
        ES_LOG_ERROR("Failed to create scene: {}", scenePath);
    }
}

void AssetBrowserPanel::createScript() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string baseName = "NewScript";
    std::string scriptPath = currentPath_ + "/" + baseName + ".js";

    i32 counter = 1;
    while (FileSystem::fileExists(scriptPath)) {
        scriptPath = currentPath_ + "/" + baseName + std::to_string(counter) + ".js";
        ++counter;
    }

    std::ofstream file(scriptPath);
    if (file.is_open()) {
        file << "// " << getFileName(scriptPath) << "\n";
        file << "\n";
        file << "export default class {\n";
        file << "    onStart() {\n";
        file << "        // Called when the entity is created\n";
        file << "    }\n";
        file << "\n";
        file << "    onUpdate(deltaTime) {\n";
        file << "        // Called every frame\n";
        file << "    }\n";
        file << "}\n";
        file.close();

        refreshAssetList();
        ES_LOG_INFO("Created script: {}", scriptPath);
    } else {
        ES_LOG_ERROR("Failed to create script: {}", scriptPath);
    }
}

void AssetBrowserPanel::deleteSelectedAsset() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    if (selectedAssetPath_.empty()) {
        return;
    }

    std::error_code ec;
    bool success = false;

    if (FileSystem::directoryExists(selectedAssetPath_)) {
        success = std::filesystem::remove_all(selectedAssetPath_, ec) > 0;
    } else if (FileSystem::fileExists(selectedAssetPath_)) {
        success = std::filesystem::remove(selectedAssetPath_, ec);
    }

    if (success && !ec) {
        ES_LOG_INFO("Deleted: {}", selectedAssetPath_);
        selectedAssetPath_.clear();
        rebuildFolderTree();
        refreshAssetList();
    } else {
        ES_LOG_ERROR("Failed to delete: {} ({})", selectedAssetPath_, ec.message());
    }
}

void AssetBrowserPanel::renameSelectedAsset() {
    // TODO: Implement inline renaming
    ES_LOG_INFO("Rename asset: not yet implemented");
}

// =============================================================================
// Utility Methods
// =============================================================================

std::string AssetBrowserPanel::getFileName(const std::string& path) const {
    usize pos = path.find_last_of("/\\");
    if (pos != std::string::npos) {
        return path.substr(pos + 1);
    }
    return path;
}

std::string AssetBrowserPanel::getFileExtension(const std::string& path) const {
    usize pos = path.find_last_of('.');
    if (pos != std::string::npos) {
        return path.substr(pos);
    }
    return "";
}

std::string AssetBrowserPanel::toLower(const std::string& str) const {
    std::string result = str;
    std::transform(result.begin(), result.end(), result.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return result;
}

void AssetBrowserPanel::rebuildBreadcrumb() {
    if (!breadcrumbPanel_) return;

    breadcrumbConnections_.disconnectAll();
    breadcrumbPanel_->clearChildren();

    std::string actualRoot = browsingEngineResources_ ? engineResourcesPath_ : rootPath_;
    std::string rootDisplayName = browsingEngineResources_ ? "Engine" : "Project";

    std::string normalizedCurrent = currentPath_;
    std::string normalizedRoot = actualRoot;
    for (char& c : normalizedCurrent) { if (c == '\\') c = '/'; }
    for (char& c : normalizedRoot) { if (c == '\\') c = '/'; }

    std::vector<std::pair<std::string, std::string>> segments;
    segments.emplace_back(rootDisplayName, actualRoot);

    if (normalizedCurrent.size() > normalizedRoot.size() &&
        normalizedCurrent.substr(0, normalizedRoot.size()) == normalizedRoot) {
        std::string relativePath = normalizedCurrent.substr(normalizedRoot.size());
        if (!relativePath.empty() && relativePath[0] == '/') {
            relativePath = relativePath.substr(1);
        }

        std::string accumulated = actualRoot;
        std::string segment;
        for (char c : relativePath) {
            if (c == '/') {
                if (!segment.empty()) {
                    accumulated += "/" + segment;
                    segments.emplace_back(segment, accumulated);
                    segment.clear();
                }
            } else {
                segment += c;
            }
        }
        if (!segment.empty()) {
            accumulated += "/" + segment;
            segments.emplace_back(segment, accumulated);
        }
    }

    constexpr glm::vec4 textColor{0.6f, 0.6f, 0.6f, 1.0f};
    constexpr glm::vec4 sepColor{0.4f, 0.4f, 0.4f, 1.0f};

    for (usize i = 0; i < segments.size(); ++i) {
        const auto& [name, fullPath] = segments[i];

        if (i > 0) {
            auto sep = makeUnique<ui::Label>(
                ui::WidgetId::indexed(breadcrumbPanel_->getId().path, "sep", static_cast<u32>(i)),
                icons::ChevronRight
            );
            sep->setIsIconFont(true);
            sep->setFontSize(10.0f);
            sep->setColor(sepColor);
            sep->setWidth(ui::SizeValue::autoSize());
            sep->setHeight(ui::SizeValue::px(26.0f));
            breadcrumbPanel_->addChild(std::move(sep));
        }

        auto btn = makeUnique<ui::Button>(
            ui::WidgetId::indexed(breadcrumbPanel_->getId().path, "seg", static_cast<u32>(i)),
            name
        );
        btn->setFontSize(11.0f);
        btn->setWidth(ui::SizeValue::autoSize());
        btn->setHeight(ui::SizeValue::px(22.0f));
        btn->setBackgroundColor(glm::vec4(0.0f));
        btn->setHoverColor({0.235f, 0.235f, 0.235f, 1.0f});
        btn->setTextColor(textColor);

        std::string pathCopy = fullPath;
        breadcrumbConnections_.add(sink(btn->onClick).connect([this, pathCopy]() {
            navigateToPath(pathCopy);
        }));

        breadcrumbPanel_->addChild(std::move(btn));
    }
}

void AssetBrowserPanel::updateViewModeButtons() {
    if (!viewModePanel_) return;

    constexpr glm::vec4 activeBg{0.235f, 0.235f, 0.235f, 1.0f};
    constexpr glm::vec4 inactiveBg{0.0f, 0.0f, 0.0f, 0.0f};

    auto& children = viewModePanel_->getChildren();
    if (children.size() >= 2) {
        auto* gridBtn = dynamic_cast<ui::Button*>(children[0].get());
        auto* listBtn = dynamic_cast<ui::Button*>(children[1].get());

        if (gridBtn) {
            gridBtn->setBackgroundColor(viewMode_ == AssetViewMode::Grid ? activeBg : inactiveBg);
        }
        if (listBtn) {
            listBtn->setBackgroundColor(viewMode_ == AssetViewMode::List ? activeBg : inactiveBg);
        }
    }
}

void AssetBrowserPanel::navigateToPath(const std::string& path) {
    if (currentPath_ == path) return;

    // Defer navigation to avoid deleting objects during their event handlers
    pendingNavigatePath_ = path;
    needsRefreshAssetList_ = true;
}

void AssetBrowserPanel::importAsset() {
#ifdef ES_PLATFORM_WEB
    ES_LOG_WARN("Import not available on web platform");
    return;
#endif

    std::vector<FileFilter> filters = {
        {"Images", "*.png;*.jpg;*.jpeg;*.bmp;*.tga"},
        {"Audio", "*.wav;*.mp3;*.ogg"},
        {"3D Models", "*.fbx;*.gltf;*.glb;*.obj"},
        {"All Files", "*.*"}
    };

    std::string sourcePath = FileDialog::openFile("Import Asset", filters);
    if (sourcePath.empty()) return;

    std::string fileName = getFileName(sourcePath);
    std::string destPath = currentPath_ + "/" + fileName;

    std::error_code ec;
    std::filesystem::copy_file(sourcePath, destPath, std::filesystem::copy_options::overwrite_existing, ec);

    if (!ec) {
        ES_LOG_INFO("Imported asset: {} -> {}", sourcePath, destPath);
        refreshAssetList();
    } else {
        ES_LOG_ERROR("Failed to import asset: {}", ec.message());
    }
}

}  // namespace esengine::editor
