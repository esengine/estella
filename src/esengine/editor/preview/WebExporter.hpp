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
#include <future>
#include <atomic>

namespace esengine::editor {

/**
 * @brief Exports game project to web-ready format
 */
class WebExporter {
public:
    using ProgressCallback = std::function<void(const std::string& status, f32 progress)>;
    using CompletionCallback = std::function<void(bool success)>;

    /**
     * @brief Export project to web format (blocking)
     */
    static bool exportProject(
        const std::string& projectPath,
        const std::string& sdkPath,
        const std::string& outputPath,
        ProgressCallback callback = nullptr
    );

    /**
     * @brief Export project to web format (async, non-blocking)
     */
    static void exportProjectAsync(
        const std::string& projectPath,
        const std::string& sdkPath,
        const std::string& outputPath,
        CompletionCallback onComplete
    );

    /** @brief Check if async export is running */
    static bool isExporting();

private:
    static std::atomic<bool> exporting_;
    static std::future<bool> exportFuture_;

    static bool ensureDependencies(const std::string& projectPath, ProgressCallback& callback);
    static bool compileTypeScript(const std::string& projectPath, ProgressCallback& callback);
    static bool copySDKFiles(const std::string& sdkPath, const std::string& outputPath, ProgressCallback& callback);
    static bool copyAssets(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback);
    static bool copyUserScripts(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback);
    static bool generateIndexHtml(const std::string& outputPath, const std::string& projectName);
};

}  // namespace esengine::editor
