/**
 * @file    RecentProjectsManager.cpp
 * @brief   Recent projects list management implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "RecentProjectsManager.hpp"
#include "ProjectSerializer.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <chrono>
#include <cstdlib>

namespace esengine::editor {

// =============================================================================
// Persistence
// =============================================================================

void RecentProjectsManager::load() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string configPath = getConfigFilePath();
    if (!FileSystem::fileExists(configPath)) {
        ES_LOG_DEBUG("RecentProjectsManager: No recent projects file found");
        return;
    }

    std::string content = FileSystem::readTextFile(configPath);
    if (content.empty()) {
        return;
    }

    if (ProjectSerializer::deserializeRecentProjects(content, recent_projects_)) {
        ES_LOG_DEBUG("RecentProjectsManager: Loaded {} recent projects", recent_projects_.size());
    }
}

void RecentProjectsManager::save() {
#ifdef ES_PLATFORM_WEB
    return;
#endif

    std::string configDir = getConfigDirectory();
    if (!FileSystem::directoryExists(configDir)) {
        FileSystem::createDirectory(configDir);
    }

    std::string json = ProjectSerializer::serializeRecentProjects(recent_projects_);
    FileSystem::writeTextFile(getConfigFilePath(), json);
    ES_LOG_DEBUG("RecentProjectsManager: Saved {} recent projects", recent_projects_.size());
}

// =============================================================================
// Project Management
// =============================================================================

void RecentProjectsManager::addProject(const std::string& path, const std::string& name) {
    auto it = std::find_if(recent_projects_.begin(), recent_projects_.end(),
        [&path](const RecentProject& p) { return p.path == path; });

    auto now = std::chrono::system_clock::now();
    auto timestamp = static_cast<u64>(
        std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count());

    if (it != recent_projects_.end()) {
        it->lastOpened = timestamp;
        it->name = name;
        std::rotate(recent_projects_.begin(), it, it + 1);
    } else {
        RecentProject project;
        project.path = path;
        project.name = name;
        project.lastOpened = timestamp;
        recent_projects_.insert(recent_projects_.begin(), project);

        if (recent_projects_.size() > MAX_RECENT_PROJECTS) {
            recent_projects_.resize(MAX_RECENT_PROJECTS);
        }
    }

    save();
}

void RecentProjectsManager::removeProject(const std::string& path) {
    auto it = std::remove_if(recent_projects_.begin(), recent_projects_.end(),
        [&path](const RecentProject& p) { return p.path == path; });

    if (it != recent_projects_.end()) {
        recent_projects_.erase(it, recent_projects_.end());
        save();
    }
}

void RecentProjectsManager::clearAll() {
    recent_projects_.clear();
    save();
}

// =============================================================================
// Accessors
// =============================================================================

const std::vector<RecentProject>& RecentProjectsManager::getRecentProjects() const {
    return recent_projects_;
}

bool RecentProjectsManager::hasRecentProjects() const {
    return !recent_projects_.empty();
}

// =============================================================================
// Config Path
// =============================================================================

std::string RecentProjectsManager::getConfigDirectory() {
#if defined(_WIN32) || defined(_WIN64)
    const char* appData = std::getenv("APPDATA");
    if (appData) {
        return std::string(appData) + "\\ESEngine";
    }
    return "";
#elif defined(__APPLE__)
    const char* home = std::getenv("HOME");
    if (home) {
        return std::string(home) + "/Library/Application Support/ESEngine";
    }
    return "";
#else
    const char* home = std::getenv("HOME");
    if (home) {
        return std::string(home) + "/.config/esengine";
    }
    return "";
#endif
}

std::string RecentProjectsManager::getConfigFilePath() {
    std::string dir = getConfigDirectory();
    if (dir.empty()) {
        return "";
    }
#if defined(_WIN32) || defined(_WIN64)
    return dir + "\\recent_projects.json";
#else
    return dir + "/recent_projects.json";
#endif
}

}  // namespace esengine::editor
