/**
 * @file    WebFileSystem.cpp
 * @brief   Web platform file system implementation (Emscripten)
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "../FileSystem.hpp"
#include "../PathResolver.hpp"
#include "../../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <emscripten.h>
#endif

#include <fstream>
#include <sstream>

namespace esengine {

// =============================================================================
// Initialization
// =============================================================================

void FileSystem::init() {
    PathResolver::init();
    ES_LOG_INFO("FileSystem initialized (Web platform - read-only preloaded assets)");
}

void FileSystem::shutdown() {
    PathResolver::shutdown();
    ES_LOG_INFO("FileSystem shutdown");
}

void FileSystem::update() {
    // No file watching support on web
}

// =============================================================================
// File Operations
// =============================================================================

bool FileSystem::fileExists(const std::string& path) {
    std::ifstream file(path);
    return file.good();
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
    (void)path;
    (void)content;
    ES_LOG_WARN("File writing not supported on web platform");
    return false;
}

bool FileSystem::writeBinaryFile(const std::string& path, const std::vector<u8>& data) {
    (void)path;
    (void)data;
    ES_LOG_WARN("File writing not supported on web platform");
    return false;
}

usize FileSystem::getFileSize(const std::string& path) {
    std::ifstream file(path, std::ios::in | std::ios::binary | std::ios::ate);
    if (!file.is_open()) {
        return 0;
    }

    usize size = static_cast<usize>(file.tellg());
    file.close();
    return size;
}

u64 FileSystem::getFileModificationTime(const std::string& path) {
    (void)path;
    // No modification time support on web
    return 0;
}

// =============================================================================
// Directory Operations
// =============================================================================

bool FileSystem::directoryExists(const std::string& path) {
    (void)path;
    // No directory API on web
    return false;
}

std::vector<std::string> FileSystem::listDirectory(const std::string& path, bool recursive) {
    (void)path;
    (void)recursive;
    ES_LOG_WARN("Directory listing not supported on web platform");
    return {};
}

bool FileSystem::createDirectory(const std::string& path) {
    (void)path;
    ES_LOG_WARN("Directory creation not supported on web platform");
    return false;
}

// =============================================================================
// File Monitoring (Hot Reload)
// =============================================================================

void FileSystem::watchFile(const std::string& path,
                          std::function<void(const std::string&)> callback) {
    (void)path;
    (void)callback;
    ES_LOG_WARN("File watching not supported on web platform");
}

void FileSystem::unwatchFile(const std::string& path) {
    (void)path;
}

bool FileSystem::isWatching(const std::string& path) {
    (void)path;
    return false;
}

}  // namespace esengine
