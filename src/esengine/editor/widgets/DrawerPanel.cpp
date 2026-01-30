/**
 * @file    DrawerPanel.cpp
 * @brief   Bottom drawer panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DrawerPanel.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../ui/icons/Icons.hpp"

#if ES_FEATURE_SDF_FONT
#include "../../ui/font/MSDFFont.hpp"
#endif

#include "../../ui/font/SystemFont.hpp"
#include "../../math/Math.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

DrawerPanel::DrawerPanel(const ui::WidgetId& id, const std::string& title)
    : Widget(id), title_(title) {}

// =============================================================================
// Configuration
// =============================================================================

void DrawerPanel::setOpen(bool open) {
    open_ = open;
    invalidateLayout();
}

void DrawerPanel::setDrawerHeight(f32 height) {
    drawerHeight_ = glm::max(height, MIN_HEIGHT);
    if (open_) {
        invalidateLayout();
    }
}

void DrawerPanel::setContent(Unique<Widget> content) {
    if (content_) {
        removeChild(content_);
    }

    content_ = content.get();
    if (content) {
        addChild(std::move(content));
    }
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 DrawerPanel::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    if (!open_) {
        return {availableWidth, 0.0f};
    }

    return {availableWidth, drawerHeight_};
}

void DrawerPanel::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);
    updateContentBounds();
}

void DrawerPanel::updateContentBounds() {
    if (!content_ || !open_) {
        return;
    }

    const ui::Rect& bounds = getBounds();

    resizeHandleBounds_ = ui::Rect{
        bounds.x,
        bounds.y - 4.0f,
        bounds.width,
        RESIZE_HANDLE_HEIGHT
    };

    ui::Rect contentBounds{
        bounds.x,
        bounds.y + HEADER_HEIGHT,
        bounds.width,
        bounds.height - HEADER_HEIGHT
    };

    content_->measure(contentBounds.width, contentBounds.height);
    content_->layout(contentBounds);
}

// =============================================================================
// Rendering
// =============================================================================

void DrawerPanel::render(ui::UIBatchRenderer& renderer) {
    if (!open_) {
        return;
    }

    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    const ui::Rect& bounds = getBounds();

    constexpr glm::vec4 bgColor{0.118f, 0.118f, 0.118f, 1.0f};         // #1e1e1e
    constexpr glm::vec4 headerBg{0.145f, 0.145f, 0.149f, 1.0f};        // #252526
    constexpr glm::vec4 borderColor{0.235f, 0.235f, 0.235f, 1.0f};     // #3c3c3c
    constexpr glm::vec4 topBorderColor{0.231f, 0.510f, 0.965f, 1.0f};  // #3b82f6
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};       // #e0e0e0
    constexpr glm::vec4 iconColor{0.533f, 0.533f, 0.533f, 1.0f};       // #888
    constexpr glm::vec4 iconHoverColor{0.878f, 0.878f, 0.878f, 1.0f};  // #e0e0e0
    constexpr glm::vec4 buttonHoverBg{0.235f, 0.235f, 0.235f, 1.0f};   // #3c3c3c
    constexpr glm::vec4 resizeHandleColor{0.298f, 0.298f, 0.298f, 1.0f}; // #4c4c4c

    renderer.drawRect(bounds, bgColor);

    ui::Rect topBorder{bounds.x, bounds.y, bounds.width, 2.0f};
    renderer.drawRect(topBorder, topBorderColor);

    ui::Rect headerBounds{bounds.x, bounds.y, bounds.width, HEADER_HEIGHT};
    renderer.drawRect(headerBounds, headerBg);

    ui::Rect headerBottomBorder{bounds.x, bounds.y + HEADER_HEIGHT - 1.0f, bounds.width, 1.0f};
    renderer.drawRect(headerBottomBorder, borderColor);

#if ES_FEATURE_SDF_FONT
    ui::MSDFFont* iconFont = ctx->getIconMSDFFont();
    ui::MSDFFont* textFont = ctx->getDefaultMSDFFont();
#else
    ui::SystemFont* iconFont = ctx->getIconSystemFont();
    ui::SystemFont* textFont = ctx->getDefaultSystemFont();
#endif

    f32 headerCenterY = bounds.y + HEADER_HEIGHT * 0.5f;

    if (iconFont) {
        ui::Rect folderIconBounds{bounds.x + 12.0f, headerCenterY - 7.0f, 14.0f, 14.0f};
        renderer.drawTextInBounds(ui::icons::FolderOpen, folderIconBounds, *iconFont, 14.0f, textColor,
                                  ui::HAlign::Center, ui::VAlign::Center);
    }

    if (textFont) {
        ui::Rect titleBounds{bounds.x + 32.0f, headerCenterY - 6.0f, 200.0f, 12.0f};
        renderer.drawTextInBounds(title_, titleBounds, *textFont, 12.0f, textColor,
                                  ui::HAlign::Left, ui::VAlign::Center);
    }

    f32 buttonX = bounds.x + bounds.width - 8.0f;

    closeButtonBounds_ = ui::Rect{buttonX - 24.0f, bounds.y + 2.0f, 24.0f, 24.0f};
    if (closeHovered_) {
        renderer.drawRoundedRect(closeButtonBounds_, buttonHoverBg, ui::CornerRadii::all(3.0f));
    }
    if (iconFont) {
        renderer.drawTextInBounds(ui::icons::X, closeButtonBounds_, *iconFont, 14.0f,
                                  closeHovered_ ? iconHoverColor : iconColor,
                                  ui::HAlign::Center, ui::VAlign::Center);
    }

    if (showDockButton_) {
        dockButtonBounds_ = ui::Rect{buttonX - 52.0f, bounds.y + 2.0f, 24.0f, 24.0f};
        if (dockHovered_) {
            renderer.drawRoundedRect(dockButtonBounds_, buttonHoverBg, ui::CornerRadii::all(3.0f));
        }
        if (iconFont) {
            renderer.drawTextInBounds(ui::icons::PanelBottom, dockButtonBounds_, *iconFont, 14.0f,
                                      dockHovered_ ? iconHoverColor : iconColor,
                                      ui::HAlign::Center, ui::VAlign::Center);
        }
    }

    if (content_) {
        content_->renderTree(renderer);
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool DrawerPanel::onMouseDown(const ui::MouseButtonEvent& event) {
    if (!open_ || event.button != ui::MouseButton::Left) {
        return false;
    }

    if (closeButtonBounds_.contains(event.x, event.y)) {
        onClose.publish();
        return true;
    }

    if (showDockButton_ && dockButtonBounds_.contains(event.x, event.y)) {
        onDockRequested.publish();
        return true;
    }

    if (resizeHandleBounds_.contains(event.x, event.y)) {
        resizing_ = true;
        resizeStartY_ = event.y;
        resizeStartHeight_ = drawerHeight_;
        return true;
    }

    return false;
}

bool DrawerPanel::onMouseUp(const ui::MouseButtonEvent& event) {
    if (event.button == ui::MouseButton::Left && resizing_) {
        resizing_ = false;
        return true;
    }
    return false;
}

bool DrawerPanel::onMouseMove(const ui::MouseMoveEvent& event) {
    closeHovered_ = closeButtonBounds_.contains(event.x, event.y);
    dockHovered_ = showDockButton_ && dockButtonBounds_.contains(event.x, event.y);

    if (resizing_) {
        f32 delta = resizeStartY_ - event.y;
        f32 newHeight = resizeStartHeight_ + delta;

        ui::UIContext* ctx = getContext();
        if (ctx) {
            f32 maxHeight = ctx->getViewportSize().y * 0.7f;
            newHeight = glm::clamp(newHeight, MIN_HEIGHT, maxHeight);
        }

        setDrawerHeight(newHeight);
        return true;
    }

    return false;
}

}  // namespace esengine::editor
