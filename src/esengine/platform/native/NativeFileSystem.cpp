/**
 * @file    NativeFileSystem.cpp
 * @brief   Native platform file system implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "../FileSystem.hpp"
#include "../../core/Log.hpp"

#include <fstream>
#include <sstream>
#include <filesystem>
#include <unordered_map>
#include <chrono>

namespace fs = std::filesystem;

namespace esengine {

// =============================================================================
// File Watcher Data
// =============================================================================

struct WatchedFile {
    std::string path;
    u64 lastModTime;
    std::function<void(const std::string&)> callback;
};

static bool s_initialized = false;
static std::unordered_map<std::string, WatchedFile> s_watchedFiles;

// =============================================================================
// Initialization
// =============================================================================

void FileSystem::init() {
    if (s_initialized) {
        ES_LOG_WARN("FileSystem already initialized");
        return;
    }

    s_watchedFiles.clear();
    s_initialized = true;

    ES_LOG_INFO("FileSystem initialized (polling-based file watcher)");
}

void FileSystem::shutdown() {
    if (!s_initialized) {
        return;
    }

    s_watchedFiles.clear();
    s_initialized = false;

    ES_LOG_INFO("FileSystem shutdown");
}

void FileSystem::update() {
    if (!s_initialized) {
        return;
    }

    // Poll all watched files for modifications
    for (auto& [path, watched] : s_watchedFiles) {
        u64 currentModTime = getFileModificationTime(watched.path);

        if (currentModTime > watched.lastModTime) {
            ES_LOG_INFO("File changed: {}", watched.path);
            watched.lastModTime = currentModTime;

            // Call callback
            if (watched.callback) {
                watched.callback(watched.path);
            }
        }
    }
}

// =============================================================================
// File Operations
// =============================================================================

bool FileSystem::fileExists(const std::string& path) {
    try {
        return fs::exists(path) && fs::is_regular_file(path);
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("fileExists error: {}", e.what());
        return false;
    }
}

std::string FileSystem::readTextFile(const std::string& path) {
    std::ifstream file(path, std::ios::in);
    if (!file.is_open()) {
        ES_LOG_ERROR("Failed to open file: {}", path);
        return "";
    }

    std::stringstream buffer;
    buffer << file.rdbuf();
    file.close();

    return buffer.str();
}

std::vector<u8> FileSystem::readBinaryFile(const std::string& path) {
    std::ifstream file(path, std::ios::in | std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        ES_LOG_ERROR("Failed to open file: {}", path);
        return {};
    }

    std::streamsize size = file.tellg();
    file.seekg(0, std::ios::beg);

    std::vector<u8> buffer(static_cast<usize>(size));
    if (!file.read(reinterpret_cast<char*>(buffer.data()), size)) {
        ES_LOG_ERROR("Failed to read file: {}", path);
        return {};
    }

    file.close();
    return buffer;
}

bool FileSystem::writeTextFile(const std::string& path, const std::string& content) {
    std::ofstream file(path, std::ios::out | std::ios::trunc);
    if (!file.is_open()) {
        ES_LOG_ERROR("Failed to open file for writing: {}", path);
        return false;
    }

    file << content;
    file.close();

    return true;
}

bool FileSystem::writeBinaryFile(const std::string& path, const std::vector<u8>& data) {
    std::ofstream file(path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!file.is_open()) {
        ES_LOG_ERROR("Failed to open file for writing: {}", path);
        return false;
    }

    file.write(reinterpret_cast<const char*>(data.data()),
              static_cast<std::streamsize>(data.size()));
    file.close();

    return true;
}

usize FileSystem::getFileSize(const std::string& path) {
    try {
        return static_cast<usize>(fs::file_size(path));
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("getFileSize error: {}", e.what());
        return 0;
    }
}

u64 FileSystem::getFileModificationTime(const std::string& path) {
    try {
        auto ftime = fs::last_write_time(path);
        auto sctp = std::chrono::time_point_cast<std::chrono::system_clock::duration>(
            ftime - fs::file_time_type::clock::now() + std::chrono::system_clock::now()
        );
        return static_cast<u64>(std::chrono::system_clock::to_time_t(sctp));
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("getFileModificationTime error: {}", e.what());
        return 0;
    }
}

// =============================================================================
// Directory Operations
// =============================================================================

bool FileSystem::directoryExists(const std::string& path) {
    try {
        return fs::exists(path) && fs::is_directory(path);
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("directoryExists error: {}", e.what());
        return false;
    }
}

std::vector<std::string> FileSystem::listDirectory(const std::string& path, bool recursive) {
    std::vector<std::string> entries;

    try {
        if (recursive) {
            for (const auto& entry : fs::recursive_directory_iterator(path)) {
                entries.push_back(entry.path().string());
            }
        } else {
            for (const auto& entry : fs::directory_iterator(path)) {
                entries.push_back(entry.path().string());
            }
        }
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("listDirectory error: {}", e.what());
    }

    return entries;
}

bool FileSystem::createDirectory(const std::string& path) {
    try {
        return fs::create_directories(path);
    } catch (const fs::filesystem_error& e) {
        ES_LOG_ERROR("createDirectory error: {}", e.what());
        return false;
    }
}

// =============================================================================
// File Monitoring (Hot Reload)
// =============================================================================

void FileSystem::watchFile(const std::string& path,
                          std::function<void(const std::string&)> callback) {
    if (!s_initialized) {
        ES_LOG_ERROR("FileSystem not initialized");
        return;
    }

    if (!fileExists(path)) {
        ES_LOG_WARN("Cannot watch non-existent file: {}", path);
        return;
    }

    // Get initial modification time
    u64 modTime = getFileModificationTime(path);

    // Add to watch list
    s_watchedFiles[path] = WatchedFile{path, modTime, callback};

    ES_LOG_INFO("Watching file: {}", path);
}

void FileSystem::unwatchFile(const std::string& path) {
    if (!s_initialized) {
        return;
    }

    auto it = s_watchedFiles.find(path);
    if (it != s_watchedFiles.end()) {
        s_watchedFiles.erase(it);
        ES_LOG_INFO("Stopped watching file: {}", path);
    }
}

bool FileSystem::isWatching(const std::string& path) {
    if (!s_initialized) {
        return false;
    }

    return s_watchedFiles.find(path) != s_watchedFiles.end();
}

}  // namespace esengine
