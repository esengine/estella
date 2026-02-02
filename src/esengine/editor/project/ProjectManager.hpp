/**
 * @file    ProjectManager.hpp
 * @brief   Core project management functionality
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
#include "RecentProjectsManager.hpp"
#include "../../core/Types.hpp"

#include <string>
#include <unordered_map>

namespace esengine {
class Dispatcher;
}

namespace esengine::editor {

class AssetDatabase;

// =============================================================================
// ProjectManager
// =============================================================================

class ProjectManager {
public:
    // =========================================================================
    // Constructor
    // =========================================================================

    explicit ProjectManager(Dispatcher& dispatcher, AssetDatabase& assetDatabase);
    ~ProjectManager();

    ProjectManager(const ProjectManager&) = delete;
    ProjectManager& operator=(const ProjectManager&) = delete;

    // =========================================================================
    // Project Operations
    // =========================================================================

    [[nodiscard]] Result<bool> createProject(const std::string& directory,
                                              const std::string& name);
    [[nodiscard]] Result<bool> openProject(const std::string& projectFilePath);
    void closeProject();

    // =========================================================================
    // Project State
    // =========================================================================

    [[nodiscard]] bool hasOpenProject() const;
    [[nodiscard]] const ProjectInfo& getCurrentProject() const;
    [[nodiscard]] ProjectInfo& getCurrentProject();

    // =========================================================================
    // Settings
    // =========================================================================

    void saveProjectSettings();
    void updateSettings(const ProjectSettings& settings);

    // =========================================================================
    // Build Paths
    // =========================================================================

    [[nodiscard]] std::string getWebBuildPath() const;

    // =========================================================================
    // Recent Projects
    // =========================================================================

    [[nodiscard]] RecentProjectsManager& getRecentProjects();
    [[nodiscard]] const RecentProjectsManager& getRecentProjects() const;

private:
    void createDirectoryStructure(const std::string& rootDir);
    void copyTemplates(const std::string& rootDir);
    void checkAndSyncDependencies();
    void copyTemplateFile(const std::string& src, const std::string& dst,
                          const std::unordered_map<std::string, std::string>& vars);
    void copyTemplateDirectory(const std::string& srcDir, const std::string& dstDir,
                               const std::unordered_map<std::string, std::string>& vars);
    void updatePathResolver(const std::string& rootDir);
    void initializeAssetDatabase(const std::string& rootDir);
    void fireProjectOpenedEvent();
    void fireProjectClosedEvent();
    void fireProjectSettingsChangedEvent();

    [[nodiscard]] static std::string getParentDirectory(const std::string& path);
    [[nodiscard]] static u64 getCurrentTimestamp();

    Dispatcher& dispatcher_;
    AssetDatabase& asset_database_;
    ProjectInfo current_project_;
    RecentProjectsManager recent_projects_;
    bool has_open_project_ = false;
};

}  // namespace esengine::editor
