/**
 * @file    SceneSerializer.hpp
 * @brief   Scene serialization to/from JSON files
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

#include "../../core/Types.hpp"
#include "../../ecs/Registry.hpp"
#include "../../resource/ResourceManager.hpp"

#include <string>

namespace esengine::editor {

// =============================================================================
// Scene Format Version
// =============================================================================

constexpr u32 SCENE_FORMAT_VERSION = 1;

// =============================================================================
// SceneSerializer
// =============================================================================

/**
 * @brief Serializes scene data to/from JSON files
 */
class SceneSerializer {
public:
    /**
     * @brief Saves all entities in the registry to a JSON file
     * @param registry The registry containing entities to save
     * @param filePath Path to the output .esscene file
     * @param sceneName Name of the scene
     * @param resourceManager Resource manager for looking up texture paths (optional)
     * @param projectPath Project root path for making paths relative (optional)
     * @return true if save succeeded
     */
    [[nodiscard]] static bool saveScene(
        const ecs::Registry& registry,
        const std::string& filePath,
        const std::string& sceneName = "Untitled",
        const resource::ResourceManager* resourceManager = nullptr,
        const std::string& projectPath = ""
    );

    /**
     * @brief Loads entities from a JSON file into the registry
     * @param registry The registry to populate (will be cleared first)
     * @param filePath Path to the .esscene file
     * @return true if load succeeded
     */
    [[nodiscard]] static bool loadScene(
        ecs::Registry& registry,
        const std::string& filePath
    );

    /**
     * @brief Clears all entities from the registry
     * @param registry The registry to clear
     */
    static void clearScene(ecs::Registry& registry);

    /**
     * @brief Gets the scene name from a file path
     * @param filePath Full path to .esscene file
     * @return Scene name extracted from filename
     */
    [[nodiscard]] static std::string getSceneName(const std::string& filePath);
};

}  // namespace esengine::editor
