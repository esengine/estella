/**
 * @file    ProjectSerializer.hpp
 * @brief   Project file JSON serialization
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
// ProjectSerializer
// =============================================================================

class ProjectSerializer {
public:
    [[nodiscard]] static std::string serialize(const ProjectInfo& project);
    [[nodiscard]] static bool deserialize(const std::string& json, ProjectInfo& outProject);

    [[nodiscard]] static std::string serializeRecentProjects(
        const std::vector<RecentProject>& projects);
    [[nodiscard]] static bool deserializeRecentProjects(
        const std::string& json, std::vector<RecentProject>& outProjects);
};

}  // namespace esengine::editor
