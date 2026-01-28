/**
 * @file    RecentProjectsManager.hpp
 * @brief   Recent projects list management
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

#include "ProjectTypes.hpp"

namespace esengine::editor {

// =============================================================================
// RecentProjectsManager
// =============================================================================

class RecentProjectsManager {
public:
    static constexpr usize MAX_RECENT_PROJECTS = 10;

    // =========================================================================
    // Lifecycle
    // =========================================================================

    RecentProjectsManager() = default;
    ~RecentProjectsManager() = default;

    RecentProjectsManager(const RecentProjectsManager&) = delete;
    RecentProjectsManager& operator=(const RecentProjectsManager&) = delete;

    // =========================================================================
    // Persistence
    // =========================================================================

    void load();
    void save();

    // =========================================================================
    // Project Management
    // =========================================================================

    void addProject(const std::string& path, const std::string& name);
    void removeProject(const std::string& path);
    void clearAll();

    // =========================================================================
    // Accessors
    // =========================================================================

    [[nodiscard]] const std::vector<RecentProject>& getRecentProjects() const;
    [[nodiscard]] bool hasRecentProjects() const;

private:
    [[nodiscard]] static std::string getConfigDirectory();
    [[nodiscard]] static std::string getConfigFilePath();

    std::vector<RecentProject> recent_projects_;
};

}  // namespace esengine::editor
