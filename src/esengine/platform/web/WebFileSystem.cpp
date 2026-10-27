// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    WebFileSystem.cpp
 * @brief   Web platform file system implementation (Emscripten)
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the Apache License, Version 2.0.
 */

#include "../FileSystem.hpp"
#include "../PathResolver.hpp"
#include "../../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    #include <emscripten.h>
#endif

#include <cstdio>

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

namespace {

// stdio rather than ifstream: a stream here brings libc++'s iostream and locale machinery into the module for the sake of reading a file.
struct StdioFile {
    std::FILE* f;
    explicit StdioFile(const std::string& path) : f(std::fopen(path.c_str(), "rb")) {}
    ~StdioFile() { if (f) std::fclose(f); }
    StdioFile(const StdioFile&) = delete;
    StdioFile& operator=(const StdioFile&) = delete;
    /// The file's length, or -1 when it cannot be measured.
    long size() {
        if (std::fseek(f, 0, SEEK_END) != 0) return -1;
        const long n = std::ftell(f);
        std::fseek(f, 0, SEEK_SET);
        return n;
    }
};

}  // namespace

bool FileSystem::fileExists(const std::string& path) {
    StdioFile file(path);
    return file.f != nullptr;
}

std::string FileSystem::readTextFile(const std::string& path) {
    StdioFile file(path);
    if (!file.f) {
        ES_LOG_ERROR("Failed to open file: {}", path);
        return "";
    }

    std::string text;
    char chunk[4096];
    usize n;
    while ((n = std::fread(chunk, 1, sizeof chunk, file.f)) > 0) text.append(chunk, n);
    return text;
}

std::vector<u8> FileSystem::readBinaryFile(const std::string& path) {
    StdioFile file(path);
    if (!file.f) {
        ES_LOG_ERROR("Failed to open file: {}", path);
        return {};
    }

    const long size = file.size();
    if (size < 0) {
        ES_LOG_ERROR("Failed to read file: {}", path);
        return {};
    }

    std::vector<u8> buffer(static_cast<usize>(size));
    if (size > 0 && std::fread(buffer.data(), 1, buffer.size(), file.f) != buffer.size()) {
        ES_LOG_ERROR("Failed to read file: {}", path);
        return {};
    }
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
    StdioFile file(path);
    if (!file.f) {
        return 0;
    }
    const long size = file.size();
    return size < 0 ? 0 : static_cast<usize>(size);
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
