#include "AssetGridItem.hpp"
#include "../../ui/UIContext.hpp"
#include "../../ui/font/Font.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"

#include <chrono>

namespace esengine::editor {

namespace {
    f64 getCurrentTimeSeconds() {
        auto now = std::chrono::steady_clock::now();
        auto duration = now.time_since_epoch();
        return std::chrono::duration<f64>(duration).count();
    }
}  // namespace

AssetGridItem::AssetGridItem(const ui::WidgetId& id, const AssetEntry& entry)
    : Widget(id), entry_(entry) {
    setWidth(ui::SizeValue::px(ITEM_WIDTH));
    setHeight(ui::SizeValue::px(ITEM_HEIGHT));
}

void AssetGridItem::setSelected(bool selected) {
    selected_ = selected;
}

glm::vec2 AssetGridItem::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;
    return {ITEM_WIDTH, ITEM_HEIGHT};
}

void AssetGridItem::render(ui::UIBatchRenderer& renderer) {
    ui::UIContext* ctx = getContext();
    if (!ctx) return;

    ui::Rect bounds = getBounds();
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

    ui::Font* font = ctx->getDefaultFont();
    if (font) {
        ui::Rect labelBounds{
            bounds.x + 4.0f,
            bounds.y + ICON_PADDING + ICON_SIZE + 4.0f,
            bounds.width - 8.0f,
            LABEL_HEIGHT
        };

        glm::vec4 textColor = theme.colors.textPrimary;
        renderer.drawTextInBounds(
            entry_.name,
            labelBounds,
            *font,
            11.0f,
            textColor,
            ui::HAlign::Center,
            ui::VAlign::Top
        );
    }
}

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
