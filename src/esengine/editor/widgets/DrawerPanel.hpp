/**
 * @file    DrawerPanel.hpp
 * @brief   Bottom drawer panel that slides up from status bar
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
// DrawerPanel Class
// =============================================================================

class DrawerPanel : public ui::Widget {
public:
    static constexpr f32 DEFAULT_HEIGHT = 300.0f;
    static constexpr f32 MIN_HEIGHT = 200.0f;
    static constexpr f32 HEADER_HEIGHT = 28.0f;
    static constexpr f32 RESIZE_HANDLE_HEIGHT = 8.0f;

    DrawerPanel(const ui::WidgetId& id, const std::string& title);

    void setOpen(bool open);
    bool isOpen() const { return open_; }

    void setDrawerHeight(f32 height);
    f32 getDrawerHeight() const { return drawerHeight_; }

    void setTitle(const std::string& title) { title_ = title; }
    const std::string& getTitle() const { return title_; }

    void setContent(Unique<Widget> content);
    Widget* getContent() const { return content_; }

    void setShowDockButton(bool show) { showDockButton_ = show; }
    bool isShowDockButton() const { return showDockButton_; }

    Signal<void()> onClose;
    Signal<void()> onDockRequested;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseUp(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;

private:
    void updateContentBounds();

    std::string title_;
    Widget* content_ = nullptr;
    f32 drawerHeight_ = DEFAULT_HEIGHT;
    bool open_ = false;
    bool showDockButton_ = true;

    bool resizing_ = false;
    f32 resizeStartY_ = 0.0f;
    f32 resizeStartHeight_ = 0.0f;

    ui::Rect closeButtonBounds_;
    ui::Rect dockButtonBounds_;
    ui::Rect resizeHandleBounds_;
    bool closeHovered_ = false;
    bool dockHovered_ = false;
};

}  // namespace esengine::editor
