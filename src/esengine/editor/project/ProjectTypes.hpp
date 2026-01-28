/**
 * @file    ProjectTypes.hpp
 * @brief   Project management type definitions
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

#include <string>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Constants
// =============================================================================

constexpr const char* PROJECT_FILE_NAME = "project.esproject";
constexpr const char* ENGINE_VERSION = "1.0.0";
constexpr u32 PROJECT_FORMAT_VERSION = 1;

// =============================================================================
// Target Platform
// =============================================================================

enum class TargetPlatform : u8 {
    Windows,
    MacOS,
    Linux,
    Web,
    WxGame
};

[[nodiscard]] inline const char* targetPlatformToString(TargetPlatform platform) {
    switch (platform) {
        case TargetPlatform::Windows: return "windows";
        case TargetPlatform::MacOS: return "macos";
        case TargetPlatform::Linux: return "linux";
        case TargetPlatform::Web: return "web";
        case TargetPlatform::WxGame: return "wxgame";
    }
    return "unknown";
}

[[nodiscard]] inline TargetPlatform targetPlatformFromString(const std::string& str) {
    if (str == "windows") return TargetPlatform::Windows;
    if (str == "macos") return TargetPlatform::MacOS;
    if (str == "linux") return TargetPlatform::Linux;
    if (str == "web") return TargetPlatform::Web;
    if (str == "wxgame") return TargetPlatform::WxGame;
    return TargetPlatform::Windows;
}

// =============================================================================
// Project Settings
// =============================================================================

struct RendererSettings {
    u32 defaultWidth = 1280;
    u32 defaultHeight = 720;
    bool vsync = true;
};

struct ProjectSettings {
    std::vector<TargetPlatform> targetPlatforms{TargetPlatform::Windows};
    std::string defaultScene;
    RendererSettings renderer;
};

// =============================================================================
// Project Info
// =============================================================================

struct ProjectInfo {
    std::string name;
    std::string path;
    std::string rootDirectory;
    std::string engineVersion{ENGINE_VERSION};
    u32 formatVersion{PROJECT_FORMAT_VERSION};
    u64 created = 0;
    u64 lastOpened = 0;
    ProjectSettings settings;

    [[nodiscard]] bool isValid() const {
        return !name.empty() && !path.empty() && !rootDirectory.empty();
    }
};

// =============================================================================
// Recent Project
// =============================================================================

struct RecentProject {
    std::string path;
    std::string name;
    u64 lastOpened = 0;
};

}  // namespace esengine::editor
