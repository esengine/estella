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
#include "../ui/widgets/Panel.hpp"
#include "../ui/widgets/Label.hpp"
#include "../ui/widgets/Button.hpp"
#include "../ui/layout/StackLayout.hpp"
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

    uiContext_ = makeUnique<ui::UIContext>(getRenderContext(), dispatcher_);
    uiContext_->init();
    uiContext_->setViewport(getWidth(), getHeight());

    // Wire up scroll events to UI system
    getPlatform().setScrollCallback([this](f32 deltaX, f32 deltaY, f32 x, f32 y) {
        if (uiContext_) {
            uiContext_->processMouseScroll(deltaX, deltaY, x, y);
        }
    });

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

    switch (type) {
        case TouchType::Begin:
            uiContext_->processMouseDown(ui::MouseButton::Left, point.x, point.y);
            break;

        case TouchType::Move:
            uiContext_->processMouseMove(point.x, point.y);
            break;

        case TouchType::End:
        case TouchType::Cancel:
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
}

}  // namespace editor
}  // namespace esengine
