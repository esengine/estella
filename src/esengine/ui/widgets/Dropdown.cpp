/**
 * @file    Dropdown.cpp
 * @brief   Dropdown widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Dropdown.hpp"
#include "../UIContext.hpp"
#include "../icons/Icons.hpp"
#include "../rendering/UIBatchRenderer.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#if ES_FEATURE_BITMAP_FONT
#include "../font/BitmapFont.hpp"
#endif

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Dropdown::Dropdown(const WidgetId& id) : Widget(id) {}

// =============================================================================
// Items
// =============================================================================

void Dropdown::addItem(const DropdownItem& item) {
    items_.push_back(item);
    textSizeDirty_ = true;
    invalidateLayout();
}

void Dropdown::addItems(const std::vector<DropdownItem>& items) {
    items_.insert(items_.end(), items.begin(), items.end());
    textSizeDirty_ = true;
    invalidateLayout();
}

void Dropdown::clearItems() {
    items_.clear();
    selectedIndex_ = -1;
    textSizeDirty_ = true;
    invalidateLayout();
}

// =============================================================================
// Selection
// =============================================================================

void Dropdown::setSelectedIndex(i32 index) {
    if (index < -1 || index >= static_cast<i32>(items_.size())) {
        return;
    }

    if (selectedIndex_ != index) {
        selectedIndex_ = index;
        textSizeDirty_ = true;
        invalidateLayout();
    }
}

void Dropdown::setSelectedValue(i32 value) {
    for (i32 i = 0; i < static_cast<i32>(items_.size()); ++i) {
        if (items_[i].value == value) {
            setSelectedIndex(i);
            return;
        }
    }
}

i32 Dropdown::getSelectedValue() const {
    if (selectedIndex_ >= 0 && selectedIndex_ < static_cast<i32>(items_.size())) {
        return items_[selectedIndex_].value;
    }
    return -1;
}

const DropdownItem* Dropdown::getSelectedItem() const {
    if (selectedIndex_ >= 0 && selectedIndex_ < static_cast<i32>(items_.size())) {
        return &items_[selectedIndex_];
    }
    return nullptr;
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 Dropdown::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    UIContext* ctx = getContext();
    if (!ctx) {
        return Widget::measure(availableWidth, availableHeight);
    }

    f32 maxTextWidth = 0.0f;

#if ES_FEATURE_SDF_FONT
    MSDFFont* font = ctx->getDefaultMSDFFont();
    if (font) {
        for (const auto& item : items_) {
            f32 textWidth = font->measureText(item.label, fontSize_).x;
            maxTextWidth = glm::max(maxTextWidth, textWidth);
        }
    }
#elif ES_FEATURE_BITMAP_FONT
    BitmapFont* font = ctx->getDefaultBitmapFont();
    if (font) {
        for (const auto& item : items_) {
            f32 textWidth = font->measureText(item.label, fontSize_).x;
            maxTextWidth = glm::max(maxTextWidth, textWidth);
        }
    }
#endif

    f32 contentWidth = PADDING_X * 2 + maxTextWidth + ARROW_WIDTH;
    contentWidth = glm::max(contentWidth, MIN_WIDTH);

    f32 width = getWidth().resolve(availableWidth, contentWidth);
    f32 height = getHeight().resolve(availableHeight, 24.0f);

    width = getConstraints().constrainWidth(width);
    height = getConstraints().constrainHeight(height);

    return {width, height};
}

// =============================================================================
// Rendering
// =============================================================================

void Dropdown::render(UIBatchRenderer& renderer) {
    UIContext* ctx = getContext();
    if (!ctx) return;

    const Rect& bounds = getBounds();
    const WidgetState& state = getState();

    constexpr glm::vec4 bgColor{0.165f, 0.165f, 0.165f, 1.0f};           // #2a2a2a
    constexpr glm::vec4 bgHoverColor{0.2f, 0.2f, 0.2f, 1.0f};            // #333333
    constexpr glm::vec4 borderColor{0.275f, 0.275f, 0.275f, 1.0f};       // #464646
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};         // #e0e0e0
    constexpr glm::vec4 arrowColor{0.6f, 0.6f, 0.6f, 1.0f};
    constexpr glm::vec4 popupBgColor{0.188f, 0.188f, 0.188f, 1.0f};      // #303030
    constexpr glm::vec4 hoverBgColor{0.094f, 0.420f, 0.788f, 1.0f};      // #186cb9

    glm::vec4 currentBg = (state.hovered || isOpen_) ? bgHoverColor : bgColor;
    renderer.drawRoundedRect(bounds, currentBg, CornerRadii::all(3.0f));
    renderer.drawRoundedRectOutline(bounds, borderColor, CornerRadii::all(3.0f), 1.0f);

#if ES_FEATURE_SDF_FONT
    MSDFFont* textFont = ctx->getDefaultMSDFFont();
    MSDFFont* iconFont = ctx->getIconMSDFFont();

    if (textFont) {
        const DropdownItem* selected = getSelectedItem();
        std::string displayText = selected ? selected->label : "";

        f32 textX = bounds.x + PADDING_X;
        f32 textY = bounds.y + (bounds.height - fontSize_) * 0.5f;
        renderer.drawText(displayText, {textX, textY}, *textFont, fontSize_, textColor);
    }

    if (iconFont) {
        f32 arrowX = bounds.x + bounds.width - ARROW_WIDTH;
        Rect arrowBounds{arrowX, bounds.y, ARROW_WIDTH, bounds.height};
        std::string arrowIcon = isOpen_ ? icons::ChevronUp : icons::ChevronDown;
        renderer.drawTextInBounds(arrowIcon, arrowBounds, *iconFont, 12.0f, arrowColor,
                                  HAlign::Center, VAlign::Center);
    }
#elif ES_FEATURE_BITMAP_FONT
    BitmapFont* textFont = ctx->getDefaultBitmapFont();

    if (textFont) {
        const DropdownItem* selected = getSelectedItem();
        std::string displayText = selected ? selected->label : "";

        f32 textX = bounds.x + PADDING_X;
        f32 textY = bounds.y + (bounds.height - fontSize_) * 0.5f;
        renderer.drawText(displayText, {textX, textY}, *textFont, fontSize_, textColor);
    }
#endif

    if (isOpen_) {
        Rect popupBounds = getPopupBounds();

        renderer.drawRoundedRect(popupBounds, popupBgColor, CornerRadii::all(3.0f));
        renderer.drawRoundedRectOutline(popupBounds, borderColor, CornerRadii::all(3.0f), 1.0f);

#if ES_FEATURE_SDF_FONT
        if (textFont) {
            f32 itemY = popupBounds.y + PADDING_Y;

            for (i32 i = 0; i < static_cast<i32>(items_.size()); ++i) {
                const DropdownItem& item = items_[i];
                Rect itemBounds{popupBounds.x + 4.0f, itemY, popupBounds.width - 8.0f, ITEM_HEIGHT};

                bool isHovered = (i == hoveredIndex_) && item.enabled;
                bool isSelected = (i == selectedIndex_);

                if (isHovered || isSelected) {
                    glm::vec4 highlightColor = isHovered ? hoverBgColor : glm::vec4{0.25f, 0.25f, 0.25f, 1.0f};
                    renderer.drawRoundedRect(itemBounds, highlightColor, CornerRadii::all(2.0f));
                }

                glm::vec4 itemTextColor = item.enabled ? textColor : glm::vec4{0.5f, 0.5f, 0.5f, 1.0f};
                f32 textX = popupBounds.x + PADDING_X;
                f32 textY = itemY + (ITEM_HEIGHT - fontSize_) * 0.5f;
                renderer.drawText(item.label, {textX, textY}, *textFont, fontSize_, itemTextColor);

                itemY += ITEM_HEIGHT;
            }
        }
#elif ES_FEATURE_BITMAP_FONT
        if (textFont) {
            f32 itemY = popupBounds.y + PADDING_Y;

            for (i32 i = 0; i < static_cast<i32>(items_.size()); ++i) {
                const DropdownItem& item = items_[i];
                Rect itemBounds{popupBounds.x + 4.0f, itemY, popupBounds.width - 8.0f, ITEM_HEIGHT};

                bool isHovered = (i == hoveredIndex_) && item.enabled;
                bool isSelected = (i == selectedIndex_);

                if (isHovered || isSelected) {
                    glm::vec4 highlightColor = isHovered ? hoverBgColor : glm::vec4{0.25f, 0.25f, 0.25f, 1.0f};
                    renderer.drawRoundedRect(itemBounds, highlightColor, CornerRadii::all(2.0f));
                }

                glm::vec4 itemTextColor = item.enabled ? textColor : glm::vec4{0.5f, 0.5f, 0.5f, 1.0f};
                f32 textX = popupBounds.x + PADDING_X;
                f32 textY = itemY + (ITEM_HEIGHT - fontSize_) * 0.5f;
                renderer.drawText(item.label, {textX, textY}, *textFont, fontSize_, itemTextColor);

                itemY += ITEM_HEIGHT;
            }
        }
#endif
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool Dropdown::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    const Rect& bounds = getBounds();

    if (isOpen_) {
        Rect popupBounds = getPopupBounds();
        if (popupBounds.contains(event.x, event.y)) {
            if (hoveredIndex_ >= 0) {
                selectItem(hoveredIndex_);
            }
            return true;
        } else if (bounds.contains(event.x, event.y)) {
            closePopup();
            return true;
        } else {
            closePopup();
            return false;
        }
    }

    if (bounds.contains(event.x, event.y)) {
        openPopup();
        return true;
    }

    return false;
}

bool Dropdown::onMouseUp(const MouseButtonEvent& event) {
    (void)event;
    return false;
}

bool Dropdown::onMouseEnter(const MouseEnterEvent& event) {
    (void)event;
    if (getState().isInteractive()) {
        setState(true, getState().pressed);
        return true;
    }
    return false;
}

bool Dropdown::onMouseLeave(const MouseLeaveEvent& event) {
    (void)event;
    if (!isOpen_) {
        setState(false, getState().pressed);
    }
    return true;
}

bool Dropdown::onMouseMove(const MouseMoveEvent& event) {
    if (!isOpen_) return false;

    Rect popupBounds = getPopupBounds();
    if (popupBounds.contains(event.x, event.y)) {
        hoveredIndex_ = getItemAtY(event.y - popupBounds.y);
    } else {
        hoveredIndex_ = -1;
    }

    return false;
}

bool Dropdown::onKeyDown(const KeyEvent& event) {
    if (!isOpen_) {
        if (event.key == KeyCode::Space || event.key == KeyCode::Enter) {
            openPopup();
            return true;
        }
        return false;
    }

    if (event.key == KeyCode::Escape) {
        closePopup();
        return true;
    }

    if (event.key == KeyCode::Enter && hoveredIndex_ >= 0) {
        selectItem(hoveredIndex_);
        return true;
    }

    if (event.key == KeyCode::Up) {
        i32 start = hoveredIndex_ < 0 ? static_cast<i32>(items_.size()) : hoveredIndex_;
        for (i32 i = start - 1; i >= 0; --i) {
            if (items_[i].enabled) {
                hoveredIndex_ = i;
                break;
            }
        }
        return true;
    }

    if (event.key == KeyCode::Down) {
        i32 start = hoveredIndex_;
        for (i32 i = start + 1; i < static_cast<i32>(items_.size()); ++i) {
            if (items_[i].enabled) {
                hoveredIndex_ = i;
                break;
            }
        }
        return true;
    }

    return false;
}

Widget* Dropdown::hitTest(f32 x, f32 y) {
    if (isOpen_) {
        Rect popupBounds = getPopupBounds();
        if (popupBounds.contains(x, y)) {
            return this;
        }
    }

    const Rect& bounds = getBounds();
    if (bounds.contains(x, y)) {
        return this;
    }

    if (isOpen_) {
        return this;
    }

    return nullptr;
}

// =============================================================================
// Private Methods
// =============================================================================

void Dropdown::openPopup() {
    isOpen_ = true;
    hoveredIndex_ = selectedIndex_;
}

void Dropdown::closePopup() {
    isOpen_ = false;
    hoveredIndex_ = -1;
}

void Dropdown::selectItem(i32 index) {
    if (index < 0 || index >= static_cast<i32>(items_.size())) {
        return;
    }

    const DropdownItem& item = items_[index];
    if (!item.enabled) {
        return;
    }

    i32 oldValue = getSelectedValue();
    selectedIndex_ = index;
    closePopup();

    if (oldValue != item.value) {
        onSelectionChanged.publish(item.value);
    }
}

f32 Dropdown::calculatePopupHeight() const {
    return PADDING_Y * 2 + static_cast<f32>(items_.size()) * ITEM_HEIGHT;
}

i32 Dropdown::getItemAtY(f32 y) const {
    f32 itemY = PADDING_Y;

    for (i32 i = 0; i < static_cast<i32>(items_.size()); ++i) {
        if (y >= itemY && y < itemY + ITEM_HEIGHT) {
            return i;
        }
        itemY += ITEM_HEIGHT;
    }

    return -1;
}

Rect Dropdown::getPopupBounds() const {
    const Rect& bounds = getBounds();
    f32 popupHeight = calculatePopupHeight();

    UIContext* ctx = getContext();
    glm::vec2 viewportSize = ctx ? ctx->getViewportSize() : glm::vec2(9999.0f);

    f32 popupY = bounds.y + bounds.height + 2.0f;
    if (popupY + popupHeight > viewportSize.y) {
        popupY = bounds.y - popupHeight - 2.0f;
    }

    return Rect{bounds.x, popupY, bounds.width, popupHeight};
}

}  // namespace esengine::ui
