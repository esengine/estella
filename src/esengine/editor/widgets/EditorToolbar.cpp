/**
 * @file    EditorToolbar.cpp
 * @brief   Editor toolbar implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EditorToolbar.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/icons/Icons.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

#include "../../ui/font/SystemFont.hpp"

namespace esengine::editor {

namespace icons = ui::icons;

// =============================================================================
// Constructor
// =============================================================================

EditorToolbar::EditorToolbar(const ui::WidgetId& id) : Widget(id) {}

// =============================================================================
// State Control
// =============================================================================

void EditorToolbar::play() {
    if (state_ != PlayState::Playing) {
        state_ = PlayState::Playing;
        onPlay.publish();
    }
}

void EditorToolbar::pause() {
    if (state_ == PlayState::Playing) {
        state_ = PlayState::Paused;
        onPause.publish();
    }
}

void EditorToolbar::stop() {
    if (state_ != PlayState::Stopped) {
        state_ = PlayState::Stopped;
        onStop.publish();
    }
}

void EditorToolbar::startWebPreview(const std::string& directory) {
    if (previewServer_.isRunning()) {
        previewServer_.stop();
    }
    if (previewServer_.start(directory)) {
        WebPreviewServer::openInBrowser(previewServer_.getUrl());
    }
}

void EditorToolbar::stopWebPreview() {
    previewServer_.stop();
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 EditorToolbar::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;
    return {availableWidth, HEIGHT};
}

// =============================================================================
// Rendering
// =============================================================================

void EditorToolbar::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    const ui::Rect& bounds = getBounds();
    updateButtonBounds();

    constexpr glm::vec4 bgColor{0.145f, 0.145f, 0.149f, 1.0f};
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};
    constexpr glm::vec4 buttonBg{0.235f, 0.235f, 0.235f, 1.0f};
    constexpr glm::vec4 buttonHover{0.3f, 0.3f, 0.3f, 1.0f};
    constexpr glm::vec4 playingBg{0.231f, 0.510f, 0.965f, 1.0f};
    constexpr glm::vec4 pausedBg{0.988f, 0.722f, 0.067f, 1.0f};
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};

    renderer.drawRect(bounds, bgColor);

    ui::Rect bottomBorder{bounds.x, bounds.y + bounds.height - 1.0f, bounds.width, 1.0f};
    renderer.drawRect(bottomBorder, borderColor);

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* iconFont = ctx->getIconMSDFFont();
#else
    ui::SystemFont* iconFont = ctx->getIconSystemFont();
#endif
    if (!iconFont) return;

    auto drawButton = [&](const ButtonState& btn, const std::string& icon, bool active, const glm::vec4& activeBg) {
        glm::vec4 bg = active ? activeBg : (btn.hovered ? buttonHover : buttonBg);
        renderer.drawRoundedRect(btn.bounds, bg, ui::CornerRadii::all(4.0f));
        renderer.drawTextInBounds(icon, btn.bounds, *iconFont, 16.0f, textColor,
                                  ui::HAlign::Center, ui::VAlign::Center);
    };

    bool playing = state_ == PlayState::Playing;
    bool paused = state_ == PlayState::Paused;
    bool previewing = previewServer_.isRunning();

    constexpr glm::vec4 previewingBg{0.180f, 0.545f, 0.341f, 1.0f};

    drawButton(playButton_, icons::Play, playing, playingBg);
    drawButton(pauseButton_, icons::Pause, paused, pausedBg);
    drawButton(stopButton_, icons::Square, false, buttonBg);
    drawButton(webPreviewButton_, icons::Globe, previewing, previewingBg);
}

// =============================================================================
// Event Handling
// =============================================================================

bool EditorToolbar::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button != ui::MouseButton::Left) return false;

    if (playButton_.bounds.contains(event.x, event.y)) {
        if (state_ == PlayState::Paused) {
            play();
        } else if (state_ == PlayState::Stopped) {
            play();
        }
        return true;
    }

    if (pauseButton_.bounds.contains(event.x, event.y)) {
        if (state_ == PlayState::Playing) {
            pause();
        } else if (state_ == PlayState::Paused) {
            play();
        }
        return true;
    }

    if (stopButton_.bounds.contains(event.x, event.y)) {
        stop();
        return true;
    }

    if (webPreviewButton_.bounds.contains(event.x, event.y)) {
        onWebPreview.publish();
        return true;
    }

    return false;
}

bool EditorToolbar::onMouseMove(const ui::MouseMoveEvent& event) {
    playButton_.hovered = playButton_.bounds.contains(event.x, event.y);
    pauseButton_.hovered = pauseButton_.bounds.contains(event.x, event.y);
    stopButton_.hovered = stopButton_.bounds.contains(event.x, event.y);
    webPreviewButton_.hovered = webPreviewButton_.bounds.contains(event.x, event.y);
    return false;
}

// =============================================================================
// Private Methods
// =============================================================================

void EditorToolbar::updateButtonBounds() {
    const ui::Rect& bounds = getBounds();

    constexpr f32 buttonSize = 28.0f;
    constexpr f32 buttonGap = 4.0f;
    constexpr f32 groupWidth = buttonSize * 3 + buttonGap * 2;
    constexpr f32 padding = 8.0f;

    f32 centerX = bounds.x + bounds.width * 0.5f;
    f32 startX = centerX - groupWidth * 0.5f;
    f32 centerY = bounds.y + (bounds.height - buttonSize) * 0.5f;

    playButton_.bounds = ui::Rect{startX, centerY, buttonSize, buttonSize};
    pauseButton_.bounds = ui::Rect{startX + buttonSize + buttonGap, centerY, buttonSize, buttonSize};
    stopButton_.bounds = ui::Rect{startX + (buttonSize + buttonGap) * 2, centerY, buttonSize, buttonSize};

    f32 rightX = bounds.x + bounds.width - padding - buttonSize;
    webPreviewButton_.bounds = ui::Rect{rightX, centerY, buttonSize, buttonSize};
}

}  // namespace esengine::editor
