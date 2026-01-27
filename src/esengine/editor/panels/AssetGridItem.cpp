/**
 * @file    AssetGridItem.cpp
 * @brief   Grid item widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "AssetGridItem.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/font/SDFFont.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"

#include <chrono>

namespace esengine::editor {

// =============================================================================
// Helper Functions
// =============================================================================

namespace {

f64 getCurrentTimeSeconds() {
    auto now = std::chrono::steady_clock::now();
    auto duration = now.time_since_epoch();
    return std::chrono::duration<f64>(duration).count();
}

std::string truncateText(const std::string& text, ui::SDFFont& font, f32 fontSize, f32 maxWidth) {
    glm::vec2 textSize = font.measureText(text, fontSize);
    if (textSize.x <= maxWidth) {
        return text;
    }

    const std::string ellipsis = "...";
    f32 ellipsisWidth = font.measureText(ellipsis, fontSize).x;
    f32 availableWidth = maxWidth - ellipsisWidth;

    if (availableWidth <= 0) {
        return ellipsis;
    }

    std::string result;
    f32 currentWidth = 0.0f;
    const u8* ptr = reinterpret_cast<const u8*>(text.data());
    const u8* end = ptr + text.size();

    while (ptr < end) {
        const u8* charStart = ptr;
        u32 codepoint;

        if ((*ptr & 0x80) == 0) {
            codepoint = *ptr++;
        } else if ((*ptr & 0xE0) == 0xC0) {
            codepoint = (*ptr++ & 0x1F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else if ((*ptr & 0xF0) == 0xE0) {
            codepoint = (*ptr++ & 0x0F) << 12;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else if ((*ptr & 0xF8) == 0xF0) {
            codepoint = (*ptr++ & 0x07) << 18;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 12;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F) << 6;
            if (ptr < end) codepoint |= (*ptr++ & 0x3F);
        } else {
            ptr++;
            continue;
        }

        f32 charWidth = font.getCharWidth(codepoint, fontSize);
        if (currentWidth + charWidth > availableWidth) {
            break;
        }

        currentWidth += charWidth;
        result.append(reinterpret_cast<const char*>(charStart),
                      static_cast<usize>(ptr - charStart));
    }

    return result + ellipsis;
}

}  // namespace

// =============================================================================
// Constructor
// =============================================================================

AssetGridItem::AssetGridItem(const ui::WidgetId& id, const AssetEntry& entry)
    : Widget(id), entry_(entry) {
    setWidth(ui::SizeValue::px(ITEM_WIDTH));
    setHeight(ui::SizeValue::px(ITEM_HEIGHT));
}

void AssetGridItem::setSelected(bool selected) {
    selected_ = selected;
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 AssetGridItem::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;
    return {ITEM_WIDTH, ITEM_HEIGHT};
}

// =============================================================================
// Rendering
// =============================================================================

void AssetGridItem::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    ui::Rect bounds = getBounds();

    if (bounds.width <= 0 || bounds.height <= 0) {
        return;
    }

    const auto& theme = ctx->getTheme();

    if (selected_) {
        renderer.drawRoundedRect(
            bounds,
            theme.colors.selection,
            ui::CornerRadii::all(4.0f)
        );
    } else if (isHovered()) {
        renderer.drawRoundedRect(
            bounds,
            theme.colors.buttonHover,
            ui::CornerRadii::all(4.0f)
        );
    }

    f32 iconX = bounds.x + (bounds.width - ICON_SIZE) * 0.5f;
    f32 iconY = bounds.y + ICON_PADDING;
    ui::Rect iconBounds{iconX, iconY, ICON_SIZE, ICON_SIZE};

    glm::vec4 iconColor = getAssetTypeColor(entry_.type);
    renderer.drawRoundedRect(iconBounds, iconColor, ui::CornerRadii::all(6.0f));

    ui::SDFFont* font = ctx->getDefaultFont();
    if (font) {
        f32 labelWidth = bounds.width - 8.0f;
        ui::Rect labelBounds{
            bounds.x + 4.0f,
            bounds.y + ICON_PADDING + ICON_SIZE + 4.0f,
            labelWidth,
            LABEL_HEIGHT
        };

        std::string displayName = truncateText(entry_.name, *font, 11.0f, labelWidth);
        glm::vec4 textColor = theme.colors.textPrimary;
        renderer.drawTextInBounds(
            displayName,
            labelBounds,
            *font,
            11.0f,
            textColor,
            ui::HAlign::Center,
            ui::VAlign::Top
        );
    }
}

// =============================================================================
// Event Handling
// =============================================================================

bool AssetGridItem::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button == ui::MouseButton::Left) {
        f64 currentTime = getCurrentTimeSeconds();
        constexpr f64 DOUBLE_CLICK_THRESHOLD = 0.3;

        if (currentTime - lastClickTime_ < DOUBLE_CLICK_THRESHOLD) {
            onDoubleClick.publish(entry_.path);
            lastClickTime_ = 0.0;
        } else {
            onClick.publish(entry_.path);
            lastClickTime_ = currentTime;
        }
        return true;
    }
    return false;
}

bool AssetGridItem::onMouseUp(const ui::MouseButtonEvent& event) {
    (void)event;
    return false;
}

}  // namespace esengine::editor
