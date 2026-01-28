/**
 * @file    Panel.hpp
 * @brief   Panel container widget
 * @details A simple container widget that renders a background and
 *          contains child widgets.
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

namespace esengine::ui {

// =============================================================================
// BorderWidth Struct
// =============================================================================

struct BorderWidth {
    f32 top = 0.0f;
    f32 right = 0.0f;
    f32 bottom = 0.0f;
    f32 left = 0.0f;

    constexpr BorderWidth() = default;
    constexpr BorderWidth(f32 t, f32 r, f32 b, f32 l) : top(t), right(r), bottom(b), left(l) {}
    static constexpr BorderWidth all(f32 v) { return {v, v, v, v}; }
    [[nodiscard]] bool isZero() const { return top == 0 && right == 0 && bottom == 0 && left == 0; }
    [[nodiscard]] bool hasAny() const { return top > 0 || right > 0 || bottom > 0 || left > 0; }
};

// =============================================================================
// Panel Class
// =============================================================================

/**
 * @brief Container widget with styled background
 *
 * @details Panel provides a container for other widgets with a styled
 *          background that can be customized using themes.
 *
 * @code
 * auto panel = makeUnique<Panel>(WidgetId("myPanel"));
 * panel->setLayout(makeUnique<StackLayout>(StackDirection::Vertical, 8.0f));
 * panel->addChild(makeUnique<Label>(WidgetId("label"), "Hello"));
 * panel->addChild(makeUnique<Button>(WidgetId("btn"), "Click"));
 * @endcode
 */
class Panel : public Widget {
public:
    /**
     * @brief Creates a panel
     * @param id Widget identifier
     */
    explicit Panel(const WidgetId& id);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets whether to draw the background */
    void setDrawBackground(bool draw) { drawBackground_ = draw; }

    /** @brief Returns true if background is drawn */
    bool isDrawingBackground() const { return drawBackground_; }

    /** @brief Sets whether to draw the border */
    void setDrawBorder(bool draw) { drawBorder_ = draw; }

    /** @brief Returns true if border is drawn */
    bool isDrawingBorder() const { return drawBorder_; }

    /** @brief Sets a custom background color (overrides theme) */
    void setBackgroundColor(const glm::vec4& color);

    /** @brief Clears the custom background color (use theme) */
    void clearBackgroundColor() { customBackground_ = false; }

    /** @brief Sets a custom border color (overrides theme) */
    void setBorderColor(const glm::vec4& color);

    /** @brief Sets per-side border widths */
    void setBorderWidth(const BorderWidth& width);

    /** @brief Gets the border width */
    const BorderWidth& getBorderWidth() const { return borderWidth_; }

    /** @brief Sets the corner radii */
    void setCornerRadii(const CornerRadii& radii) { cornerRadii_ = radii; }

    /** @brief Gets the corner radii */
    const CornerRadii& getCornerRadii() const { return cornerRadii_; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    void render(UIBatchRenderer& renderer) override;

private:
    bool drawBackground_ = true;
    bool drawBorder_ = false;
    bool customBackground_ = false;
    bool customBorder_ = false;

    glm::vec4 backgroundColor_{0.0f};
    glm::vec4 borderColor_{0.0f};
    CornerRadii cornerRadii_;
    BorderWidth borderWidth_;
};

}  // namespace esengine::ui
