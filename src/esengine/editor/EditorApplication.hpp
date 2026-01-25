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
#include "command/CommandHistory.hpp"
#include "core/Selection.hpp"

namespace esengine {
namespace editor {

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
    Unique<ui::UIContext> uiContext_; ///< UI system context

    // =========================================================================
    // State
    // =========================================================================

    glm::vec4 clearColor_{0.15f, 0.15f, 0.15f, 1.0f};  ///< Editor background color
    f64 frameTime_ = 0.0;                               ///< Accumulated frame time
    u32 frameCount_ = 0;                                ///< Frame counter for FPS
    f32 fps_ = 0.0f;                                    ///< Frames per second
    bool ctrlPressed_ = false;                          ///< Ctrl key state
    bool shiftPressed_ = false;                         ///< Shift key state

    // =========================================================================
    // Event Connections
    // =========================================================================

    ConnectionHolder eventConnections_;                 ///< Holds event subscriptions
};

}  // namespace editor
}  // namespace esengine
