#pragma once

#include "../core/Types.hpp"
#include "panels/AssetBrowserTypes.hpp"

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>

namespace esengine::editor {

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
    std::string generateGUID() const;
    std::string getDatabasePath() const;
    AssetType detectAssetType(const std::string& path) const;

    std::string projectPath_;
    std::unordered_map<std::string, AssetMetadata> assetsByGUID_;
    std::unordered_map<std::string, std::string> pathToGUID_;

    std::function<void(const AssetMetadata&)> onAssetAdded_;
    std::function<void(const std::string&)> onAssetRemoved_;
    std::function<void(const AssetMetadata&)> onAssetModified_;
};

}  // namespace esengine::editor
