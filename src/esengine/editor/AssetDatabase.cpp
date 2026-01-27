#include "AssetDatabase.hpp"
#include "../platform/FileSystem.hpp"
#include "../core/Log.hpp"

#include <algorithm>
#include <random>
#include <sstream>
#include <iomanip>

namespace esengine::editor {

namespace {
    std::string getFileName(const std::string& path) {
        usize pos = path.find_last_of("/\\");
        if (pos != std::string::npos) {
            return path.substr(pos + 1);
        }
        return path;
    }

    std::string getFileExtension(const std::string& path) {
        usize pos = path.find_last_of('.');
        if (pos != std::string::npos) {
            return path.substr(pos);
        }
        return "";
    }

    std::string escapeJsonString(const std::string& str) {
        std::string result;
        result.reserve(str.size() + 16);
        for (char c : str) {
            switch (c) {
                case '"': result += "\\\""; break;
                case '\\': result += "\\\\"; break;
                case '\n': result += "\\n"; break;
                case '\r': result += "\\r"; break;
                case '\t': result += "\\t"; break;
                default: result += c; break;
            }
        }
        return result;
    }

    std::string unescapeJsonString(const std::string& str) {
        std::string result;
        result.reserve(str.size());
        for (usize i = 0; i < str.size(); ++i) {
            if (str[i] == '\\' && i + 1 < str.size()) {
                switch (str[i + 1]) {
                    case '"': result += '"'; ++i; break;
                    case '\\': result += '\\'; ++i; break;
                    case 'n': result += '\n'; ++i; break;
                    case 'r': result += '\r'; ++i; break;
                    case 't': result += '\t'; ++i; break;
                    default: result += str[i]; break;
                }
            } else {
                result += str[i];
            }
        }
        return result;
    }
}  // namespace

AssetDatabase::AssetDatabase() = default;
AssetDatabase::~AssetDatabase() = default;

void AssetDatabase::setProjectPath(const std::string& path) {
    if (projectPath_ != path) {
        projectPath_ = path;
        loadDatabase();
    }
}

void AssetDatabase::scan() {
    if (projectPath_.empty()) {
        ES_LOG_WARN("AssetDatabase: Project path not set");
        return;
    }

    if (!FileSystem::directoryExists(projectPath_)) {
        ES_LOG_WARN("AssetDatabase: Project path does not exist: {}", projectPath_);
        return;
    }

    ES_LOG_INFO("AssetDatabase: Scanning {}", projectPath_);
    scanDirectory(projectPath_, true);
    saveDatabase();
    ES_LOG_INFO("AssetDatabase: Found {} assets", assetsByGUID_.size());
}

void AssetDatabase::refresh() {
    scan();
}

void AssetDatabase::scanDirectory(const std::string& directory, bool recursive) {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::vector<std::string> entries = FileSystem::listDirectory(directory, false);

    for (const auto& entryPath : entries) {
        bool isDir = FileSystem::directoryExists(entryPath);

        auto existingIt = pathToGUID_.find(entryPath);
        if (existingIt != pathToGUID_.end()) {
            auto& existing = assetsByGUID_[existingIt->second];
            u64 currentModTime = FileSystem::getFileModificationTime(entryPath);
            if (existing.lastModified != currentModTime) {
                existing.lastModified = currentModTime;
                existing.fileSize = isDir ? 0 : FileSystem::getFileSize(entryPath);
                if (onAssetModified_) {
                    onAssetModified_(existing);
                }
            }
        } else {
            AssetMetadata metadata;
            metadata.guid = generateGUID();
            metadata.path = entryPath;
            metadata.name = getFileName(entryPath);
            metadata.extension = getFileExtension(entryPath);
            metadata.isDirectory = isDir;
            metadata.type = isDir ? AssetType::Folder : detectAssetType(entryPath);
            metadata.fileSize = isDir ? 0 : FileSystem::getFileSize(entryPath);
            metadata.lastModified = FileSystem::getFileModificationTime(entryPath);

            assetsByGUID_[metadata.guid] = metadata;
            pathToGUID_[metadata.path] = metadata.guid;

            if (onAssetAdded_) {
                onAssetAdded_(metadata);
            }
        }

        if (isDir && recursive) {
            scanDirectory(entryPath, true);
        }
    }
}

const AssetMetadata* AssetDatabase::findByPath(const std::string& path) const {
    auto it = pathToGUID_.find(path);
    if (it != pathToGUID_.end()) {
        auto assetIt = assetsByGUID_.find(it->second);
        if (assetIt != assetsByGUID_.end()) {
            return &assetIt->second;
        }
    }
    return nullptr;
}

const AssetMetadata* AssetDatabase::findByGUID(const std::string& guid) const {
    auto it = assetsByGUID_.find(guid);
    if (it != assetsByGUID_.end()) {
        return &it->second;
    }
    return nullptr;
}

std::vector<const AssetMetadata*> AssetDatabase::getAssetsInDirectory(const std::string& directory) const {
    std::vector<const AssetMetadata*> result;

    std::string dirPath = directory;
    if (!dirPath.empty() && dirPath.back() != '/' && dirPath.back() != '\\') {
        dirPath += '/';
    }

    for (const auto& [guid, metadata] : assetsByGUID_) {
        if (metadata.path.size() > dirPath.size() &&
            metadata.path.compare(0, dirPath.size(), dirPath) == 0) {
            usize remaining = metadata.path.size() - dirPath.size();
            usize slashPos = metadata.path.find_first_of("/\\", dirPath.size());
            if (slashPos == std::string::npos || slashPos == metadata.path.size() - 1) {
                result.push_back(&metadata);
            }
        }
    }

    std::sort(result.begin(), result.end(),
        [](const AssetMetadata* a, const AssetMetadata* b) {
            if (a->isDirectory != b->isDirectory) {
                return a->isDirectory;
            }
            return a->name < b->name;
        });

    return result;
}

std::vector<std::string> AssetDatabase::getSubdirectories(const std::string& directory) const {
    std::vector<std::string> result;

    auto assets = getAssetsInDirectory(directory);
    for (const auto* asset : assets) {
        if (asset->isDirectory) {
            result.push_back(asset->path);
        }
    }

    return result;
}

std::string AssetDatabase::generateGUID() const {
    static std::random_device rd;
    static std::mt19937_64 gen(rd());
    static std::uniform_int_distribution<u64> dis;

    std::stringstream ss;
    ss << std::hex << std::setfill('0');

    u64 part1 = dis(gen);
    u64 part2 = dis(gen);

    ss << std::setw(8) << ((part1 >> 32) & 0xFFFFFFFF) << "-";
    ss << std::setw(4) << ((part1 >> 16) & 0xFFFF) << "-";
    ss << std::setw(4) << (part1 & 0xFFFF) << "-";
    ss << std::setw(4) << ((part2 >> 48) & 0xFFFF) << "-";
    ss << std::setw(12) << (part2 & 0xFFFFFFFFFFFF);

    return ss.str();
}

std::string AssetDatabase::getDatabasePath() const {
    return projectPath_ + "/.esengine/assets.db";
}

AssetType AssetDatabase::detectAssetType(const std::string& path) const {
    std::string ext = getFileExtension(path);
    std::transform(ext.begin(), ext.end(), ext.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return getAssetTypeFromExtension(ext);
}

void AssetDatabase::saveDatabase() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string dbDir = projectPath_ + "/.esengine";
    if (!FileSystem::directoryExists(dbDir)) {
        FileSystem::createDirectory(dbDir);
    }

    std::stringstream ss;
    ss << "{\n  \"version\": \"1.0\",\n  \"assets\": [\n";

    bool first = true;
    for (const auto& [guid, metadata] : assetsByGUID_) {
        if (!first) ss << ",\n";
        first = false;

        ss << "    {\n";
        ss << "      \"guid\": \"" << escapeJsonString(metadata.guid) << "\",\n";
        ss << "      \"path\": \"" << escapeJsonString(metadata.path) << "\",\n";
        ss << "      \"name\": \"" << escapeJsonString(metadata.name) << "\",\n";
        ss << "      \"type\": " << static_cast<int>(metadata.type) << ",\n";
        ss << "      \"fileSize\": " << metadata.fileSize << ",\n";
        ss << "      \"lastModified\": " << metadata.lastModified << ",\n";
        ss << "      \"isDirectory\": " << (metadata.isDirectory ? "true" : "false") << "\n";
        ss << "    }";
    }

    ss << "\n  ]\n}\n";

    FileSystem::writeTextFile(getDatabasePath(), ss.str());
    ES_LOG_DEBUG("AssetDatabase: Saved to {}", getDatabasePath());
}

void AssetDatabase::loadDatabase() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string dbPath = getDatabasePath();
    if (!FileSystem::fileExists(dbPath)) {
        return;
    }

    std::string content = FileSystem::readTextFile(dbPath);
    if (content.empty()) {
        return;
    }

    assetsByGUID_.clear();
    pathToGUID_.clear();

    usize pos = 0;
    while ((pos = content.find("\"guid\":", pos)) != std::string::npos) {
        AssetMetadata metadata;

        auto extractString = [&](const std::string& key) -> std::string {
            usize keyPos = content.find("\"" + key + "\":", pos);
            if (keyPos == std::string::npos) return "";
            usize valueStart = content.find("\"", keyPos + key.size() + 3);
            if (valueStart == std::string::npos) return "";
            usize valueEnd = content.find("\"", valueStart + 1);
            if (valueEnd == std::string::npos) return "";
            return unescapeJsonString(content.substr(valueStart + 1, valueEnd - valueStart - 1));
        };

        auto extractInt = [&](const std::string& key) -> u64 {
            usize keyPos = content.find("\"" + key + "\":", pos);
            if (keyPos == std::string::npos) return 0;
            usize valueStart = keyPos + key.size() + 3;
            while (valueStart < content.size() && !std::isdigit(content[valueStart])) {
                ++valueStart;
            }
            return std::stoull(content.substr(valueStart));
        };

        auto extractBool = [&](const std::string& key) -> bool {
            usize keyPos = content.find("\"" + key + "\":", pos);
            if (keyPos == std::string::npos) return false;
            return content.find("true", keyPos) < content.find("false", keyPos);
        };

        metadata.guid = extractString("guid");
        metadata.path = extractString("path");
        metadata.name = extractString("name");
        metadata.type = static_cast<AssetType>(extractInt("type"));
        metadata.fileSize = extractInt("fileSize");
        metadata.lastModified = extractInt("lastModified");
        metadata.isDirectory = extractBool("isDirectory");
        metadata.extension = getFileExtension(metadata.path);

        if (!metadata.guid.empty() && !metadata.path.empty()) {
            assetsByGUID_[metadata.guid] = metadata;
            pathToGUID_[metadata.path] = metadata.guid;
        }

        pos = content.find("}", pos) + 1;
    }

    ES_LOG_DEBUG("AssetDatabase: Loaded {} assets from {}", assetsByGUID_.size(), dbPath);
}

void AssetDatabase::setOnAssetAdded(std::function<void(const AssetMetadata&)> callback) {
    onAssetAdded_ = std::move(callback);
}

void AssetDatabase::setOnAssetRemoved(std::function<void(const std::string&)> callback) {
    onAssetRemoved_ = std::move(callback);
}

void AssetDatabase::setOnAssetModified(std::function<void(const AssetMetadata&)> callback) {
    onAssetModified_ = std::move(callback);
}

}  // namespace esengine::editor
