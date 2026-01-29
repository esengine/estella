/**
 * @file    EditorRootContainer.hpp
 * @brief   Root container managing main content, drawers, and status bar
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
#include "EditorToolbar.hpp"
#include "StatusBar.hpp"
#include "DrawerPanel.hpp"

namespace esengine::editor {

// =============================================================================
// EditorRootContainer Class
// =============================================================================

class EditorRootContainer : public ui::Widget {
public:
    explicit EditorRootContainer(const ui::WidgetId& id);

    void setMainContent(Unique<Widget> content);
    Widget* getMainContent() const { return mainContent_; }

    void setAssetsDrawerContent(Unique<Widget> content);
    void setOutputDrawerContent(Unique<Widget> content);

    void openAssetsDrawer();
    void closeAssetsDrawer();
    void toggleAssetsDrawer();
    bool isAssetsDrawerOpen() const;

    void openOutputDrawer();
    void closeOutputDrawer();
    void toggleOutputDrawer();
    bool isOutputDrawerOpen() const;

    EditorToolbar* getToolbar() const { return toolbar_; }
    StatusBar* getStatusBar() const { return statusBar_; }
    DrawerPanel* getAssetsDrawer() const { return assetsDrawer_; }
    DrawerPanel* getOutputDrawer() const { return outputDrawer_; }

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void renderTree(ui::UIBatchRenderer& renderer) override;
    Widget* hitTest(f32 x, f32 y) override;

private:
    void updateLayout();

    EditorToolbar* toolbar_ = nullptr;
    Widget* mainContent_ = nullptr;
    StatusBar* statusBar_ = nullptr;
    DrawerPanel* assetsDrawer_ = nullptr;
    DrawerPanel* outputDrawer_ = nullptr;
    ConnectionHolder connections_;
};

}  // namespace esengine::editor
