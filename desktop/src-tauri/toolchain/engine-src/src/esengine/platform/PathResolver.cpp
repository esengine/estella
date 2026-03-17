/**
 * @file    PathResolver.cpp
 * @brief   Cross-platform path resolution implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "PathResolver.hpp"
#include "../core/Log.hpp"

#ifdef ES_PLATFORM_WEB
    // Web platform - no executable path needed
#elif defined(_WIN32) || defined(_WIN64)
    #include <windows.h>
#elif defined(__APPLE__)
    #include <mach-o/dyld.h>
    #include <limits.h>
#elif defined(__linux__)
    #include <unistd.h>
    #include <limits.h>
#endif

#include <algorithm>

namespace esengine {

std::string PathResolver::editorRoot_;
std::string PathResolver::projectRoot_;
bool PathResolver::initialized_ = false;

void PathResolver::init() {
    if (initialized_) return;

#ifdef ES_SOURCE_DIR
    // Development mode: use source directory for editor assets
    editorRoot_ = ES_SOURCE_DIR;
    projectRoot_ = ES_SOURCE_DIR;
    ES_LOG_INFO("PathResolver initialized (dev mode) - Editor root: {}", editorRoot_);
#else
    // Release mode: use executable directory
    editorRoot_ = getExecutableDirectory();
    projectRoot_ = editorRoot_;
    ES_LOG_INFO("PathResolver initialized - Editor root: {}", editorRoot_);
#endif

    initialized_ = true;
}

void PathResolver::shutdown() {
    if (!initialized_) return;

    editorRoot_.clear();
    projectRoot_.clear();
    initialized_ = false;
}

void PathResolver::setProjectRoot(const std::string& path) {
    projectRoot_ = normalizePath(path);
    ES_LOG_INFO("Project root set to: {}", projectRoot_);
}

const std::string& PathResolver::getProjectRoot() {
    return projectRoot_;
}

const std::string& PathResolver::getEditorRoot() {
    return editorRoot_;
}

std::string PathResolver::resolve(const std::string& path, PathType type) {
    if (type == PathType::Absolute || isAbsolutePath(path)) {
        return normalizePath(path);
    }

    std::string basePath;
    switch (type) {
        case PathType::Editor:
            basePath = editorRoot_;
            break;
        case PathType::Project:
            basePath = projectRoot_;
            break;
        default:
            basePath = editorRoot_;
            break;
    }

    if (basePath.empty()) {
        return normalizePath(path);
    }

    return normalizePath(basePath + "/" + path);
}

std::string PathResolver::editorPath(const std::string& relativePath) {
    return resolve(relativePath, PathType::Editor);
}

std::string PathResolver::projectPath(const std::string& relativePath) {
    return resolve(relativePath, PathType::Project);
}

bool PathResolver::isAbsolutePath(const std::string& path) {
    if (path.empty()) return false;

#if defined(_WIN32) || defined(_WIN64)
    if (path.length() >= 2 && path[1] == ':') {
        return true;
    }
    if (path.length() >= 2 && (path[0] == '\\' && path[1] == '\\')) {
        return true;
    }
#else
    if (path[0] == '/') {
        return true;
    }
#endif

    return false;
}

std::string PathResolver::getExecutableDirectory() {
#ifdef ES_PLATFORM_WEB
    return "";

#elif defined(_WIN32) || defined(_WIN64)
    char buffer[MAX_PATH];
    DWORD length = GetModuleFileNameA(nullptr, buffer, MAX_PATH);
    if (length > 0 && length < MAX_PATH) {
        std::string path(buffer);
        auto pos = path.find_last_of("\\/");
        if (pos != std::string::npos) {
            return path.substr(0, pos);
        }
    }
    return ".";

#elif defined(__APPLE__)
    char buffer[PATH_MAX];
    uint32_t size = sizeof(buffer);
    if (_NSGetExecutablePath(buffer, &size) == 0) {
        char realPath[PATH_MAX];
        if (realpath(buffer, realPath)) {
            std::string path(realPath);
            auto pos = path.find_last_of('/');
            if (pos != std::string::npos) {
                return path.substr(0, pos);
            }
        }
    }
    return ".";

#elif defined(__linux__)
    char buffer[PATH_MAX];
    ssize_t len = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
    if (len != -1) {
        buffer[len] = '\0';
        std::string path(buffer);
        auto pos = path.find_last_of('/');
        if (pos != std::string::npos) {
            return path.substr(0, pos);
        }
    }
    return ".";

#else
    return ".";
#endif
}

std::string PathResolver::normalizePath(const std::string& path) {
    if (path.empty()) return path;

    std::string result = path;

#if defined(_WIN32) || defined(_WIN64)
    std::replace(result.begin(), result.end(), '/', '\\');

    while (result.length() > 1 && result.back() == '\\') {
        result.pop_back();
    }
#else
    std::replace(result.begin(), result.end(), '\\', '/');

    while (result.length() > 1 && result.back() == '/') {
        result.pop_back();
    }
#endif

    return result;
}

}  // namespace esengine
