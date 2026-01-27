/**
 * @file    AssetBrowserPanel.hpp
 * @brief   Asset browser panel for the editor
 * @details Provides a file browser interface for navigating and managing
 *          project assets with folder tree and grid view.
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

#include "../../ui/docking/DockPanel.hpp"
#include "../../ui/widgets/TreeView.hpp"
#include "../../ui/widgets/ScrollView.hpp"
#include "../../ui/widgets/TextField.hpp"
#include "../../ui/widgets/Panel.hpp"
#include "../../events/Connection.hpp"
#include "AssetBrowserTypes.hpp"

#include <unordered_map>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Forward Declarations
// =============================================================================

class AssetDatabase;
class ThumbnailGenerator;

// =============================================================================
// AssetBrowserPanel Class
// =============================================================================

class AssetBrowserPanel : public ui::DockPanel {
public:
    AssetBrowserPanel(AssetDatabase& assetDB, ThumbnailGenerator& thumbnailGen);
    ~AssetBrowserPanel() override;

    void refresh();
    void setRootPath(const std::string& path);
    const std::string& getRootPath() const { return rootPath_; }

    void setViewMode(AssetViewMode mode);
    AssetViewMode getViewMode() const { return viewMode_; }

    Signal<void(const std::string&)> onAssetSelected;
    Signal<void(const std::string&)> onAssetDoubleClicked;

protected:
    void onActivated() override;

private:
    void buildUI();
    void rebuildFolderTree();
    void addFolderNodes(const std::string& path, ui::TreeNodeId parentNode);
    void refreshAssetList();

    void onFolderSelected(ui::TreeNodeId nodeId);
    void onSearchTextChanged(const std::string& text);
    void onAssetItemClicked(const std::string& path);
    void onAssetItemDoubleClicked(const std::string& path);

    std::string getFileName(const std::string& path) const;
    std::string getFileExtension(const std::string& path) const;
    std::string toLower(const std::string& str) const;

    std::string rootPath_;
    std::string currentPath_;
    AssetViewMode viewMode_ = AssetViewMode::Grid;

    ui::Panel* leftPanel_ = nullptr;
    ui::Panel* rightPanel_ = nullptr;
    ui::TreeView* folderTree_ = nullptr;
    ui::TextField* searchField_ = nullptr;
    ui::ScrollView* assetScrollView_ = nullptr;
    ui::Panel* assetGridPanel_ = nullptr;

    std::vector<AssetEntry> currentAssets_;
    std::unordered_map<ui::TreeNodeId, std::string> nodeToPath_;
    std::unordered_map<std::string, ui::TreeNodeId> pathToNode_;
    std::string searchFilter_;

    std::string selectedAssetPath_;
    bool needsRebuild_ = false;

    AssetDatabase& assetDB_;
    ThumbnailGenerator& thumbnailGen_;

    Connection folderSelectedConnection_;
    Connection searchChangedConnection_;
};

}  // namespace esengine::editor
