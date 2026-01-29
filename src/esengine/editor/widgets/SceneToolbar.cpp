/**
 * @file    SceneToolbar.cpp
 * @brief   Scene view toolbar implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "SceneToolbar.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/icons/Icons.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

namespace esengine::editor {

namespace icons = ui::icons;

// =============================================================================
// Constructor
// =============================================================================

SceneToolbar::SceneToolbar(const ui::WidgetId& id)
    : Widget(id) {
    setHeight(ui::SizeValue::px(HEIGHT));
}

// =============================================================================
// State Setters
// =============================================================================

void SceneToolbar::setViewMode(ViewMode mode) {
    if (viewMode_ != mode) {
        viewMode_ = mode;
        onViewModeChanged.publish(mode);
    }
}

void SceneToolbar::setGridVisible(bool visible) {
    if (gridVisible_ != visible) {
        gridVisible_ = visible;
        onGridVisibilityChanged.publish(visible);
    }
}

void SceneToolbar::setGizmosVisible(bool visible) {
    if (gizmosVisible_ != visible) {
        gizmosVisible_ = visible;
        onGizmosVisibilityChanged.publish(visible);
    }
}

void SceneToolbar::setGizmoMode(GizmoMode mode) {
    if (gizmoMode_ != mode) {
        gizmoMode_ = mode;
        onGizmoModeChanged.publish(mode);
    }
}

// =============================================================================
// Rendering
// =============================================================================

void SceneToolbar::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    const ui::Rect& bounds = getBounds();
    updateButtonBounds();

    constexpr glm::vec4 bgColor{0.12f, 0.12f, 0.14f, 0.95f};
    constexpr glm::vec4 borderColor{0.2f, 0.2f, 0.22f, 1.0f};
    constexpr glm::vec4 buttonBg{0.2f, 0.2f, 0.22f, 1.0f};
    constexpr glm::vec4 buttonHover{0.28f, 0.28f, 0.30f, 1.0f};
    constexpr glm::vec4 activeBg{0.3f, 0.5f, 0.8f, 0.8f};
    constexpr glm::vec4 textColor{0.85f, 0.85f, 0.85f, 1.0f};

    renderer.drawRect(bounds, bgColor);
    renderer.drawRect({bounds.x, bounds.y + bounds.height - 1.0f, bounds.width, 1.0f}, borderColor);

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* iconFont = ctx->getIconMSDFFont();
    if (!iconFont) return;

    auto drawButton = [&](const ui::Rect& btnBounds, const char* icon, bool active, bool hovered) {
        glm::vec4 bg = active ? activeBg : (hovered ? buttonHover : buttonBg);
        renderer.drawRoundedRect(btnBounds, bg, ui::CornerRadii::all(4.0f));
        renderer.drawTextInBounds(icon, btnBounds, *iconFont, 16.0f, textColor,
                                  ui::HAlign::Center, ui::VAlign::Center);
    };

    drawButton(viewMode2DButtonBounds_, icons::Square, viewMode_ == ViewMode::Mode2D, hoveredButton_ == 0);
    drawButton(viewMode3DButtonBounds_, icons::Box, viewMode_ == ViewMode::Mode3D, hoveredButton_ == 1);

    f32 separatorX = viewMode3DButtonBounds_.x + viewMode3DButtonBounds_.width + 8.0f;
    renderer.drawRect({separatorX, bounds.y + 6.0f, 1.0f, bounds.height - 12.0f}, glm::vec4(0.3f, 0.3f, 0.32f, 1.0f));

    drawButton(gridButtonBounds_, icons::Grid, gridVisible_, hoveredButton_ == 2);
    drawButton(gizmosButtonBounds_, icons::Move3d, gizmosVisible_, hoveredButton_ == 3);

    f32 separator2X = gizmosButtonBounds_.x + gizmosButtonBounds_.width + 8.0f;
    renderer.drawRect({separator2X, bounds.y + 6.0f, 1.0f, bounds.height - 12.0f}, glm::vec4(0.3f, 0.3f, 0.32f, 1.0f));

    drawButton(translateButtonBounds_, icons::Move, gizmoMode_ == GizmoMode::Translate, hoveredButton_ == 4);
    drawButton(rotateButtonBounds_, icons::Rotate3d, gizmoMode_ == GizmoMode::Rotate, hoveredButton_ == 5);
    drawButton(scaleButtonBounds_, icons::Scale3d, gizmoMode_ == GizmoMode::Scale, hoveredButton_ == 6);
#endif
}

// =============================================================================
// Input Handling
// =============================================================================

bool SceneToolbar::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button != ui::MouseButton::Left) {
        return false;
    }

    i32 btn = getHoveredButton(event.x, event.y);

    switch (btn) {
        case 0: setViewMode(ViewMode::Mode2D); return true;
        case 1: setViewMode(ViewMode::Mode3D); return true;
        case 2: setGridVisible(!gridVisible_); return true;
        case 3: setGizmosVisible(!gizmosVisible_); return true;
        case 4: setGizmoMode(GizmoMode::Translate); return true;
        case 5: setGizmoMode(GizmoMode::Rotate); return true;
        case 6: setGizmoMode(GizmoMode::Scale); return true;
    }

    return false;
}

bool SceneToolbar::onMouseMove(const ui::MouseMoveEvent& event) {
    hoveredButton_ = getHoveredButton(event.x, event.y);
    return false;
}

// =============================================================================
// Private Methods
// =============================================================================

void SceneToolbar::updateButtonBounds() {
    const ui::Rect& bounds = getBounds();

    constexpr f32 btnSize = 24.0f;
    constexpr f32 padding = 4.0f;
    constexpr f32 groupGap = 16.0f;

    f32 y = bounds.y + (bounds.height - btnSize) * 0.5f;
    f32 x = bounds.x + padding;

    viewMode2DButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + 2.0f;
    viewMode3DButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + groupGap;

    gridButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + 2.0f;
    gizmosButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + groupGap;

    translateButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + 2.0f;
    rotateButtonBounds_ = {x, y, btnSize, btnSize};
    x += btnSize + 2.0f;
    scaleButtonBounds_ = {x, y, btnSize, btnSize};
}

i32 SceneToolbar::getHoveredButton(f32 x, f32 y) const {
    if (viewMode2DButtonBounds_.contains(x, y)) return 0;
    if (viewMode3DButtonBounds_.contains(x, y)) return 1;
    if (gridButtonBounds_.contains(x, y)) return 2;
    if (gizmosButtonBounds_.contains(x, y)) return 3;
    if (translateButtonBounds_.contains(x, y)) return 4;
    if (rotateButtonBounds_.contains(x, y)) return 5;
    if (scaleButtonBounds_.contains(x, y)) return 6;
    return -1;
}

}  // namespace esengine::editor
