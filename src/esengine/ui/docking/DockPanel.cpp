/**
 * @file    DockPanel.cpp
 * @brief   DockPanel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "DockPanel.hpp"
#include "DockNode.hpp"
#include "DockArea.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"

namespace esengine::ui {

// =============================================================================
// Static Members
// =============================================================================

DockPanelId DockPanel::nextPanelId_ = 1;

// =============================================================================
// Constructor / Destructor
// =============================================================================

DockPanel::DockPanel(const WidgetId& id, const std::string& title)
    : Widget(id)
    , panelId_(nextPanelId_++)
    , title_(title) {
    setName(title);
}

DockPanel::~DockPanel() = default;

// =============================================================================
// Title
// =============================================================================

void DockPanel::setTitle(const std::string& title) {
    if (title_ != title) {
        title_ = title;
        setName(title);
        onTitleChanged.publish(title_);
    }
}

// =============================================================================
// Dock Context
// =============================================================================

DockArea* DockPanel::getDockArea() const {
    if (ownerNode_) {
        return ownerNode_->getArea();
    }
    return nullptr;
}

// =============================================================================
// Content
// =============================================================================

void DockPanel::setContent(Unique<Widget> content) {
    if (contentWidget_) {
        removeChild(contentWidget_);
        contentWidget_ = nullptr;
    }

    if (content) {
        contentWidget_ = content.get();
        addChild(std::move(content));
    }
}

// =============================================================================
// Widget Overrides
// =============================================================================

glm::vec2 DockPanel::measure(f32 availableWidth, f32 availableHeight) {
    glm::vec2 contentSize = minSize_;

    if (contentWidget_) {
        contentSize = contentWidget_->measure(availableWidth, availableHeight);
    }

    return glm::vec2{
        std::max(contentSize.x, minSize_.x),
        std::max(contentSize.y, minSize_.y)
    };
}

void DockPanel::render(UIBatchRenderer& renderer) {
    UIContext* ctx = getContext();
    if (!ctx) return;

    const Rect& bounds = getBounds();

    WidgetStyle style = ctx->getTheme().getPanelStyle();
    renderer.drawRect(bounds, style.backgroundColor);

    if (contentWidget_) {
        contentWidget_->render(renderer);
    }

    onRenderContent(renderer);
}

void DockPanel::onRenderContent(UIBatchRenderer& renderer) {
    (void)renderer;
}

}  // namespace esengine::ui
