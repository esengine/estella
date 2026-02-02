/**
 * @file    WebExporter.cpp
 * @brief   Web build exporter implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "WebExporter.hpp"
#include "../../core/Log.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../platform/PathResolver.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>

namespace fs = std::filesystem;

namespace esengine::editor {

std::atomic<bool> WebExporter::exporting_{false};
std::future<bool> WebExporter::exportFuture_;

bool WebExporter::isExporting() {
    return exporting_.load();
}

void WebExporter::exportProjectAsync(
    const std::string& projectPath,
    const std::string& sdkPath,
    const std::string& outputPath,
    CompletionCallback onComplete
) {
    if (exporting_.load()) {
        ES_LOG_WARN("Export already in progress");
        if (onComplete) onComplete(false);
        return;
    }

    exporting_.store(true);

    exportFuture_ = std::async(std::launch::async,
        [projectPath, sdkPath, outputPath, onComplete]() {
            bool result = exportProject(projectPath, sdkPath, outputPath, nullptr);
            exporting_.store(false);
            if (onComplete) onComplete(result);
            return result;
        }
    );
}

bool WebExporter::exportProject(
    const std::string& projectPath,
    const std::string& sdkPath,
    const std::string& outputPath,
    ProgressCallback callback
) {
    ES_LOG_INFO("Exporting project to web: {}", outputPath);

    if (callback) callback("Creating output directory...", 0.0f);

    try {
        fs::create_directories(outputPath);
    } catch (const std::exception& e) {
        ES_LOG_ERROR("Failed to create output directory: {}", e.what());
        return false;
    }

    if (callback) callback("Checking dependencies...", 0.05f);
    if (!ensureDependencies(projectPath, callback)) {
        return false;
    }

    if (callback) callback("Compiling TypeScript...", 0.15f);
    if (!compileTypeScript(projectPath, callback)) {
        return false;
    }

    if (callback) callback("Copying SDK files...", 0.35f);
    if (!copySDKFiles(sdkPath, outputPath, callback)) {
        return false;
    }

    if (callback) callback("Copying assets...", 0.5f);
    if (!copyAssets(projectPath, outputPath, callback)) {
        return false;
    }

    if (callback) callback("Copying user scripts...", 0.7f);
    if (!copyUserScripts(projectPath, outputPath, callback)) {
        return false;
    }

    if (callback) callback("Generating index.html...", 0.9f);
    std::string projectName = fs::path(projectPath).filename().string();
    if (!generateIndexHtml(outputPath, projectName)) {
        return false;
    }

    if (callback) callback("Export complete!", 1.0f);
    ES_LOG_INFO("Web export completed successfully");
    return true;
}

bool WebExporter::ensureDependencies(const std::string& projectPath, ProgressCallback& callback) {
    fs::path nodeModules = fs::path(projectPath) / "node_modules";
    fs::path packageJson = fs::path(projectPath) / "package.json";
    fs::path packageLock = fs::path(projectPath) / "package-lock.json";

    // Check if package.json exists
    if (!fs::exists(packageJson)) {
        ES_LOG_ERROR("No package.json found in project. Please create project files first.");
        return false;
    }

    bool needsInstall = false;

    // Check if node_modules/esengine exists
    fs::path esengineModule = nodeModules / "esengine";
    if (!fs::exists(esengineModule)) {
        needsInstall = true;
    } else {
        // Check if package.json is newer than package-lock.json (SDK path may have changed)
        if (fs::exists(packageLock)) {
            auto pkgTime = fs::last_write_time(packageJson);
            auto lockTime = fs::last_write_time(packageLock);
            if (pkgTime > lockTime) {
                ES_LOG_INFO("package.json updated, reinstalling dependencies...");
                needsInstall = true;
            }
        }
    }

    if (!needsInstall) {
        ES_LOG_DEBUG("Dependencies already installed");
        return true;
    }

    // Install dependencies
    ES_LOG_INFO("Installing dependencies (npm install)...");
    if (callback) callback("Installing npm dependencies...", 0.08f);

#ifdef _WIN32
    std::string cmd = "cd /d \"" + projectPath + "\" && npm install";
#else
    std::string cmd = "cd \"" + projectPath + "\" && npm install";
#endif

    int result = std::system(cmd.c_str());

    if (result != 0) {
        ES_LOG_ERROR("npm install failed (exit code: {}). Please run 'npm install' manually in the project directory.", result);
        return false;
    }

    ES_LOG_INFO("Dependencies installed successfully");
    return true;
}

bool WebExporter::compileTypeScript(const std::string& projectPath, ProgressCallback& callback) {
    fs::path srcDir = fs::path(projectPath) / "src";
    fs::path buildDir = fs::path(projectPath) / "build" / "js";
    fs::path mainTs = srcDir / "main.ts";
    fs::path mainJs = buildDir / "main.js";

    // Check if source exists
    if (!fs::exists(mainTs)) {
        ES_LOG_ERROR("No src/main.ts found in project");
        return false;
    }

    // Create build directory if needed
    if (!fs::exists(buildDir)) {
        fs::create_directories(buildDir);
    }

    // Always recompile for web preview to ensure latest SDK changes are included
    // (SDK files in node_modules/esengine may have been updated)

    // Run esbuild to bundle and compile
    ES_LOG_INFO("Bundling TypeScript with esbuild...");

#ifdef _WIN32
    std::string cmd = "cd /d \"" + projectPath + "\" && npm run build";
#else
    std::string cmd = "cd \"" + projectPath + "\" && npm run build";
#endif

    int result = std::system(cmd.c_str());

    if (result != 0) {
        ES_LOG_ERROR("Build failed (exit code: {})", result);
        return false;
    }

    if (!fs::exists(mainJs)) {
        ES_LOG_ERROR("Build did not produce build/js/main.js");
        return false;
    }

    ES_LOG_INFO("Build completed successfully");
    return true;
}

bool WebExporter::copyUserScripts(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback) {
    fs::path srcScripts = fs::path(projectPath) / "build" / "js";
    fs::path dstScripts = fs::path(outputPath) / "scripts";

    if (!fs::exists(srcScripts)) {
        ES_LOG_ERROR("Compiled scripts not found at {}", srcScripts.string());
        return false;
    }

    try {
        if (fs::exists(dstScripts)) {
            fs::remove_all(dstScripts);
        }
        fs::copy(srcScripts, dstScripts, fs::copy_options::recursive | fs::copy_options::overwrite_existing);
        ES_LOG_DEBUG("Copied user scripts to {}", dstScripts.string());
    } catch (const std::exception& e) {
        ES_LOG_ERROR("Failed to copy user scripts: {}", e.what());
        return false;
    }

    return true;
}

bool WebExporter::copySDKFiles(const std::string& sdkPath, const std::string& outputPath, ProgressCallback& callback) {
    const char* sdkFiles[] = {
        "esengine.js",
        "esengine.wasm",
        "esengine.d.ts"
    };

    for (const char* file : sdkFiles) {
        fs::path src = fs::path(sdkPath) / file;
        fs::path dst = fs::path(outputPath) / file;

        if (!fs::exists(src)) {
            if (std::string(file) == "esengine.d.ts") {
                continue;
            }
            ES_LOG_ERROR("SDK file not found: {}", src.string());
            return false;
        }

        try {
            fs::copy_file(src, dst, fs::copy_options::overwrite_existing);
            ES_LOG_DEBUG("Copied: {}", file);
        } catch (const std::exception& e) {
            ES_LOG_ERROR("Failed to copy {}: {}", file, e.what());
            return false;
        }
    }

    return true;
}

bool WebExporter::copyAssets(const std::string& projectPath, const std::string& outputPath, ProgressCallback& callback) {
    fs::path srcAssets = fs::path(projectPath) / "assets";
    fs::path dstAssets = fs::path(outputPath) / "assets";

    if (!fs::exists(srcAssets)) {
        ES_LOG_WARN("No assets directory found in project");
        return true;
    }

    try {
        if (fs::exists(dstAssets)) {
            fs::remove_all(dstAssets);
        }
        fs::copy(srcAssets, dstAssets, fs::copy_options::recursive | fs::copy_options::overwrite_existing);
        ES_LOG_DEBUG("Copied assets directory");
    } catch (const std::exception& e) {
        ES_LOG_ERROR("Failed to copy assets: {}", e.what());
        return false;
    }

    return true;
}

bool WebExporter::generateIndexHtml(const std::string& outputPath, const std::string& projectName) {
    std::string templatePath = PathResolver::editorPath("assets/templates/web/index.html");
    std::string content = FileSystem::readTextFile(templatePath);

    if (content.empty()) {
        ES_LOG_ERROR("Failed to read index.html template from {}", templatePath);
        return false;
    }

    std::string placeholder = "{{PROJECT_NAME}}";
    size_t pos = 0;
    while ((pos = content.find(placeholder, pos)) != std::string::npos) {
        content.replace(pos, placeholder.length(), projectName);
        pos += projectName.length();
    }

    std::string indexPath = outputPath + "/index.html";
    if (!FileSystem::writeTextFile(indexPath, content)) {
        ES_LOG_ERROR("Failed to write index.html");
        return false;
    }

    ES_LOG_DEBUG("Generated index.html");
    return true;
}

}  // namespace esengine::editor
