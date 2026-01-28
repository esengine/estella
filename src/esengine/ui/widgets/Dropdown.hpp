/**
 * @file    Dropdown.hpp
 * @brief   Dropdown selection widget
 * @details A dropdown/combobox widget that displays a list of selectable items.
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
// DropdownItem
// =============================================================================

struct DropdownItem {
    i32 value = 0;
    std::string label;
    std::string icon;
    bool enabled = true;

    static DropdownItem create(i32 value, const std::string& label, const std::string& icon = "") {
        DropdownItem item;
        item.value = value;
        item.label = label;
        item.icon = icon;
        return item;
    }
};

// =============================================================================
// Dropdown Class
// =============================================================================

/**
 * @brief Dropdown selection widget
 *
 * @details Displays a button showing the current selection. When clicked,
 *          shows a popup list of options for selection.
 *
 * @code
 * auto dropdown = makeUnique<Dropdown>(WidgetId("type"));
 * dropdown->addItem(DropdownItem::create(0, "Perspective"));
 * dropdown->addItem(DropdownItem::create(1, "Orthographic"));
 * dropdown->setSelectedIndex(0);
 * dropdown->onSelectionChanged.connect([](i32 value) {
 *     ES_LOG_INFO("Selected: {}", value);
 * });
 * @endcode
 */
class Dropdown : public Widget {
public:
    static constexpr f32 ITEM_HEIGHT = 24.0f;
    static constexpr f32 PADDING_X = 8.0f;
    static constexpr f32 PADDING_Y = 4.0f;
    static constexpr f32 ARROW_WIDTH = 20.0f;
    static constexpr f32 MIN_WIDTH = 80.0f;

    explicit Dropdown(const WidgetId& id);

    // =========================================================================
    // Signals
    // =========================================================================

    Signal<void(i32)> onSelectionChanged;

    // =========================================================================
    // Items
    // =========================================================================

    void addItem(const DropdownItem& item);
    void addItems(const std::vector<DropdownItem>& items);
    void clearItems();

    const std::vector<DropdownItem>& getItems() const { return items_; }

    // =========================================================================
    // Selection
    // =========================================================================

    void setSelectedIndex(i32 index);
    i32 getSelectedIndex() const { return selectedIndex_; }

    void setSelectedValue(i32 value);
    i32 getSelectedValue() const;

    const DropdownItem* getSelectedItem() const;

    // =========================================================================
    // Appearance
    // =========================================================================

    void setFontSize(f32 size) { fontSize_ = size; invalidateLayout(); }
    f32 getFontSize() const { return fontSize_; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    bool isFocusable() const override { return true; }

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(UIBatchRenderer& renderer) override;

    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onMouseEnter(const MouseEnterEvent& event) override;
    bool onMouseLeave(const MouseLeaveEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;
    bool onKeyDown(const KeyEvent& event) override;

    Widget* hitTest(f32 x, f32 y) override;

private:
    void openPopup();
    void closePopup();
    void selectItem(i32 index);

    f32 calculatePopupHeight() const;
    i32 getItemAtY(f32 y) const;
    Rect getPopupBounds() const;

    std::vector<DropdownItem> items_;
    i32 selectedIndex_ = -1;
    i32 hoveredIndex_ = -1;
    f32 fontSize_ = 12.0f;
    bool isOpen_ = false;

    glm::vec2 cachedTextSize_{0.0f};
    bool textSizeDirty_ = true;
};

}  // namespace esengine::ui
