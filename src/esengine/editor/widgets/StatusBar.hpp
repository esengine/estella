/**
 * @file    StatusBar.hpp
 * @brief   Editor status bar with drawer toggle buttons
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

#include <string>

namespace esengine::editor {

// =============================================================================
// StatusBar Class
// =============================================================================

class StatusBar : public ui::Widget {
public:
    static constexpr f32 HEIGHT = 24.0f;

    explicit StatusBar(const ui::WidgetId& id);

    void setAssetsDrawerOpen(bool open) { assetsDrawerOpen_ = open; }
    void setOutputDrawerOpen(bool open) { outputDrawerOpen_ = open; }

    bool isAssetsDrawerOpen() const { return assetsDrawerOpen_; }
    bool isOutputDrawerOpen() const { return outputDrawerOpen_; }

    Signal<void()> onAssetsToggle;
    Signal<void()> onOutputToggle;
    Signal<void()> onResetLayout;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;

private:
    struct ButtonRect {
        ui::Rect bounds;
        bool hovered = false;
    };

    void updateButtonRects();

    bool assetsDrawerOpen_ = false;
    bool outputDrawerOpen_ = false;

    ButtonRect assetsButton_;
    ButtonRect outputButton_;
    ButtonRect layoutButton_;

    glm::vec2 lastMousePos_{0.0f};
};

}  // namespace esengine::editor
