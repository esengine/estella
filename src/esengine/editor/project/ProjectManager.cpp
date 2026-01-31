/**
 * @file    ProjectManager.cpp
 * @brief   Core project management implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ProjectManager.hpp"
#include "ProjectSerializer.hpp"
#include "../AssetDatabase.hpp"
#include "../core/EditorEvents.hpp"
#include "../../events/Dispatcher.hpp"
#include "../../platform/FileSystem.hpp"
#include "../../platform/PathResolver.hpp"
#include "../../core/Log.hpp"

#include <algorithm>
#include <chrono>

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

ProjectManager::ProjectManager(Dispatcher& dispatcher, AssetDatabase& assetDatabase)
    : dispatcher_(dispatcher)
    , asset_database_(assetDatabase) {
}

ProjectManager::~ProjectManager() {
    if (has_open_project_) {
        closeProject();
    }
}

// =============================================================================
// Project Operations
// =============================================================================

Result<bool> ProjectManager::createProject(const std::string& directory,
                                            const std::string& name) {
#ifdef ES_PLATFORM_WEB
    return Result<bool>::err("Project creation not supported on web platform");
#endif

    if (directory.empty()) {
        return Result<bool>::err("Directory path cannot be empty");
    }

    if (name.empty()) {
        return Result<bool>::err("Project name cannot be empty");
    }

    if (FileSystem::directoryExists(directory)) {
        return Result<bool>::err("Directory already exists: " + directory);
    }

    ES_LOG_INFO("ProjectManager: Creating project '{}' at {}", name, directory);

    if (!FileSystem::createDirectory(directory)) {
        return Result<bool>::err("Failed to create project directory");
    }

    createDirectoryStructure(directory);

    ProjectInfo project;
    project.name = name;
    project.rootDirectory = directory;
    project.path = directory + "/" + PROJECT_FILE_NAME;
    project.engineVersion = ENGINE_VERSION;
    project.formatVersion = PROJECT_FORMAT_VERSION;
    project.created = getCurrentTimestamp();
    project.lastOpened = project.created;
    project.settings.targetPlatforms = {TargetPlatform::Windows};
    project.settings.defaultScene = "scenes/main.scene";
    project.settings.renderer.defaultWidth = 1280;
    project.settings.renderer.defaultHeight = 720;
    project.settings.renderer.vsync = true;

    std::string json = ProjectSerializer::serialize(project);
    if (!FileSystem::writeTextFile(project.path, json)) {
        return Result<bool>::err("Failed to write project file");
    }

    ES_LOG_INFO("ProjectManager: Project created successfully");

    auto result = openProject(project.path);
    if (result.isErr()) {
        return result;
    }

    return Result<bool>::ok(true);
}

Result<bool> ProjectManager::openProject(const std::string& projectFilePath) {
#ifdef ES_PLATFORM_WEB
    return Result<bool>::err("Project opening not supported on web platform");
#endif

    if (projectFilePath.empty()) {
        return Result<bool>::err("Project file path cannot be empty");
    }

    if (!FileSystem::fileExists(projectFilePath)) {
        return Result<bool>::err("Project file not found: " + projectFilePath);
    }

    ES_LOG_INFO("ProjectManager: Opening project from {}", projectFilePath);

    if (has_open_project_) {
        closeProject();
    }

    std::string content = FileSystem::readTextFile(projectFilePath);
    if (content.empty()) {
        return Result<bool>::err("Failed to read project file");
    }

    ProjectInfo project;
    if (!ProjectSerializer::deserialize(content, project)) {
        return Result<bool>::err("Failed to parse project file");
    }

    project.path = projectFilePath;
    project.rootDirectory = getParentDirectory(projectFilePath);
    project.lastOpened = getCurrentTimestamp();

    std::string updatedJson = ProjectSerializer::serialize(project);
    FileSystem::writeTextFile(projectFilePath, updatedJson);

    current_project_ = std::move(project);
    has_open_project_ = true;

    updatePathResolver(current_project_.rootDirectory);
    initializeAssetDatabase(current_project_.rootDirectory);

    recent_projects_.addProject(current_project_.path, current_project_.name);

    fireProjectOpenedEvent();

    checkAndSyncDependencies();

    ES_LOG_INFO("ProjectManager: Project '{}' opened successfully", current_project_.name);

    return Result<bool>::ok(true);
}

void ProjectManager::closeProject() {
    if (!has_open_project_) {
        return;
    }

    ES_LOG_INFO("ProjectManager: Closing project '{}'", current_project_.name);

    fireProjectClosedEvent();

    current_project_ = ProjectInfo{};
    has_open_project_ = false;

    PathResolver::setProjectRoot("");
}

// =============================================================================
// Project State
// =============================================================================

bool ProjectManager::hasOpenProject() const {
    return has_open_project_;
}

const ProjectInfo& ProjectManager::getCurrentProject() const {
    return current_project_;
}

ProjectInfo& ProjectManager::getCurrentProject() {
    return current_project_;
}

// =============================================================================
// Settings
// =============================================================================

void ProjectManager::saveProjectSettings() {
    if (!has_open_project_) {
        ES_LOG_WARN("ProjectManager: No project open, cannot save settings");
        return;
    }

    std::string json = ProjectSerializer::serialize(current_project_);
    if (FileSystem::writeTextFile(current_project_.path, json)) {
        ES_LOG_DEBUG("ProjectManager: Project settings saved");
    } else {
        ES_LOG_ERROR("ProjectManager: Failed to save project settings");
    }
}

void ProjectManager::updateSettings(const ProjectSettings& settings) {
    if (!has_open_project_) {
        return;
    }

    current_project_.settings = settings;
    saveProjectSettings();
    fireProjectSettingsChangedEvent();
}

// =============================================================================
// Build Paths
// =============================================================================

std::string ProjectManager::getWebBuildPath() const {
    if (!has_open_project_) {
        return "";
    }
    return current_project_.rootDirectory + "/build/web";
}

// =============================================================================
// Recent Projects
// =============================================================================

RecentProjectsManager& ProjectManager::getRecentProjects() {
    return recent_projects_;
}

const RecentProjectsManager& ProjectManager::getRecentProjects() const {
    return recent_projects_;
}

// =============================================================================
// Private Methods
// =============================================================================

void ProjectManager::createDirectoryStructure(const std::string& rootDir) {
    const std::vector<std::string> directories = {
        "/src",                 // User source code
        "/assets",              // Resources only
        "/assets/scenes",
        "/assets/textures",
        "/assets/audio",
        "/assets/fonts",
        "/assets/prefabs",
        "/assets/shaders",
        "/build",               // Build output (should be gitignored)
        "/.esengine"            // Editor cache (should be gitignored)
    };

    for (const auto& dir : directories) {
        FileSystem::createDirectory(rootDir + dir);
    }

    createProjectFiles(rootDir);
    createGitignore(rootDir);
}

void ProjectManager::createProjectFiles(const std::string& rootDir) {
    std::string sdkDir = PathResolver::editorPath("bindings");
    // Convert backslashes to forward slashes for JSON/npm compatibility
    std::replace(sdkDir.begin(), sdkDir.end(), '\\', '/');

    // Generate package.json in project root
    std::string packageJson = R"({
  "name": ")" + current_project_.name + R"(",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "npx esbuild src/main.ts --bundle --format=esm --outfile=build/js/main.js --sourcemap",
    "dev": "npx esbuild src/main.ts --bundle --format=esm --outfile=build/js/main.js --sourcemap --watch",
    "typecheck": "npx tsc --noEmit"
  },
  "dependencies": {
    "esengine": "file:)" + sdkDir + R"("
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
)";
    FileSystem::writeTextFile(rootDir + "/package.json", packageJson);
    ES_LOG_DEBUG("Created package.json");

    // Generate tsconfig.json in project root (for type checking and IDE support)
    std::string tsconfig = R"({
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "build"]
}
)";
    FileSystem::writeTextFile(rootDir + "/tsconfig.json", tsconfig);
    ES_LOG_DEBUG("Created tsconfig.json");

    // Create main.ts in src/ directory
    std::string mainScript = R"(/**
 * @file    main.ts
 * @brief   Game entry point
 */

import { App, StartupSystem, LocalTransform, Sprite } from 'esengine';

class SetupSystem extends StartupSystem {
    onStart(): void {
        // Create a simple sprite entity
        this.world_.spawn()
            .with(LocalTransform, {
                position: { x: 400, y: 300, z: 0 }
            })
            .with(Sprite, {
                color: { x: 1, y: 1, z: 1, w: 1 },
                size: { x: 64, y: 64 }
            });

        console.log('Game started!');
    }
}

/**
 * Game entry point - called by the engine after WASM is loaded
 */
export function main(module: any): void {
    const app = new App(module, {
        title: ')" + current_project_.name + R"(',
        width: 800,
        height: 600
    });

    app.addStartupSystem(new SetupSystem());
    app.run();
}
)";
    FileSystem::writeTextFile(rootDir + "/src/main.ts", mainScript);
    ES_LOG_DEBUG("Created src/main.ts");
}

void ProjectManager::createGitignore(const std::string& rootDir) {
    std::string gitignore = R"(# Dependencies
node_modules/

# Build output
build/
dist/

# Editor cache
.esengine/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
)";
    FileSystem::writeTextFile(rootDir + "/.gitignore", gitignore);
    ES_LOG_DEBUG("Created .gitignore");
}

void ProjectManager::updatePathResolver(const std::string& rootDir) {
    PathResolver::setProjectRoot(rootDir);
    ES_LOG_DEBUG("ProjectManager: PathResolver project root set to {}", rootDir);
}

void ProjectManager::initializeAssetDatabase(const std::string& rootDir) {
    asset_database_.setProjectPath(rootDir);
    asset_database_.scan();
}

void ProjectManager::fireProjectOpenedEvent() {
    dispatcher_.trigger(ProjectOpened{
        .path = current_project_.path,
        .name = current_project_.name
    });
}

void ProjectManager::fireProjectClosedEvent() {
    dispatcher_.trigger(ProjectClosed{});
}

void ProjectManager::fireProjectSettingsChangedEvent() {
    dispatcher_.trigger(ProjectSettingsChanged{});
}

std::string ProjectManager::getParentDirectory(const std::string& path) {
    usize pos = path.find_last_of("/\\");
    if (pos != std::string::npos) {
        return path.substr(0, pos);
    }
    return path;
}

u64 ProjectManager::getCurrentTimestamp() {
    auto now = std::chrono::system_clock::now();
    return static_cast<u64>(
        std::chrono::duration_cast<std::chrono::seconds>(now.time_since_epoch()).count());
}

void ProjectManager::checkAndSyncDependencies() {
    std::string rootDir = current_project_.rootDirectory;
    std::string packageJsonPath = rootDir + "/package.json";
    std::string nodeModulesPath = rootDir + "/node_modules";
    std::string esengineModulePath = nodeModulesPath + "/esengine";

    // Check if package.json exists
    if (!FileSystem::fileExists(packageJsonPath)) {
        ES_LOG_INFO("No package.json found, creating project files...");
        createProjectFiles(rootDir);
        return;
    }

    // Check if node_modules/esengine exists
    if (!FileSystem::directoryExists(esengineModulePath)) {
        ES_LOG_WARN("Dependencies not installed. Please run 'npm install' in {}", rootDir);
    }

    // Update package.json with current SDK path (in case engine location changed)
    std::string sdkDir = PathResolver::editorPath("bindings");
    // Convert backslashes to forward slashes for JSON/npm compatibility
    std::replace(sdkDir.begin(), sdkDir.end(), '\\', '/');
    std::string currentPackageJson = FileSystem::readTextFile(packageJsonPath);

    // Check if SDK path needs updating
    if (currentPackageJson.find(sdkDir) == std::string::npos) {
        ES_LOG_INFO("Updating package.json with current SDK path...");

        std::string packageJson = R"({
  "name": ")" + current_project_.name + R"(",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "npx esbuild src/main.ts --bundle --format=esm --outfile=build/js/main.js --sourcemap",
    "dev": "npx esbuild src/main.ts --bundle --format=esm --outfile=build/js/main.js --sourcemap --watch",
    "typecheck": "npx tsc --noEmit"
  },
  "dependencies": {
    "esengine": "file:)" + sdkDir + R"("
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
)";
        FileSystem::writeTextFile(packageJsonPath, packageJson);
        ES_LOG_INFO("package.json updated. Please run 'npm install' to update dependencies.");
    }
}

}  // namespace esengine::editor
