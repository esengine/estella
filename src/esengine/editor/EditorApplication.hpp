/**
 * @file    EditorApplication.hpp
 * @brief   ESEngine Editor main application
 * @details The editor application provides a visual interface for creating
 *          and editing game content using the ESEngine framework.
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

// Project includes
#include "../core/Application.hpp"
#include "../math/Math.hpp"
#include "../events/Dispatcher.hpp"
#include "../ui/UIContext.hpp"
#include "../ui/docking/DockArea.hpp"
#include "command/CommandHistory.hpp"
#include "core/Selection.hpp"
#include "AssetDatabase.hpp"
#include "ThumbnailGenerator.hpp"
#include "DragDropManager.hpp"
#include "project/ProjectManager.hpp"

namespace esengine {
namespace editor {

class ProjectLauncherPanel;
class NewProjectDialog;

// =============================================================================
// Editor Mode
// =============================================================================

enum class EditorMode : u8 {
    Launcher,
    Editor
};

// =============================================================================
// EditorApplication Class
// =============================================================================

/**
 * @brief Main editor application class
 *
 * @details Extends the base Application class to provide editor-specific
 *          functionality including:
 *          - Event system for inter-component communication
 *          - Command history with undo/redo support
 *          - Entity selection management
 *          - Custom UI rendering
 *          - Scene editing
 *          - Asset management
 *          - Plugin system (future)
 *
 * @code
 * int main() {
 *     EditorApplication editor;
 *     return editor.run();
 * }
 * @endcode
 */
class EditorApplication : public Application {
public:
    /**
     * @brief Default constructor
     */
    EditorApplication();

    /**
     * @brief Virtual destructor
     */
    ~EditorApplication() override = default;

    // =========================================================================
    // Core Systems Access
    // =========================================================================

    /**
     * @brief Get the event dispatcher
     * @return Reference to the event dispatcher
     */
    Dispatcher& getDispatcher() { return dispatcher_; }

    /**
     * @brief Get the command history
     * @return Reference to the command history
     */
    CommandHistory& getCommandHistory() { return commandHistory_; }

    /**
     * @brief Get the entity selection
     * @return Reference to the entity selection
     */
    EntitySelection& getSelection() { return selection_; }

    /**
     * @brief Get the UI context
     * @return Reference to the UI context
     */
    ui::UIContext& getUIContext() { return *uiContext_; }

    /**
     * @brief Get the ECS registry (from base Application class)
     * @return Reference to the ECS registry
     */
    ecs::Registry& getEditorRegistry() { return Application::getRegistry(); }

    /**
     * @brief Get the asset database
     * @return Reference to the asset database
     */
    AssetDatabase& getAssetDatabase() { return assetDatabase_; }

    /**
     * @brief Get the thumbnail generator
     * @return Reference to the thumbnail generator
     */
    ThumbnailGenerator& getThumbnailGenerator() { return thumbnailGenerator_; }

    /**
     * @brief Get the drag-drop manager
     * @return Reference to the drag-drop manager
     */
    DragDropManager& getDragDropManager() { return dragDropManager_; }

    /**
     * @brief Get the project manager
     * @return Reference to the project manager
     */
    ProjectManager& getProjectManager() { return *projectManager_; }

    /**
     * @brief Get current editor mode
     * @return Current editor mode (Launcher or Editor)
     */
    EditorMode getMode() const { return mode_; }

    /**
     * @brief Switch to launcher mode
     */
    void showLauncher();

    /**
     * @brief Switch to editor mode
     */
    void showEditor();

protected:
    // =========================================================================
    // Application Lifecycle Overrides
    // =========================================================================

    /**
     * @brief Called once after engine initialization
     * @details Initializes editor-specific systems and UI.
     */
    void onInit() override;

    /**
     * @brief Called every frame
     * @param deltaTime Time since last frame in seconds
     */
    void onUpdate(f32 deltaTime) override;

    /**
     * @brief Called when rendering
     * @details Renders the editor UI and scene view.
     */
    void onRender() override;

    /**
     * @brief Called before application shutdown
     */
    void onShutdown() override;

    /**
     * @brief Called on key events
     * @param key Key code
     * @param pressed True if pressed, false if released
     */
    void onKey(KeyCode key, bool pressed) override;

    /**
     * @brief Called on window resize
     * @param width New width
     * @param height New height
     */
    void onResize(u32 width, u32 height) override;

    /**
     * @brief Called on touch/mouse input
     * @param type Touch event type
     * @param point Touch position
     */
    void onTouch(TouchType type, const TouchPoint& point) override;

private:
    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * @brief Handle undo action (Ctrl+Z)
     */
    void handleUndo();

    /**
     * @brief Handle redo action (Ctrl+Y / Ctrl+Shift+Z)
     */
    void handleRedo();

    /**
     * @brief Setup event listeners
     */
    void setupEventListeners();

    /**
     * @brief Setup editor UI layout with docking panels
     */
    void setupEditorLayout();

    /**
     * @brief Create demo entities for testing
     */
    void createDemoScene();

    /**
     * @brief Setup project launcher UI
     */
    void setupLauncherLayout();

    /**
     * @brief Handle new project request from launcher
     */
    void onNewProjectRequested();

    /**
     * @brief Handle open project request from launcher
     */
    void onOpenProjectRequested();

    // =========================================================================
    // Constants
    // =========================================================================

    /** @brief Interval in seconds between FPS updates */
    static constexpr f64 FPS_UPDATE_INTERVAL = 1.0;

    // =========================================================================
    // Core Editor Systems
    // =========================================================================

    Dispatcher dispatcher_;           ///< Central event bus
    CommandHistory commandHistory_;   ///< Undo/redo history
    EntitySelection selection_;       ///< Entity selection manager
    AssetDatabase assetDatabase_;     ///< Asset database
    ThumbnailGenerator thumbnailGenerator_; ///< Thumbnail generator
    DragDropManager dragDropManager_; ///< Drag-drop manager
    Unique<ProjectManager> projectManager_; ///< Project manager
    Unique<ui::UIContext> uiContext_; ///< UI system context
    ui::DockArea* dockArea_ = nullptr; ///< Main docking area (owned by UIContext)
    ProjectLauncherPanel* launcherPanel_ = nullptr; ///< Launcher panel (owned by UIContext)
    NewProjectDialog* newProjectDialog_ = nullptr;  ///< New project dialog

    // =========================================================================
    // State
    // =========================================================================

    EditorMode mode_ = EditorMode::Launcher;            ///< Current editor mode
    glm::vec4 clearColor_{0.15f, 0.15f, 0.15f, 1.0f};  ///< Editor background color
    f64 frameTime_ = 0.0;                               ///< Accumulated frame time
    u32 frameCount_ = 0;                                ///< Frame counter for FPS
    f32 fps_ = 0.0f;                                    ///< Frames per second
    bool ctrlPressed_ = false;                          ///< Ctrl key state
    bool shiftPressed_ = false;                         ///< Shift key state
    bool pendingShowEditor_ = false;                    ///< Deferred mode switch flag

    // =========================================================================
    // Event Connections
    // =========================================================================

    ConnectionHolder eventConnections_;                 ///< Holds event subscriptions
};

}  // namespace editor
}  // namespace esengine
