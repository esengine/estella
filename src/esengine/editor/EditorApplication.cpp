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
#include "core/EditorEvents.hpp"

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
}

// =============================================================================
// Lifecycle
// =============================================================================

void EditorApplication::onInit() {
    ES_LOG_INFO("ESEngine Editor started");
    ES_LOG_INFO("Press ESC to exit, Ctrl+Z to undo, Ctrl+Y to redo");

    RenderCommand::setClearColor(clearColor_);

    setupEventListeners();
}

void EditorApplication::onUpdate(f32 deltaTime) {
    frameTime_ += deltaTime;
    frameCount_++;

    if (frameTime_ >= FPS_UPDATE_INTERVAL) {
        fps_ = static_cast<f32>(frameCount_) / static_cast<f32>(frameTime_);
        ES_LOG_TRACE("FPS: {:.1f}", fps_);
        frameTime_ = 0.0;
        frameCount_ = 0;
    }

    dispatcher_.update();
}

void EditorApplication::onRender() {
    RenderCommand::clear();
}

void EditorApplication::onShutdown() {
    ES_LOG_INFO("ESEngine Editor shutting down");

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
}

}  // namespace editor
}  // namespace esengine
