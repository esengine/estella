/**
 * @file    EditorRootContainer.cpp
 * @brief   Root container implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EditorRootContainer.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../events/Sink.hpp"
#include "../../core/Log.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

EditorRootContainer::EditorRootContainer(const ui::WidgetId& id) : Widget(id) {
    auto statusBar = makeUnique<StatusBar>(ui::WidgetId(id.path + ".status_bar"));
    statusBar_ = statusBar.get();
    addChild(std::move(statusBar));

    auto assetsDrawer = makeUnique<DrawerPanel>(
        ui::WidgetId(id.path + ".assets_drawer"), "Content Browser");
    assetsDrawer_ = assetsDrawer.get();
    assetsDrawer_->setShowDockButton(true);
    addChild(std::move(assetsDrawer));

    auto outputDrawer = makeUnique<DrawerPanel>(
        ui::WidgetId(id.path + ".output_drawer"), "Output");
    outputDrawer_ = outputDrawer.get();
    outputDrawer_->setShowDockButton(false);
    addChild(std::move(outputDrawer));

    connections_.add(sink(statusBar_->onAssetsToggle).connect([this]() {
        toggleAssetsDrawer();
    }));

    connections_.add(sink(statusBar_->onOutputToggle).connect([this]() {
        toggleOutputDrawer();
    }));

    connections_.add(sink(assetsDrawer_->onClose).connect([this]() {
        closeAssetsDrawer();
    }));

    connections_.add(sink(outputDrawer_->onClose).connect([this]() {
        closeOutputDrawer();
    }));
}

// =============================================================================
// Content Management
// =============================================================================

void EditorRootContainer::setMainContent(Unique<Widget> content) {
    if (mainContent_) {
        removeChild(mainContent_);
    }

    mainContent_ = content.get();
    if (content) {
        addChild(std::move(content));
    }

    invalidateLayout();
}

void EditorRootContainer::setAssetsDrawerContent(Unique<Widget> content) {
    if (assetsDrawer_) {
        assetsDrawer_->setContent(std::move(content));
    }
}

void EditorRootContainer::setOutputDrawerContent(Unique<Widget> content) {
    if (outputDrawer_) {
        outputDrawer_->setContent(std::move(content));
    }
}

// =============================================================================
// Drawer Control
// =============================================================================

void EditorRootContainer::openAssetsDrawer() {
    if (outputDrawer_->isOpen()) {
        outputDrawer_->setOpen(false);
        statusBar_->setOutputDrawerOpen(false);
    }
    assetsDrawer_->setOpen(true);
    statusBar_->setAssetsDrawerOpen(true);
    invalidateLayout();
}

void EditorRootContainer::closeAssetsDrawer() {
    assetsDrawer_->setOpen(false);
    statusBar_->setAssetsDrawerOpen(false);
    invalidateLayout();
}

void EditorRootContainer::toggleAssetsDrawer() {
    ES_LOG_INFO("EditorRootContainer::toggleAssetsDrawer called, isOpen={}", assetsDrawer_->isOpen());
    if (assetsDrawer_->isOpen()) {
        closeAssetsDrawer();
    } else {
        openAssetsDrawer();
    }
    ES_LOG_INFO("After toggle, isOpen={}", assetsDrawer_->isOpen());
}

bool EditorRootContainer::isAssetsDrawerOpen() const {
    return assetsDrawer_ && assetsDrawer_->isOpen();
}

void EditorRootContainer::openOutputDrawer() {
    if (assetsDrawer_->isOpen()) {
        assetsDrawer_->setOpen(false);
        statusBar_->setAssetsDrawerOpen(false);
    }
    outputDrawer_->setOpen(true);
    statusBar_->setOutputDrawerOpen(true);
    invalidateLayout();
}

void EditorRootContainer::closeOutputDrawer() {
    outputDrawer_->setOpen(false);
    statusBar_->setOutputDrawerOpen(false);
    invalidateLayout();
}

void EditorRootContainer::toggleOutputDrawer() {
    if (outputDrawer_->isOpen()) {
        closeOutputDrawer();
    } else {
        openOutputDrawer();
    }
}

bool EditorRootContainer::isOutputDrawerOpen() const {
    return outputDrawer_ && outputDrawer_->isOpen();
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 EditorRootContainer::measure(f32 availableWidth, f32 availableHeight) {
    return {availableWidth, availableHeight};
}

void EditorRootContainer::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);
    updateLayout();
}

void EditorRootContainer::updateLayout() {
    const ui::Rect& bounds = getBounds();

    ui::Rect statusBarBounds{
        bounds.x,
        bounds.y + bounds.height - StatusBar::HEIGHT,
        bounds.width,
        StatusBar::HEIGHT
    };
    statusBar_->measure(statusBarBounds.width, statusBarBounds.height);
    statusBar_->layout(statusBarBounds);

    f32 drawerHeight = 0.0f;
    DrawerPanel* activeDrawer = nullptr;

    if (assetsDrawer_->isOpen()) {
        activeDrawer = assetsDrawer_;
        drawerHeight = assetsDrawer_->getDrawerHeight();
    } else if (outputDrawer_->isOpen()) {
        activeDrawer = outputDrawer_;
        drawerHeight = outputDrawer_->getDrawerHeight();
    }

    if (activeDrawer) {
        ui::Rect drawerBounds{
            bounds.x,
            bounds.y + bounds.height - StatusBar::HEIGHT - drawerHeight,
            bounds.width,
            drawerHeight
        };
        activeDrawer->measure(drawerBounds.width, drawerBounds.height);
        activeDrawer->layout(drawerBounds);
    }

    if (!assetsDrawer_->isOpen()) {
        assetsDrawer_->layout(ui::Rect{0, 0, 0, 0});
    }
    if (!outputDrawer_->isOpen()) {
        outputDrawer_->layout(ui::Rect{0, 0, 0, 0});
    }

    if (mainContent_) {
        f32 mainContentHeight = bounds.height - StatusBar::HEIGHT - drawerHeight;
        ui::Rect mainBounds{
            bounds.x,
            bounds.y,
            bounds.width,
            mainContentHeight
        };
        mainContent_->measure(mainBounds.width, mainBounds.height);
        mainContent_->layout(mainBounds);
    }
}

// =============================================================================
// Rendering
// =============================================================================

void EditorRootContainer::render(ui::UIBatchRenderer& renderer) {
    if (mainContent_) {
        mainContent_->renderTree(renderer);
    }

    if (assetsDrawer_->isOpen()) {
        assetsDrawer_->renderTree(renderer);
    }

    if (outputDrawer_->isOpen()) {
        outputDrawer_->renderTree(renderer);
    }

    statusBar_->renderTree(renderer);
}

ui::Widget* EditorRootContainer::hitTest(f32 x, f32 y) {
    if (!containsPoint(x, y)) {
        return nullptr;
    }

    if (auto* hit = statusBar_->hitTest(x, y)) {
        return hit;
    }

    if (outputDrawer_->isOpen()) {
        if (auto* hit = outputDrawer_->hitTest(x, y)) {
            return hit;
        }
    }

    if (assetsDrawer_->isOpen()) {
        if (auto* hit = assetsDrawer_->hitTest(x, y)) {
            return hit;
        }
    }

    if (mainContent_) {
        if (auto* hit = mainContent_->hitTest(x, y)) {
            return hit;
        }
    }

    return this;
}

}  // namespace esengine::editor
