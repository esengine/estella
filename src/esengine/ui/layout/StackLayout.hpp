/**
 * @file    StackLayout.hpp
 * @brief   Vertical and horizontal stack layout
 * @details Arranges children in a single row or column with configurable
 *          spacing and alignment.
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
#include "SizeValue.hpp"

namespace esengine::ui {

// =============================================================================
// Stack Direction
// =============================================================================

/**
 * @brief Direction for stack layout
 */
enum class StackDirection : u8 {
    Vertical,
    Horizontal
};

// =============================================================================
// StackLayout Class
// =============================================================================

/**
 * @brief Arranges children in a stack (row or column)
 *
 * @details Children are laid out sequentially along the main axis with
 *          configurable spacing, padding, and alignment.
 *
 * @code
 * auto panel = makeUnique<Panel>("panel");
 * panel->setLayout(makeUnique<StackLayout>(StackDirection::Vertical, 8.0f));
 * panel->addChild(makeUnique<Label>("label1", "First"));
 * panel->addChild(makeUnique<Label>("label2", "Second"));
 * @endcode
 */
class StackLayout : public Layout {
public:
    /**
     * @brief Creates a stack layout
     * @param direction Stack direction (Vertical or Horizontal)
     * @param spacing Space between children in pixels
     */
    explicit StackLayout(StackDirection direction = StackDirection::Vertical, f32 spacing = 0.0f);

    // =========================================================================
    // Configuration
    // =========================================================================

    /** @brief Sets the stack direction */
    void setDirection(StackDirection direction) { direction_ = direction; }

    /** @brief Gets the stack direction */
    StackDirection getDirection() const { return direction_; }

    /** @brief Sets the spacing between children */
    void setSpacing(f32 spacing) { spacing_ = spacing; }

    /** @brief Gets the spacing between children */
    f32 getSpacing() const { return spacing_; }

    /** @brief Sets the cross-axis alignment */
    void setCrossAlignment(HAlign align) { crossHAlign_ = align; }

    /** @brief Sets the cross-axis alignment */
    void setCrossAlignment(VAlign align) { crossVAlign_ = align; }

    /** @brief Sets whether to reverse the order */
    void setReverse(bool reverse) { reverse_ = reverse; }

    // =========================================================================
    // Layout Interface
    // =========================================================================

    glm::vec2 measure(Widget& container, f32 availableWidth, f32 availableHeight) override;
    void layout(Widget& container, const Rect& bounds) override;

private:
    StackDirection direction_ = StackDirection::Vertical;
    f32 spacing_ = 0.0f;
    HAlign crossHAlign_ = HAlign::Stretch;
    VAlign crossVAlign_ = VAlign::Stretch;
    bool reverse_ = false;
};

}  // namespace esengine::ui
