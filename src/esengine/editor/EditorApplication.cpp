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
}

// =============================================================================
// Lifecycle
// =============================================================================

void EditorApplication::onInit() {
    ES_LOG_INFO("ESEngine Editor started");
    ES_LOG_INFO("Press ESC to exit");

    // Set initial clear color (dark gray)
    RenderCommand::setClearColor(clearColor_);
}

void EditorApplication::onUpdate(f32 deltaTime) {
    // Update FPS counter
    frameTime_ += deltaTime;
    frameCount_++;

    if (frameTime_ >= FPS_UPDATE_INTERVAL) {
        fps_ = static_cast<f32>(frameCount_) / static_cast<f32>(frameTime_);
        ES_LOG_TRACE("FPS: {:.1f}", fps_);
        frameTime_ = 0.0;
        frameCount_ = 0;
    }
}

void EditorApplication::onRender() {
    // Clear the screen
    RenderCommand::clear();

    // TODO: Render editor UI
    // For now, just show a blank window with the editor background color
}

void EditorApplication::onShutdown() {
    ES_LOG_INFO("ESEngine Editor shutting down");
}

void EditorApplication::onKey(KeyCode key, bool pressed) {
    if (pressed && key == KeyCode::Escape) {
        ES_LOG_INFO("ESC pressed - quitting editor");
        quit();
    }
}

void EditorApplication::onResize(u32 width, u32 height) {
    ES_LOG_DEBUG("Editor window resized to {}x{}", width, height);
}

}  // namespace editor
}  // namespace esengine
