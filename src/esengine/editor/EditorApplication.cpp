/**
 * @file    EditorApplication.cpp
 * @brief   ESEngine Editor main application implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EditorApplication.hpp"
#include "../core/Log.hpp"
#include "../renderer/RenderCommand.hpp"
#include "../math/Math.hpp"
#include "../platform/input/Input.hpp"
#include "../platform/PathResolver.hpp"
#include "../ui/widgets/Panel.hpp"
#include "../ui/widgets/Label.hpp"
#include "../ui/widgets/Button.hpp"
#include "../ui/layout/StackLayout.hpp"
#include "../ui/docking/DockArea.hpp"
#include "../ecs/components/Common.hpp"
#include "../ecs/components/Transform.hpp"
#include "../ecs/components/Hierarchy.hpp"
#include "core/EditorEvents.hpp"
#include "panels/HierarchyPanel.hpp"
#include "panels/InspectorPanel.hpp"
#include "panels/SceneViewPanel.hpp"
#include "panels/AssetBrowserPanel.hpp"
#include "panels/ProjectLauncherPanel.hpp"
#include "panels/NewProjectDialog.hpp"
#include "../platform/FileDialog.hpp"

namespace esengine {
namespace editor {

// =============================================================================
// Constructor
// =============================================================================

EditorApplication::EditorApplication()
    : Application({
        .title = "ESEngine Editor",
        .width = 1280,
        .height = 720
    }) {
    commandHistory_.setDispatcher(&dispatcher_);
    selection_.setDispatcher(&dispatcher_);
    projectManager_ = makeUnique<ProjectManager>(dispatcher_, assetDatabase_);
}

// =============================================================================
// Lifecycle
// =============================================================================

void EditorApplication::onInit() {
    ES_LOG_INFO("ESEngine Editor started");
    ES_LOG_INFO("Press ESC to exit, Ctrl+Z to undo, Ctrl+Y to redo");

    RenderCommand::setClearColor(clearColor_);

    uiContext_ = makeUnique<ui::UIContext>(getRenderContext(), dispatcher_);
    uiContext_->init();
    uiContext_->setViewport(getWidth(), getHeight());
    uiContext_->setDevicePixelRatio(getPlatform().getDevicePixelRatio());

    const char* fontPaths[] = {
#ifdef ES_PLATFORM_WINDOWS
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyhl.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
#elif defined(ES_PLATFORM_MACOS)
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/SFNS.ttf",
#else
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
#endif
        nullptr
    };

    bool fontLoaded = false;
    for (const char** path = fontPaths; *path != nullptr; ++path) {
        if (uiContext_->loadFont("default", *path, 48.0f, 8.0f)) {
            ES_LOG_INFO("Loaded SDF font: {}", *path);
            fontLoaded = true;
            break;
        }
    }

    if (!fontLoaded) {
        std::string fallbackFont = PathResolver::editorPath("assets/fonts/default.ttf");
        if (uiContext_->loadFont("default", fallbackFont, 48.0f, 8.0f)) {
            ES_LOG_INFO("Loaded SDF font: {}", fallbackFont);
            fontLoaded = true;
        }
    }

    if (!fontLoaded) {
        ES_LOG_WARN("No font loaded, text will not render");
    }

    std::string iconFontPath = PathResolver::editorPath("assets/fonts/lucide.ttf");
    if (!uiContext_->loadFont("icons", iconFontPath, 48.0f, 4.0f)) {
        ES_LOG_WARN("Icon font not loaded, icons will not render");
    }

    // Wire up scroll events to UI system
    getPlatform().setScrollCallback([this](f32 deltaX, f32 deltaY, f32 x, f32 y) {
        if (uiContext_) {
            uiContext_->processMouseScroll(deltaX, deltaY, x, y);
        }
    });

    // Wire up text input events to UI system
    getPlatform().setTextInputCallback([this](const std::string& text) {
        if (uiContext_) {
            uiContext_->processTextInput(text);
        }
    });

    // Initialize asset database with thumbnail generation callback
    assetDatabase_.setOnAssetAdded([this](const AssetMetadata& asset) {
        thumbnailGenerator_.generateThumbnail(asset.guid, asset.path, asset.type);
    });
    assetDatabase_.setProjectPath(PathResolver::projectPath("assets"));
    assetDatabase_.scan();

    // Load recent projects list
    projectManager_->getRecentProjects().load();

    setupEventListeners();

    // Start in launcher mode
    setupLauncherLayout();
}

void EditorApplication::onUpdate(f32 deltaTime) {
    if (pendingShowEditor_) {
        pendingShowEditor_ = false;
        showEditor();
        return;
    }

    frameTime_ += deltaTime;
    frameCount_++;

    if (frameTime_ >= FPS_UPDATE_INTERVAL) {
        fps_ = static_cast<f32>(frameCount_) / static_cast<f32>(frameTime_);
        ES_LOG_TRACE("FPS: {:.1f}", fps_);
        frameTime_ = 0.0;
        frameCount_ = 0;
    }

    dispatcher_.update();

    if (uiContext_) {
        uiContext_->update(deltaTime);
    }
}

void EditorApplication::onRender() {
    RenderCommand::clear();

    if (uiContext_) {
        uiContext_->render();
    }
}

void EditorApplication::onShutdown() {
    ES_LOG_INFO("ESEngine Editor shutting down");

    if (uiContext_) {
        uiContext_->shutdown();
        uiContext_.reset();
    }

    commandHistory_.clear();
    selection_.clear();
    dispatcher_.clear();
}

void EditorApplication::onKey(KeyCode key, bool pressed) {
    if (key == KeyCode::LeftControl || key == KeyCode::RightControl) {
        ctrlPressed_ = pressed;
        return;
    }

    if (key == KeyCode::LeftShift || key == KeyCode::RightShift) {
        shiftPressed_ = pressed;
        return;
    }

    // Pass key events to UI system
    if (uiContext_) {
        if (pressed) {
            uiContext_->processKeyDown(key, ctrlPressed_, shiftPressed_, false);
        } else {
            uiContext_->processKeyUp(key, ctrlPressed_, shiftPressed_, false);
        }
    }

    if (!pressed) {
        return;
    }

    if (key == KeyCode::Escape) {
        ES_LOG_INFO("ESC pressed - quitting editor");
        quit();
        return;
    }

    if (ctrlPressed_) {
        switch (key) {
            case KeyCode::Z:
                if (shiftPressed_) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                break;

            case KeyCode::Y:
                handleRedo();
                break;

            default:
                break;
        }
    }
}

void EditorApplication::onResize(u32 width, u32 height) {
    ES_LOG_DEBUG("Editor window resized to {}x{}", width, height);

    if (uiContext_) {
        uiContext_->setViewport(width, height);
        uiContext_->setDevicePixelRatio(getPlatform().getDevicePixelRatio());
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void EditorApplication::handleUndo() {
    if (commandHistory_.canUndo()) {
        ES_LOG_DEBUG("Undo: {}", commandHistory_.getUndoDescription());
        commandHistory_.undo();
    } else {
        ES_LOG_DEBUG("Nothing to undo");
    }
}

void EditorApplication::handleRedo() {
    if (commandHistory_.canRedo()) {
        ES_LOG_DEBUG("Redo: {}", commandHistory_.getRedoDescription());
        commandHistory_.redo();
    } else {
        ES_LOG_DEBUG("Nothing to redo");
    }
}

void EditorApplication::onTouch(TouchType type, const TouchPoint& point) {
    if (!uiContext_) {
        return;
    }

    glm::vec2 pos(point.x, point.y);

    switch (type) {
        case TouchType::Begin:
            uiContext_->processMouseDown(ui::MouseButton::Left, point.x, point.y);
            break;

        case TouchType::Move:
            uiContext_->processMouseMove(point.x, point.y);
            dragDropManager_.updateDrag(pos);
            break;

        case TouchType::End:
        case TouchType::Cancel:
            if (dragDropManager_.isDragging()) {
                dragDropManager_.endDrag(pos);
            }
            uiContext_->processMouseUp(ui::MouseButton::Left, point.x, point.y);
            break;
    }
}

void EditorApplication::setupEventListeners() {
    eventConnections_.add(
        dispatcher_.sink<SelectionChanged>().connect(
            [](const SelectionChanged& e) {
                ES_LOG_DEBUG("Selection changed: {} -> {} entities",
                            e.previousSelection.size(), e.currentSelection.size());
            }));

    eventConnections_.add(
        dispatcher_.sink<HistoryChanged>().connect(
            [](const HistoryChanged& e) {
                ES_LOG_TRACE("History changed - Undo: {}, Redo: {}",
                            e.canUndo ? e.undoDescription : "(none)",
                            e.canRedo ? e.redoDescription : "(none)");
            }));

    eventConnections_.add(
        dispatcher_.sink<EntityCreated>().connect(
            [](const EntityCreated& e) {
                ES_LOG_DEBUG("Entity created: {} ({})", e.entity, e.name);
            }));

    eventConnections_.add(
        dispatcher_.sink<EntityDeleted>().connect(
            [](const EntityDeleted& e) {
                ES_LOG_DEBUG("Entity deleted: {}", e.entity);
            }));

    eventConnections_.add(
        dispatcher_.sink<ProjectOpened>().connect(
            [](const ProjectOpened& e) {
                ES_LOG_INFO("Project opened: {} ({})", e.name, e.path);
            }));

    eventConnections_.add(
        dispatcher_.sink<ProjectClosed>().connect(
            [](const ProjectClosed&) {
                ES_LOG_INFO("Project closed");
            }));
}

void EditorApplication::setupEditorLayout() {
    ES_LOG_INFO("setupEditorLayout: Creating dock area...");

    // Create main dock area
    auto dockArea = makeUnique<ui::DockArea>(ui::WidgetId("editor.dock_area"));
    dockArea_ = dockArea.get();

    // Configure dock area
    dockArea_->setMinPanelSize(glm::vec2(150.0f, 100.0f));
    dockArea_->setSplitterThickness(4.0f);
    dockArea_->setTabBarHeight(26.0f);

    ES_LOG_INFO("setupEditorLayout: Creating SceneViewPanel...");
    // Create Scene View panel (center - add first as the main content)
    auto sceneViewPanel = makeUnique<SceneViewPanel>(registry_, selection_);
    ES_LOG_INFO("setupEditorLayout: SceneViewPanel created, setting min size...");
    sceneViewPanel->setMinSize(glm::vec2(400.0f, 300.0f));
    ES_LOG_INFO("setupEditorLayout: Adding SceneViewPanel to dock...");
    dockArea_->addPanel(std::move(sceneViewPanel), ui::DockDropZone::Center);

    ES_LOG_INFO("setupEditorLayout: Creating HierarchyPanel...");
    // Create Hierarchy panel (left side)
    auto hierarchyPanel = makeUnique<HierarchyPanel>(registry_, selection_);
    hierarchyPanel->setMinSize(glm::vec2(200.0f, 200.0f));
    ES_LOG_INFO("setupEditorLayout: Adding HierarchyPanel to dock...");
    dockArea_->addPanel(std::move(hierarchyPanel), ui::DockDropZone::Left, nullptr, 0.2f);

    ES_LOG_INFO("setupEditorLayout: Creating InspectorPanel...");
    // Create Inspector panel (right side)
    auto inspectorPanel = makeUnique<InspectorPanel>(registry_, selection_, commandHistory_);
    inspectorPanel->setMinSize(glm::vec2(250.0f, 200.0f));
    ES_LOG_INFO("setupEditorLayout: Adding InspectorPanel to dock...");
    dockArea_->addPanel(std::move(inspectorPanel), ui::DockDropZone::Right, nullptr, 0.25f);

    ES_LOG_INFO("setupEditorLayout: Creating AssetBrowserPanel...");
    // Create Asset Browser panel (bottom)
    auto assetBrowserPanel = makeUnique<AssetBrowserPanel>(assetDatabase_, thumbnailGenerator_);
    assetBrowserPanel->setMinSize(glm::vec2(300.0f, 200.0f));
    ES_LOG_INFO("setupEditorLayout: Adding AssetBrowserPanel to dock...");
    dockArea_->addPanel(std::move(assetBrowserPanel), ui::DockDropZone::Bottom, nullptr, 0.25f);

    ES_LOG_INFO("setupEditorLayout: Setting root widget...");
    // Set dock area as the root widget
    uiContext_->setRoot(std::move(dockArea));

    ES_LOG_INFO("Editor layout initialized with Hierarchy, SceneView, Inspector, and AssetBrowser panels");
}

void EditorApplication::createDemoScene() {
    // Create some demo entities for testing the editor

    // Root entity
    Entity root = registry_.create();
    registry_.emplace<ecs::Name>(root, "Scene Root");
    registry_.emplace<ecs::LocalTransform>(root);

    // Camera entity
    Entity camera = registry_.create();
    registry_.emplace<ecs::Name>(camera, "Main Camera");
    registry_.emplace<ecs::LocalTransform>(camera, glm::vec3(0.0f, 5.0f, 10.0f));

    // Light entity
    Entity light = registry_.create();
    registry_.emplace<ecs::Name>(light, "Directional Light");
    registry_.emplace<ecs::LocalTransform>(light, glm::vec3(0.0f, 10.0f, 0.0f));

    // Parent-child hierarchy: Player with children
    Entity player = registry_.create();
    registry_.emplace<ecs::Name>(player, "Player");
    registry_.emplace<ecs::LocalTransform>(player, glm::vec3(0.0f, 1.0f, 0.0f));

    Entity playerMesh = registry_.create();
    registry_.emplace<ecs::Name>(playerMesh, "PlayerMesh");
    registry_.emplace<ecs::LocalTransform>(playerMesh);
    registry_.emplace<ecs::Parent>(playerMesh, player);

    Entity playerWeapon = registry_.create();
    registry_.emplace<ecs::Name>(playerWeapon, "Weapon");
    registry_.emplace<ecs::LocalTransform>(playerWeapon, glm::vec3(0.5f, 0.0f, 0.0f));
    registry_.emplace<ecs::Parent>(playerWeapon, player);

    // Add children to player
    auto& playerChildren = registry_.emplace<ecs::Children>(player);
    playerChildren.entities = {playerMesh, playerWeapon};

    // Some standalone entities
    Entity ground = registry_.create();
    registry_.emplace<ecs::Name>(ground, "Ground");
    registry_.emplace<ecs::LocalTransform>(ground, glm::vec3(0.0f, 0.0f, 0.0f), glm::quat(1.0f, 0.0f, 0.0f, 0.0f), glm::vec3(100.0f, 0.1f, 100.0f));

    Entity obstacle1 = registry_.create();
    registry_.emplace<ecs::Name>(obstacle1, "Obstacle 1");
    registry_.emplace<ecs::LocalTransform>(obstacle1, glm::vec3(5.0f, 1.0f, 0.0f));

    Entity obstacle2 = registry_.create();
    registry_.emplace<ecs::Name>(obstacle2, "Obstacle 2");
    registry_.emplace<ecs::LocalTransform>(obstacle2, glm::vec3(-5.0f, 1.0f, 3.0f));

    ES_LOG_INFO("Demo scene created with {} entities", registry_.entityCount());
}

// =============================================================================
// Mode Switching
// =============================================================================

void EditorApplication::setupLauncherLayout() {
    ES_LOG_INFO("Setting up launcher layout");

    mode_ = EditorMode::Launcher;

    auto container = makeUnique<ui::Panel>(ui::WidgetId("editor.launcher_container"));
    container->setWidth(ui::SizeValue::percent(100.0f));
    container->setHeight(ui::SizeValue::percent(100.0f));

    auto launcherPanel = makeUnique<ProjectLauncherPanel>(
        ui::WidgetId("editor.launcher"),
        *projectManager_,
        dispatcher_);

    launcherPanel_ = launcherPanel.get();

    eventConnections_.add(
        sink(launcherPanel_->onCreateProjectRequested).connect([this]() {
            onNewProjectRequested();
        }));

    eventConnections_.add(
        sink(launcherPanel_->onBrowseProjectRequested).connect([this]() {
            onOpenProjectRequested();
        }));

    eventConnections_.add(
        sink(launcherPanel_->onProjectOpened).connect([this](const std::string& path) {
            auto result = projectManager_->openProject(path);
            if (result.isOk()) {
                pendingShowEditor_ = true;
            } else {
                ES_LOG_ERROR("Failed to open project: {}", result.error());
            }
        }));

    container->addChild(std::move(launcherPanel));

    auto newProjectDialog = makeUnique<NewProjectDialog>(ui::WidgetId("editor.new_project_dialog"));
    newProjectDialog_ = newProjectDialog.get();
    newProjectDialog_->hide();

    eventConnections_.add(
        sink(newProjectDialog_->onProjectCreate).connect([this](const std::string& name, const std::string& path) {
            ES_LOG_INFO("Creating project '{}' at {}", name, path);
            auto result = projectManager_->createProject(path, name);
            if (result.isOk()) {
                pendingShowEditor_ = true;
            } else {
                ES_LOG_ERROR("Failed to create project: {}", result.error());
            }
        }));

    eventConnections_.add(
        sink(newProjectDialog_->onCancel).connect([this]() {
            ES_LOG_DEBUG("New project dialog cancelled");
        }));

    container->addChild(std::move(newProjectDialog));

    uiContext_->setRoot(std::move(container));

    ES_LOG_INFO("Launcher layout initialized");
}

void EditorApplication::showLauncher() {
    if (mode_ == EditorMode::Launcher) {
        return;
    }

    ES_LOG_INFO("Switching to launcher mode");

    dockArea_ = nullptr;

    setupLauncherLayout();
}

void EditorApplication::showEditor() {
    if (mode_ == EditorMode::Editor) {
        return;
    }

    ES_LOG_INFO("Switching to editor mode");

    launcherPanel_ = nullptr;

    mode_ = EditorMode::Editor;

    createDemoScene();

    setupEditorLayout();

    ES_LOG_INFO("Editor mode active");
}

void EditorApplication::onNewProjectRequested() {
    ES_LOG_INFO("New project requested");
    if (newProjectDialog_) {
        newProjectDialog_->show();
    }
}

void EditorApplication::onOpenProjectRequested() {
    ES_LOG_INFO("Open project requested");

    std::string projectFile = FileDialog::openFile(
        "Open Project",
        {{.name = "ESEngine Project", .pattern = "*.esproject"}});

    if (projectFile.empty()) {
        ES_LOG_DEBUG("Open project cancelled");
        return;
    }

    ES_LOG_INFO("Opening project: {}", projectFile);

    auto result = projectManager_->openProject(projectFile);
    if (result.isOk()) {
        showEditor();
    } else {
        ES_LOG_ERROR("Failed to open project: {}", result.error());
    }
}

}  // namespace editor
}  // namespace esengine
