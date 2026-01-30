/**
 * @file    SceneToolbar.hpp
 * @brief   Scene view toolbar for view controls and gizmo modes
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
#include "../gizmo/TransformGizmo.hpp"
#include "EditorToolbar.hpp"

namespace esengine::editor {

// =============================================================================
// SceneToolbar Class
// =============================================================================

/**
 * @brief Toolbar embedded in SceneViewPanel for view and gizmo controls
 */
class SceneToolbar : public ui::Widget {
public:
    static constexpr f32 HEIGHT = 32.0f;

    explicit SceneToolbar(const ui::WidgetId& id);
    ~SceneToolbar() override = default;

    // =========================================================================
    // State Accessors
    // =========================================================================

    ViewMode getViewMode() const { return viewMode_; }
    void setViewMode(ViewMode mode);

    bool isGridVisible() const { return gridVisible_; }
    void setGridVisible(bool visible);

    bool isGizmosVisible() const { return gizmosVisible_; }
    void setGizmosVisible(bool visible);

    GizmoMode getGizmoMode() const { return gizmoMode_; }
    void setGizmoMode(GizmoMode mode);

    bool isStatsVisible() const { return stats_visible_; }
    void setStatsVisible(bool visible);

    // =========================================================================
    // Signals
    // =========================================================================

    Signal<void(ViewMode)> onViewModeChanged;
    Signal<void(bool)> onGridVisibilityChanged;
    Signal<void(bool)> onGizmosVisibilityChanged;
    Signal<void(GizmoMode)> onGizmoModeChanged;
    Signal<void(bool)> onStatsVisibilityChanged;

    // =========================================================================
    // Widget Interface
    // =========================================================================

    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;

private:
    void updateButtonBounds();
    i32 getHoveredButton(f32 x, f32 y) const;

    ViewMode viewMode_ = ViewMode::Mode3D;
    bool gridVisible_ = true;
    bool gizmosVisible_ = true;
    bool stats_visible_ = false;
    GizmoMode gizmoMode_ = GizmoMode::Translate;

    ui::Rect viewMode2DButtonBounds_;
    ui::Rect viewMode3DButtonBounds_;
    ui::Rect gridButtonBounds_;
    ui::Rect gizmosButtonBounds_;
    ui::Rect translateButtonBounds_;
    ui::Rect rotateButtonBounds_;
    ui::Rect scaleButtonBounds_;
    ui::Rect stats_button_bounds_;

    i32 hoveredButton_ = -1;
};

}  // namespace esengine::editor
