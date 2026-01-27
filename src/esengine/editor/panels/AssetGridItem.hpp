/**
 * @file    AssetGridItem.hpp
 * @brief   Grid item widget for displaying assets in the browser
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
#include "AssetBrowserTypes.hpp"

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// AssetGridItem Class
// =============================================================================

class AssetGridItem : public ui::Widget {
public:
    static constexpr f32 ITEM_WIDTH = 80.0f;
    static constexpr f32 ITEM_HEIGHT = 100.0f;
    static constexpr f32 ICON_SIZE = 48.0f;
    static constexpr f32 ICON_PADDING = 16.0f;
    static constexpr f32 LABEL_HEIGHT = 36.0f;

    AssetGridItem(const ui::WidgetId& id, const AssetEntry& entry);

    const AssetEntry& getEntry() const { return entry_; }

    void setSelected(bool selected);
    bool isSelected() const { return selected_; }

    Signal<void(const std::string&)> onClick;
    Signal<void(const std::string&)> onDoubleClick;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseUp(const ui::MouseButtonEvent& event) override;

private:
    AssetEntry entry_;
    bool selected_ = false;
    f64 lastClickTime_ = 0.0;
};

}  // namespace esengine::editor
