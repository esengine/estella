/**
 * @file    WebExporter.hpp
 * @brief   Web build exporter for game projects
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../../core/Types.hpp"
#include <string>
#include <functional>

namespace esengine::editor {

/**
 * @brief Exports game project to web-ready format
 */
class WebExporter {
public:
    using ProgressCallback = std::function<void(const std::string& status, f32 progress)>;

    /**
     * @brief Export project to web format
     * @param projectPath Root directory of the game project
     * @param sdkPath Path to the prebuilt web SDK (build-web/sdk)
     * @param outputPath Output directory (usually project/build/web)
     * @param callback Optional progress callback
     * @return true if export succeeded
     */
    static bool exportProject(
        const std::string& projectPath,
        const std::string& sdkPath,
        const std::string& outputPath,
        ProgressCallback callback = nullptr
    );

private:
    static bool ensureDependencies(const std::string& projectPath, ProgressCallback& callback);
    static bool compileTypeScript(const std::string& projectPath, ProgressCallback& callback);
    static bool copySDKFiles(const std::string& sdkPath, const std::string& outputPath, ProgressCallback& callback);
    static bool copyAssets(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback);
    static bool copyUserScripts(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback);
    static bool generateIndexHtml(const std::string& outputPath, const std::string& projectName);
};

}  // namespace esengine::editor
