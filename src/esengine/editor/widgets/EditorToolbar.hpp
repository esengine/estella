/**
 * @file    EditorToolbar.hpp
 * @brief   Editor toolbar with play/pause/stop controls
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

#include "../../ui/widgets/Widget.hpp"
#include "../../events/Signal.hpp"

namespace esengine::editor {

// =============================================================================
// PlayState Enum
// =============================================================================

enum class PlayState : u8 {
    Stopped,
    Playing,
    Paused
};

enum class ViewMode : u8 {
    Mode3D,
    Mode2D
};

// =============================================================================
// EditorToolbar Class
// =============================================================================

class EditorToolbar : public ui::Widget {
public:
    static constexpr f32 HEIGHT = 40.0f;

    explicit EditorToolbar(const ui::WidgetId& id);

    PlayState getPlayState() const { return state_; }
    bool isPlaying() const { return state_ == PlayState::Playing; }
    bool isPaused() const { return state_ == PlayState::Paused; }
    bool isStopped() const { return state_ == PlayState::Stopped; }

    void play();
    void pause();
    void stop();

    Signal<void()> onPlay;
    Signal<void()> onPause;
    Signal<void()> onStop;

    ViewMode getViewMode() const { return viewMode_; }
    bool is2DMode() const { return viewMode_ == ViewMode::Mode2D; }
    bool is3DMode() const { return viewMode_ == ViewMode::Mode3D; }
    void setViewMode(ViewMode mode);
    void toggleViewMode();

    Signal<void(ViewMode)> onViewModeChanged;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;

private:
    void updateButtonBounds();

    PlayState state_ = PlayState::Stopped;
    ViewMode viewMode_ = ViewMode::Mode3D;

    struct ButtonState {
        ui::Rect bounds;
        bool hovered = false;
    };

    ButtonState playButton_;
    ButtonState pauseButton_;
    ButtonState stopButton_;
    ButtonState viewModeButton_;
};

}  // namespace esengine::editor
