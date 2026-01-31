/**
 * @file    ContextMenu.cpp
 * @brief   Context menu widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ContextMenu.hpp"
#include "../UIContext.hpp"
#include "../icons/Icons.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../math/Math.hpp"

#if ES_FEATURE_SDF_FONT
#include "../font/MSDFFont.hpp"
#endif

#include "../font/SystemFont.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

ContextMenu::ContextMenu(const WidgetId& id) : Widget(id) {
    setVisible(false);
}

// =============================================================================
// Menu Items
// =============================================================================

void ContextMenu::addItem(const MenuItem& item) {
    items_.push_back(item);
    invalidateLayout();
}

void ContextMenu::addItems(const std::vector<MenuItem>& items) {
    items_.insert(items_.end(), items.begin(), items.end());
    invalidateLayout();
}

void ContextMenu::clearItems() {
    items_.clear();
    invalidateLayout();
}

// =============================================================================
// Visibility
// =============================================================================

void ContextMenu::show(f32 x, f32 y) {
    menuX_ = x;
    menuY_ = y;
    isOpen_ = true;
    hoveredIndex_ = -1;
    setVisible(true);
    invalidateLayout();
}

void ContextMenu::hide() {
    if (isOpen_) {
        isOpen_ = false;
        setVisible(false);
        onClosed.publish();
    }
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 ContextMenu::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;

    f32 width = MIN_WIDTH;
    f32 height = calculateMenuHeight();

#if ES_FEATURE_SDF_FONT
    UIContext* ctx = getContext();
    MSDFFont* font = ctx ? ctx->getDefaultMSDFFont() : nullptr;
    if (font) {
        for (const auto& item : items_) {
            if (item.separator) continue;

            f32 textWidth = font->measureText(item.label, 13.0f).x;
            f32 shortcutWidth = item.shortcut.empty() ? 0.0f
                : font->measureText(item.shortcut, 12.0f).x + 32.0f;
            f32 itemWidth = PADDING_X * 2 + ICON_SIZE + 8.0f + textWidth + shortcutWidth + 8.0f;
            width = glm::max(width, itemWidth);
        }
    }
#else
    UIContext* ctx = getContext();
    SystemFont* font = ctx ? ctx->getDefaultSystemFont() : nullptr;
    if (font) {
        for (const auto& item : items_) {
            if (item.separator) continue;

            f32 textWidth = font->measureText(item.label, 13.0f).x;
            f32 shortcutWidth = item.shortcut.empty() ? 0.0f
                : font->measureText(item.shortcut, 12.0f).x + 32.0f;
            f32 itemWidth = PADDING_X * 2 + ICON_SIZE + 8.0f + textWidth + shortcutWidth + 8.0f;
            width = glm::max(width, itemWidth);
        }
    }
#endif

    return {width, height};
}

// =============================================================================
// Rendering
// =============================================================================

void ContextMenu::render(UIBatchRenderer& renderer) {
    if (!isOpen_) return;

    UIContext* ctx = getContext();
    if (!ctx) return;

    constexpr glm::vec4 bgColor{0.188f, 0.188f, 0.188f, 1.0f};           // #303030
    constexpr glm::vec4 borderColor{0.275f, 0.275f, 0.275f, 1.0f};       // #464646
    constexpr glm::vec4 hoverBg{0.094f, 0.420f, 0.788f, 1.0f};           // #186cb9
    constexpr glm::vec4 textColor{0.878f, 0.878f, 0.878f, 1.0f};         // #e0e0e0
    constexpr glm::vec4 disabledColor{0.5f, 0.5f, 0.5f, 1.0f};
    constexpr glm::vec4 shortcutColor{0.6f, 0.6f, 0.6f, 1.0f};
    constexpr glm::vec4 separatorColor{0.275f, 0.275f, 0.275f, 1.0f};

    glm::vec2 size = measure(0.0f, 0.0f);

    glm::vec2 viewportSize = ctx->getViewportSize();
    f32 x = menuX_;
    f32 y = menuY_;

    if (x + size.x > viewportSize.x) {
        x = viewportSize.x - size.x - 4.0f;
    }
    if (y + size.y > viewportSize.y) {
        y = viewportSize.y - size.y - 4.0f;
    }

    Rect menuBounds{x, y, size.x, size.y};

    renderer.drawRoundedRect(menuBounds, bgColor, CornerRadii::all(4.0f));
    renderer.drawRoundedRectOutline(menuBounds, borderColor, CornerRadii::all(4.0f), 1.0f);

#if ES_FEATURE_SDF_FONT
    MSDFFont* textFont = ctx->getDefaultMSDFFont();
    MSDFFont* iconFont = ctx->getIconMSDFFont();

    if (!textFont) return;

    f32 itemY = y + PADDING_Y;

    for (usize i = 0; i < items_.size(); ++i) {
        const MenuItem& item = items_[i];

        if (item.separator) {
            f32 sepY = itemY + SEPARATOR_HEIGHT * 0.5f;
            Rect sepLine{x + 8.0f, sepY, size.x - 16.0f, 1.0f};
            renderer.drawRect(sepLine, separatorColor);
            itemY += SEPARATOR_HEIGHT;
            continue;
        }

        Rect itemBounds{x + 4.0f, itemY, size.x - 8.0f, ITEM_HEIGHT};

        bool isHovered = (static_cast<i32>(i) == hoveredIndex_) && item.enabled;
        if (isHovered) {
            renderer.drawRoundedRect(itemBounds, hoverBg, CornerRadii::all(3.0f));
        }

        glm::vec4 color = item.enabled ? textColor : disabledColor;

        f32 iconX = x + PADDING_X;
        if (iconFont && !item.icon.empty()) {
            Rect iconBounds{iconX, itemY + (ITEM_HEIGHT - ICON_SIZE) * 0.5f,
                            ICON_SIZE, ICON_SIZE};
            renderer.drawTextInBounds(item.icon, iconBounds, *iconFont, 14.0f, color,
                                      HAlign::Center, VAlign::Center);
        }

        f32 textX = iconX + ICON_SIZE + 8.0f;
        f32 textY = itemY + (ITEM_HEIGHT - 13.0f) * 0.5f;
        renderer.drawText(item.label, {textX, textY}, *textFont, 13.0f, color);

        if (!item.shortcut.empty()) {
            f32 shortcutWidth = textFont->measureText(item.shortcut, 12.0f).x;
            f32 shortcutX = x + size.x - PADDING_X - shortcutWidth;
            f32 shortcutY = itemY + (ITEM_HEIGHT - 12.0f) * 0.5f;
            renderer.drawText(item.shortcut, {shortcutX, shortcutY}, *textFont, 12.0f, shortcutColor);
        }

        itemY += ITEM_HEIGHT;
    }
#else
    SystemFont* textFont = ctx->getDefaultSystemFont();
    SystemFont* iconFont = ctx->getIconSystemFont();

    if (!textFont) return;

    f32 itemY = y + PADDING_Y;

    for (usize i = 0; i < items_.size(); ++i) {
        const MenuItem& item = items_[i];

        if (item.separator) {
            f32 sepY = itemY + SEPARATOR_HEIGHT * 0.5f;
            Rect sepLine{x + 8.0f, sepY, size.x - 16.0f, 1.0f};
            renderer.drawRect(sepLine, separatorColor);
            itemY += SEPARATOR_HEIGHT;
            continue;
        }

        Rect itemBounds{x + 4.0f, itemY, size.x - 8.0f, ITEM_HEIGHT};

        bool isHovered = (static_cast<i32>(i) == hoveredIndex_) && item.enabled;
        if (isHovered) {
            renderer.drawRoundedRect(itemBounds, hoverBg, CornerRadii::all(3.0f));
        }

        glm::vec4 color = item.enabled ? textColor : disabledColor;

        f32 iconX = x + PADDING_X;
        if (iconFont && !item.icon.empty()) {
            Rect iconBounds{iconX, itemY + (ITEM_HEIGHT - ICON_SIZE) * 0.5f,
                            ICON_SIZE, ICON_SIZE};
            renderer.drawTextInBounds(item.icon, iconBounds, *iconFont, 14.0f, color,
                                      HAlign::Center, VAlign::Center);
        }

        f32 textX = iconX + ICON_SIZE + 8.0f;
        f32 textY = itemY + (ITEM_HEIGHT - 13.0f) * 0.5f;
        renderer.drawText(item.label, {textX, textY}, *textFont, 13.0f, color);

        if (!item.shortcut.empty()) {
            f32 shortcutWidth = textFont->measureText(item.shortcut, 12.0f).x;
            f32 shortcutX = x + size.x - PADDING_X - shortcutWidth;
            f32 shortcutY = itemY + (ITEM_HEIGHT - 12.0f) * 0.5f;
            renderer.drawText(item.shortcut, {shortcutX, shortcutY}, *textFont, 12.0f, shortcutColor);
        }

        itemY += ITEM_HEIGHT;
    }
#endif
}

// =============================================================================
// Event Handling
// =============================================================================

bool ContextMenu::onMouseDown(const MouseButtonEvent& event) {
    if (!isOpen_) return false;

    glm::vec2 size = measure(0.0f, 0.0f);

    UIContext* ctx = getContext();
    glm::vec2 viewportSize = ctx ? ctx->getViewportSize() : glm::vec2(9999.0f);

    f32 x = menuX_;
    f32 y = menuY_;
    if (x + size.x > viewportSize.x) {
        x = viewportSize.x - size.x - 4.0f;
    }
    if (y + size.y > viewportSize.y) {
        y = viewportSize.y - size.y - 4.0f;
    }

    Rect menuBounds{x, y, size.x, size.y};

    if (!menuBounds.contains(event.x, event.y)) {
        hide();
        return false;
    }

    if (event.button == MouseButton::Left && hoveredIndex_ >= 0) {
        selectItem(hoveredIndex_);
        return true;
    }

    return true;
}

bool ContextMenu::onMouseMove(const MouseMoveEvent& event) {
    if (!isOpen_) return false;

    glm::vec2 size = measure(0.0f, 0.0f);

    UIContext* ctx = getContext();
    glm::vec2 viewportSize = ctx ? ctx->getViewportSize() : glm::vec2(9999.0f);

    f32 x = menuX_;
    f32 y = menuY_;
    if (x + size.x > viewportSize.x) {
        x = viewportSize.x - size.x - 4.0f;
    }
    if (y + size.y > viewportSize.y) {
        y = viewportSize.y - size.y - 4.0f;
    }

    Rect menuBounds{x, y, size.x, size.y};
    if (menuBounds.contains(event.x, event.y)) {
        hoveredIndex_ = getItemAtY(event.y - y);
    } else {
        hoveredIndex_ = -1;
    }

    return false;
}

bool ContextMenu::onKeyDown(const KeyEvent& event) {
    if (!isOpen_) return false;

    if (event.key == KeyCode::Escape) {
        hide();
        return true;
    }

    if (event.key == KeyCode::Enter && hoveredIndex_ >= 0) {
        selectItem(hoveredIndex_);
        return true;
    }

    if (event.key == KeyCode::Up) {
        i32 start = hoveredIndex_ < 0 ? static_cast<i32>(items_.size()) : hoveredIndex_;
        for (i32 i = start - 1; i >= 0; --i) {
            if (!items_[i].separator && items_[i].enabled) {
                hoveredIndex_ = i;
                break;
            }
        }
        return true;
    }

    if (event.key == KeyCode::Down) {
        i32 start = hoveredIndex_;
        for (i32 i = start + 1; i < static_cast<i32>(items_.size()); ++i) {
            if (!items_[i].separator && items_[i].enabled) {
                hoveredIndex_ = i;
                break;
            }
        }
        return true;
    }

    return false;
}

Widget* ContextMenu::hitTest(f32 x, f32 y) {
    (void)x;
    (void)y;

    if (!isOpen_) return nullptr;

    return this;
}

// =============================================================================
// Private Methods
// =============================================================================

f32 ContextMenu::calculateMenuHeight() const {
    f32 height = PADDING_Y * 2;

    for (const auto& item : items_) {
        if (item.separator) {
            height += SEPARATOR_HEIGHT;
        } else {
            height += ITEM_HEIGHT;
        }
    }

    return height;
}

i32 ContextMenu::getItemAtY(f32 y) const {
    f32 itemY = PADDING_Y;

    for (usize i = 0; i < items_.size(); ++i) {
        const MenuItem& item = items_[i];
        f32 itemHeight = item.separator ? SEPARATOR_HEIGHT : ITEM_HEIGHT;

        if (y >= itemY && y < itemY + itemHeight) {
            if (item.separator || !item.enabled) {
                return -1;
            }
            return static_cast<i32>(i);
        }

        itemY += itemHeight;
    }

    return -1;
}

void ContextMenu::selectItem(i32 index) {
    if (index < 0 || index >= static_cast<i32>(items_.size())) {
        return;
    }

    const MenuItem& item = items_[index];
    if (item.separator || !item.enabled) {
        return;
    }

    hide();
    onItemSelected.publish(item.id);
}

}  // namespace esengine::ui
