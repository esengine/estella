/**
 * @file    ContextMenu.hpp
 * @brief   Context menu widget for right-click menus
 * @details A popup menu that displays a list of selectable items.
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

#include "Widget.hpp"
#include "../../events/Signal.hpp"

#include <functional>
#include <string>
#include <vector>

namespace esengine::ui {

// =============================================================================
// MenuItem
// =============================================================================

struct MenuItem {
    std::string id;
    std::string label;
    std::string icon;
    std::string shortcut;
    bool enabled = true;
    bool separator = false;
    std::vector<MenuItem> submenu;

    static MenuItem action(const std::string& id, const std::string& label,
                            const std::string& icon = "", const std::string& shortcut = "") {
        MenuItem item;
        item.id = id;
        item.label = label;
        item.icon = icon;
        item.shortcut = shortcut;
        return item;
    }

    static MenuItem divider() {
        MenuItem item;
        item.separator = true;
        return item;
    }
};

// =============================================================================
// ContextMenu Class
// =============================================================================

/**
 * @brief Popup context menu widget
 *
 * @details Displays a list of menu items at a specific position.
 *          Automatically closes when an item is selected or when
 *          clicking outside the menu.
 *
 * @code
 * auto menu = makeUnique<ContextMenu>(WidgetId("context"));
 * menu->addItem(MenuItem::action("create", "Create Entity", icons::Plus));
 * menu->addItem(MenuItem::divider());
 * menu->addItem(MenuItem::action("delete", "Delete", icons::Trash));
 * menu->onItemSelected.connect([](const std::string& id) {
 *     ES_LOG_INFO("Selected: {}", id);
 * });
 * menu->show(mouseX, mouseY);
 * @endcode
 */
class ContextMenu : public Widget {
public:
    static constexpr f32 ITEM_HEIGHT = 28.0f;
    static constexpr f32 SEPARATOR_HEIGHT = 9.0f;
    static constexpr f32 MIN_WIDTH = 180.0f;
    static constexpr f32 ICON_SIZE = 16.0f;
    static constexpr f32 PADDING_X = 8.0f;
    static constexpr f32 PADDING_Y = 4.0f;

    explicit ContextMenu(const WidgetId& id);

    // =========================================================================
    // Signals
    // =========================================================================

    Signal<void(const std::string&)> onItemSelected;
    Signal<void()> onClosed;

    // =========================================================================
    // Menu Items
    // =========================================================================

    void addItem(const MenuItem& item);
    void addItems(const std::vector<MenuItem>& items);
    void clearItems();

    const std::vector<MenuItem>& getItems() const { return items_; }

    // =========================================================================
    // Visibility
    // =========================================================================

    void show(f32 x, f32 y);
    void hide();
    bool isOpen() const { return isOpen_; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;
    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;
    bool onKeyDown(const KeyEvent& event) override;

    Widget* hitTest(f32 x, f32 y) override;

private:
    f32 calculateMenuHeight() const;
    i32 getItemAtY(f32 y) const;
    void selectItem(i32 index);

    std::vector<MenuItem> items_;
    f32 menuX_ = 0.0f;
    f32 menuY_ = 0.0f;
    i32 hoveredIndex_ = -1;
    bool isOpen_ = false;
};

}  // namespace esengine::ui
