/**
 * @file    AssetDatabase.hpp
 * @brief   Centralized asset management and tracking
 * @details Maintains a database of all project assets with GUID-based
 *          identification and metadata caching.
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

#include "../core/Types.hpp"
#include "panels/AssetBrowserTypes.hpp"

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>

namespace esengine::editor {

// =============================================================================
// Data Structures
// =============================================================================

struct AssetMetadata {
    std::string guid;
    std::string path;
    std::string name;
    std::string extension;
    AssetType type = AssetType::Unknown;
    usize fileSize = 0;
    u64 lastModified = 0;
    bool isDirectory = false;
};

// =============================================================================
// AssetDatabase Class
// =============================================================================

class AssetDatabase {
public:
    AssetDatabase();
    ~AssetDatabase();

    void setProjectPath(const std::string& path);
    const std::string& getProjectPath() const { return projectPath_; }

    void scan();
    void refresh();

    const AssetMetadata* findByPath(const std::string& path) const;
    const AssetMetadata* findByGUID(const std::string& guid) const;

    std::vector<const AssetMetadata*> getAssetsInDirectory(const std::string& directory) const;
    std::vector<std::string> getSubdirectories(const std::string& directory) const;

    const std::unordered_map<std::string, AssetMetadata>& getAllAssets() const { return assetsByGUID_; }

    void saveDatabase();
    void loadDatabase();

    void setOnAssetAdded(std::function<void(const AssetMetadata&)> callback);
    void setOnAssetRemoved(std::function<void(const std::string&)> callback);
    void setOnAssetModified(std::function<void(const AssetMetadata&)> callback);

private:
    void scanDirectory(const std::string& directory, bool recursive);
    bool isExcludedDirectory(const std::string& name) const;
    std::string generateGUID() const;
    std::string getDatabasePath() const;
    AssetType detectAssetType(const std::string& path) const;

    std::string projectPath_;
    std::unordered_map<std::string, AssetMetadata> assetsByGUID_;
    std::unordered_map<std::string, std::string> pathToGUID_;
    std::vector<std::string> excludedDirs_ = {"node_modules", "build", ".esengine", ".git", ".vscode", ".idea"};

    std::function<void(const AssetMetadata&)> onAssetAdded_;
    std::function<void(const std::string&)> onAssetRemoved_;
    std::function<void(const AssetMetadata&)> onAssetModified_;
};

}  // namespace esengine::editor
