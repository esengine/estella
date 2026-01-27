/**
 * @file    WrapLayout.hpp
 * @brief   Flow/wrap layout for grid-like arrangements
 * @details Arranges children in rows that wrap to the next line when
 *          the container width is exceeded.
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

#include "Layout.hpp"

namespace esengine::ui {

// =============================================================================
// WrapLayout Class
// =============================================================================

/**
 * @brief Arranges children in a wrapping flow layout
 *
 * @details Children are laid out horizontally and wrap to the next row
 *          when they exceed the container width. Useful for grid-like
 *          displays such as asset browsers.
 *
 * @code
 * auto panel = makeUnique<Panel>("panel");
 * panel->setLayout(makeUnique<WrapLayout>(8.0f, 8.0f));
 * panel->addChild(makeUnique<AssetItem>("item1"));
 * panel->addChild(makeUnique<AssetItem>("item2"));
 * @endcode
 */
class WrapLayout : public Layout {
public:
    /**
     * @brief Creates a wrap layout
     * @param hSpacing Horizontal space between items in pixels
     * @param vSpacing Vertical space between rows in pixels
     */
    explicit WrapLayout(f32 hSpacing = 4.0f, f32 vSpacing = 4.0f);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets the horizontal spacing between items */
    void setHorizontalSpacing(f32 spacing) { hSpacing_ = spacing; }

    /** @brief Gets the horizontal spacing */
    f32 getHorizontalSpacing() const { return hSpacing_; }

    /** @brief Sets the vertical spacing between rows */
    void setVerticalSpacing(f32 spacing) { vSpacing_ = spacing; }

    /** @brief Gets the vertical spacing */
    f32 getVerticalSpacing() const { return vSpacing_; }

    // =========================================================================
    // Layout Interface
    // =========================================================================

    glm::vec2 measure(Widget& container, f32 availableWidth, f32 availableHeight) override;
    void layout(Widget& container, const Rect& bounds) override;

private:
    f32 hSpacing_ = 4.0f;
    f32 vSpacing_ = 4.0f;
};

}  // namespace esengine::ui
