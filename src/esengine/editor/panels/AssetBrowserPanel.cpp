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
#include "../../platform/FileSystem.hpp"
#include "../../core/Log.hpp"
#include "../../events/Sink.hpp"
#include "../../ui/icons/Icons.hpp"

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

    ES_LOG_INFO("AssetBrowserPanel: rootPath = {}", rootPath_);
    ES_LOG_INFO("AssetBrowserPanel: directoryExists = {}", FileSystem::directoryExists(rootPath_));

    buildUI();

#ifndef ES_PLATFORM_WEB
    rebuildFolderTree();
    refreshAssetList();
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
    // Process deferred navigation to avoid deleting objects during their event handlers
    if (needsRefreshAssetList_) {
        needsRefreshAssetList_ = false;
        currentPath_ = pendingNavigatePath_;
        refreshAssetList();

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
    constexpr glm::vec4 panelBg{0.145f, 0.145f, 0.149f, 1.0f};          // #252526
    constexpr glm::vec4 toolbarBg{0.176f, 0.176f, 0.188f, 1.0f};        // #2d2d30
    constexpr glm::vec4 mainBg{0.118f, 0.118f, 0.118f, 1.0f};           // #1e1e1e
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};      // #3c3c3c

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

    auto searchField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_search"));
    searchField->setPlaceholder("Search assets...");
    searchField->setWidth(ui::SizeValue::px(200.0f));
    searchField->setHeight(ui::SizeValue::px(26.0f));
    searchField_ = searchField.get();
    toolbar->addChild(std::move(searchField));

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

    if (!FileSystem::directoryExists(rootPath_)) {
        ES_LOG_WARN("Asset root path does not exist: {}", rootPath_);
        return;
    }

    ui::TreeNodeId rootNodeId = folderTree_->addNode(ui::INVALID_TREE_NODE, "assets");
    nodeToPath_[rootNodeId] = rootPath_;
    pathToNode_[rootPath_] = rootNodeId;

    addFolderNodes(rootPath_, rootNodeId);

    folderTree_->setNodeExpanded(rootNodeId, true);
    folderTree_->selectNode(rootNodeId);
}

void AssetBrowserPanel::addFolderNodes(const std::string& path, ui::TreeNodeId parentNode) {
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

            addFolderNodes(entry, nodeId);
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
            refreshAssetList();
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

}  // namespace esengine::editor
