/**
 * @file    DockPanel.hpp
 * @brief   Dockable panel base class
 * @details A panel widget that can be docked, tabbed, and dragged
 *          within the docking system.
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

#include "DockTypes.hpp"
#include "../widgets/Widget.hpp"
#include "../../events/Signal.hpp"

#include <string>

namespace esengine::ui {

// Forward declarations
class DockNode;
class DockArea;

// =============================================================================
// DockPanel Class
// =============================================================================

/**
 * @brief A dockable panel that can be moved between dock nodes
 *
 * @details DockPanel is the base class for all dockable panels in the editor.
 *          It provides:
 *          - A title for the tab bar
 *          - Optional icon
 *          - Close button support
 *          - Content widget container
 *
 * @code
 * class HierarchyPanel : public DockPanel {
 * public:
 *     HierarchyPanel()
 *         : DockPanel(WidgetId("hierarchy"), "Hierarchy") {
 *         setContent(makeUnique<TreeView>(WidgetId("hierarchy.tree")));
 *     }
 * };
 * @endcode
 */
class DockPanel : public Widget {
public:
    /**
     * @brief Constructs a dock panel
     * @param id Widget identifier
     * @param title Title displayed in the tab bar
     */
    DockPanel(const WidgetId& id, const std::string& title);

    ~DockPanel() override;

    // =========================================================================
    // Identity
    // =========================================================================

    /** @brief Gets the panel's unique ID */
    DockPanelId getPanelId() const { return panelId_; }

    /** @brief Gets the panel type identifier for serialization */
    const std::string& getPanelType() const { return panelType_; }

    /** @brief Sets the panel type identifier */
    void setPanelType(const std::string& type) { panelType_ = type; }

    // =========================================================================
    // Title
    // =========================================================================

    /** @brief Gets the panel title */
    const std::string& getTitle() const { return title_; }

    /** @brief Sets the panel title */
    void setTitle(const std::string& title);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets whether the panel can be closed */
    void setClosable(bool closable) { closable_ = closable; }

    /** @brief Returns true if the panel can be closed */
    bool isClosable() const { return closable_; }

    /** @brief Sets the minimum panel size */
    void setMinSize(const glm::vec2& minSize) { minSize_ = minSize; }

    /** @brief Gets the minimum panel size */
    glm::vec2 getMinSize() const { return minSize_; }

    // =========================================================================
    // Icon
    // =========================================================================

    /** @brief Sets the icon texture ID (0 for no icon) */
    void setIconTextureId(u32 textureId) { iconTextureId_ = textureId; }

    /** @brief Gets the icon texture ID */
    u32 getIconTextureId() const { return iconTextureId_; }

    // =========================================================================
    // Dock Context
    // =========================================================================

    /** @brief Gets the node that owns this panel */
    DockNode* getOwnerNode() const { return ownerNode_; }

    /** @brief Gets the DockArea containing this panel */
    DockArea* getDockArea() const;

    // =========================================================================
    // Content
    // =========================================================================

    /**
     * @brief Sets the content widget
     * @param content Widget to display (ownership transferred)
     */
    void setContent(Unique<Widget> content);

    /** @brief Gets the content widget */
    Widget* getContent() const { return contentWidget_; }

    // =========================================================================
    // Signals
    // =========================================================================

    /** @brief Emitted when close is requested */
    Signal<void()> onCloseRequested;

    /** @brief Emitted when title changes */
    Signal<void(const std::string&)> onTitleChanged;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const Rect& bounds) override;
    void render(UIBatchRenderer& renderer) override;

protected:
    /**
     * @brief Called to render panel-specific content
     * @param renderer Batch renderer
     *
     * @details Override this for custom panel content instead of using setContent.
     */
    virtual void onRenderContent(UIBatchRenderer& renderer);

    /**
     * @brief Called when the panel becomes active (selected tab)
     */
    virtual void onActivated() {}

    /**
     * @brief Called when the panel becomes inactive (different tab selected)
     */
    virtual void onDeactivated() {}

private:
    static DockPanelId nextPanelId_;

    DockPanelId panelId_;
    std::string panelType_;
    std::string title_;
    bool closable_ = true;
    glm::vec2 minSize_{100.0f, 100.0f};
    u32 iconTextureId_ = 0;

    DockNode* ownerNode_ = nullptr;
    Widget* contentWidget_ = nullptr;

    friend class DockNode;
    friend class DockArea;
    friend class DockTabBar;
};

}  // namespace esengine::ui
