#include "AssetBrowserPanel.hpp"
#include "AssetGridItem.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../core/Log.hpp"
#include "../../events/Sink.hpp"

#include <algorithm>
#include <cctype>

namespace esengine::editor {

AssetBrowserPanel::AssetBrowserPanel()
    : DockPanel(ui::WidgetId("asset_browser_panel"), "Assets") {

    setPanelType("AssetBrowser");
    setClosable(true);
    setMinSize(glm::vec2(400.0f, 250.0f));

    rootPath_ = "assets";
    currentPath_ = rootPath_;

    buildUI();

#ifndef ES_PLATFORM_WEB
    rebuildFolderTree();
    refreshAssetList();
#endif
}

AssetBrowserPanel::~AssetBrowserPanel() = default;

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

void AssetBrowserPanel::buildUI() {
    auto rootPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_root"));
    rootPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 4.0f));
    rootPanel->setDrawBackground(false);

    auto leftPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_left"));
    leftPanel->setWidth(ui::SizeValue::px(200.0f));
    leftPanel->setHeight(ui::SizeValue::flex(1.0f));
    leftPanel->setDrawBackground(true);
    leftPanel->setPadding(ui::Insets::all(4.0f));

    auto folderTree = makeUnique<ui::TreeView>(ui::WidgetId(getId().path + "_folder_tree"));
    folderTree->setMultiSelect(false);
    folderTree->setRowHeight(22.0f);
    folderTree->setIndentSize(16.0f);
    folderTree->setWidth(ui::SizeValue::flex(1.0f));
    folderTree->setHeight(ui::SizeValue::flex(1.0f));
    folderTree_ = folderTree.get();
    leftPanel->addChild(std::move(folderTree));

    leftPanel_ = leftPanel.get();
    rootPanel->addChild(std::move(leftPanel));

    auto rightPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_right"));
    rightPanel->setWidth(ui::SizeValue::flex(1.0f));
    rightPanel->setHeight(ui::SizeValue::flex(1.0f));
    rightPanel->setLayout(makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f));
    rightPanel->setDrawBackground(false);

    auto toolbar = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_toolbar"));
    toolbar->setHeight(ui::SizeValue::px(32.0f));
    toolbar->setWidth(ui::SizeValue::flex(1.0f));
    toolbar->setPadding(ui::Insets::symmetric(4.0f, 4.0f));
    toolbar->setDrawBackground(true);

    auto searchField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_search"));
    searchField->setPlaceholder("Search...");
    searchField->setWidth(ui::SizeValue::px(200.0f));
    searchField->setHeight(ui::SizeValue::px(24.0f));
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
    assetGridPanel_ = gridPanel.get();
    scrollView->setContent(std::move(gridPanel));

    assetScrollView_ = scrollView.get();
    rightPanel->addChild(std::move(scrollView));

    rightPanel_ = rightPanel.get();
    rootPanel->addChild(std::move(rightPanel));

    setContent(std::move(rootPanel));

    folderSelectedConnection_ = sink(folderTree_->onNodeSelected).connect(
        [this](ui::TreeNodeId nodeId) { onFolderSelected(nodeId); }
    );

    searchChangedConnection_ = sink(searchField_->onTextChanged).connect(
        [this](const std::string& text) { onSearchTextChanged(text); }
    );
}

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

    for (const auto& entry : entries) {
        if (FileSystem::directoryExists(entry)) {
            std::string folderName = getFileName(entry);

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

    currentAssets_.clear();
    assetGridPanel_->clearChildren();

    if (!FileSystem::directoryExists(currentPath_)) {
        return;
    }

    std::vector<std::string> files = FileSystem::listDirectory(currentPath_, false);

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

        (void)sink(item->onClick).connect([this](const std::string& path) {
            onAssetItemClicked(path);
        });

        (void)sink(item->onDoubleClick).connect([this](const std::string& path) {
            onAssetItemDoubleClicked(path);
        });

        assetGridPanel_->addChild(std::move(item));
    }
}

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
    if (FileSystem::directoryExists(path)) {
        currentPath_ = path;
        refreshAssetList();

        auto it = pathToNode_.find(path);
        if (it != pathToNode_.end()) {
            folderTree_->selectNode(it->second);
            folderTree_->setNodeExpanded(it->second, true);
        }
    } else {
        onAssetDoubleClicked.publish(path);
    }
}

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
