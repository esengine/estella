/**
 * @file    PathResolver.hpp
 * @brief   Cross-platform path resolution for editor and project resources
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#pragma once

#include "../core/Types.hpp"
#include <string>

namespace esengine {

enum class PathType {
    Editor,   // Relative to executable directory
    Project,  // Relative to project directory
    Absolute  // Use path as-is
};

/**
 * @brief Cross-platform path resolver for editor and project resources
 *
 * @details Distinguishes between:
 *          - Editor assets: fonts, themes, built-in resources (relative to exe)
 *          - Project assets: user scenes, textures, scripts (relative to project root)
 */
class PathResolver {
public:
    static void init();
    static void shutdown();

    static void setProjectRoot(const std::string& path);
    [[nodiscard]] static const std::string& getProjectRoot();

    [[nodiscard]] static const std::string& getEditorRoot();

    [[nodiscard]] static std::string resolve(const std::string& path, PathType type);

    [[nodiscard]] static std::string editorPath(const std::string& relativePath);
    [[nodiscard]] static std::string projectPath(const std::string& relativePath);

    [[nodiscard]] static bool isAbsolutePath(const std::string& path);

private:
    PathResolver() = delete;

    static std::string getExecutableDirectory();
    static std::string normalizePath(const std::string& path);

    static std::string editorRoot_;
    static std::string projectRoot_;
    static bool initialized_;
};

}  // namespace esengine
