/**
 * @file    ScrollView.hpp
 * @brief   Scrollable container widget
 * @details A container widget that provides scrolling for content larger
 *          than its visible area. Supports vertical and horizontal scrolling
 *          with optional scrollbars.
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
// ScrollDirection Enum
// =============================================================================

/**
 * @brief Scroll direction flags
 */
enum class ScrollDirection : u8 {
    None = 0,
    Vertical = 1 << 0,
    Horizontal = 1 << 1,
    Both = Vertical | Horizontal
};

inline ScrollDirection operator|(ScrollDirection a, ScrollDirection b) {
    return static_cast<ScrollDirection>(static_cast<u8>(a) | static_cast<u8>(b));
}

inline bool operator&(ScrollDirection a, ScrollDirection b) {
    return (static_cast<u8>(a) & static_cast<u8>(b)) != 0;
}

// =============================================================================
// ScrollView Class
// =============================================================================

/**
 * @brief Scrollable container widget
 *
 * @details ScrollView provides a scrollable viewport for content that exceeds
 *          the available space. Features:
 *          - Vertical and/or horizontal scrolling
 *          - Mouse wheel support
 *          - Optional scrollbar rendering
 *          - Smooth scrolling with configurable speed
 *
 * @code
 * auto scroll = makeUnique<ScrollView>(WidgetId("scroll"));
 * scroll->setScrollDirection(ScrollDirection::Vertical);
 * scroll->setShowScrollbars(true);
 *
 * auto content = makeUnique<Panel>(WidgetId("content"));
 * content->setHeight(SizeValue::pixels(2000.0f)); // Tall content
 * scroll->setContent(std::move(content));
 * @endcode
 */
class ScrollView : public Widget {
public:
    /**
     * @brief Creates a scroll view
     * @param id Widget identifier
     */
    explicit ScrollView(const WidgetId& id);

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * @brief Sets the scroll direction
     * @param direction Vertical, Horizontal, or Both
     */
    void setScrollDirection(ScrollDirection direction) { scrollDirection_ = direction; }

    /**
     * @brief Gets the scroll direction
     */
    ScrollDirection getScrollDirection() const { return scrollDirection_; }

    /**
     * @brief Sets whether to show scrollbars
     * @param show True to show scrollbars
     */
    void setShowScrollbars(bool show) { showScrollbars_ = show; }

    /**
     * @brief Returns true if scrollbars are shown
     */
    bool isShowingScrollbars() const { return showScrollbars_; }

    /**
     * @brief Sets the scrollbar width
     * @param width Scrollbar width in pixels
     */
    void setScrollbarWidth(f32 width) { scrollbarWidth_ = width; }

    /**
     * @brief Gets the scrollbar width
     */
    f32 getScrollbarWidth() const { return scrollbarWidth_; }

    /**
     * @brief Sets the scroll speed multiplier
     * @param speed Scroll speed (default 1.0)
     */
    void setScrollSpeed(f32 speed) { scrollSpeed_ = speed; }

    /**
     * @brief Gets the scroll speed
     */
    f32 getScrollSpeed() const { return scrollSpeed_; }

    // =========================================================================
    // Content
    // =========================================================================

    /**
     * @brief Sets the scrollable content
     * @param content Widget to scroll (ownership transferred)
     */
    void setContent(Unique<Widget> content);

    /**
     * @brief Gets the content widget
     */
    Widget* getContent() const { return content_; }

    // =========================================================================
    // Scroll Position
    // =========================================================================

    /**
     * @brief Gets the current scroll offset
     * @return Scroll offset (x, y)
     */
    glm::vec2 getScrollOffset() const { return scrollOffset_; }

    /**
     * @brief Sets the scroll offset
     * @param offset New scroll offset (will be clamped)
     */
    void setScrollOffset(const glm::vec2& offset);

    /**
     * @brief Scrolls by a delta amount
     * @param delta Amount to scroll (x, y)
     */
    void scrollBy(const glm::vec2& delta);

    /**
     * @brief Scrolls to make a widget visible
     * @param widget Widget to scroll to
     */
    void scrollToWidget(const Widget* widget);

    /**
     * @brief Gets the maximum scroll offset
     */
    glm::vec2 getMaxScrollOffset() const;

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const Rect& bounds) override;
    void render(UIBatchRenderer& renderer) override;
    Widget* hitTest(f32 x, f32 y) override;

    bool onScroll(const ScrollEvent& event) override;
    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;

private:
    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * @brief Clamps scroll offset to valid range
     */
    void clampScrollOffset();

    /**
     * @brief Updates content layout based on scroll offset
     */
    void updateContentLayout();

    /**
     * @brief Renders the vertical scrollbar
     */
    void renderVerticalScrollbar(UIBatchRenderer& renderer);

    /**
     * @brief Renders the horizontal scrollbar
     */
    void renderHorizontalScrollbar(UIBatchRenderer& renderer);

    /**
     * @brief Gets the vertical scrollbar bounds
     */
    Rect getVerticalScrollbarBounds() const;

    /**
     * @brief Gets the horizontal scrollbar bounds
     */
    Rect getHorizontalScrollbarBounds() const;

    /**
     * @brief Gets the vertical scrollbar thumb bounds
     */
    Rect getVerticalScrollbarThumbBounds() const;

    /**
     * @brief Gets the horizontal scrollbar thumb bounds
     */
    Rect getHorizontalScrollbarThumbBounds() const;

    /**
     * @brief Checks if scrolling is possible in a direction
     */
    bool canScrollVertically() const;
    bool canScrollHorizontally() const;

    // =========================================================================
    // Member Variables
    // =========================================================================

    Widget* content_ = nullptr;                           ///< Scrollable content
    ScrollDirection scrollDirection_ = ScrollDirection::Vertical;
    bool showScrollbars_ = true;
    f32 scrollbarWidth_ = 12.0f;
    f32 scrollSpeed_ = 20.0f;

    glm::vec2 scrollOffset_{0.0f, 0.0f};                  ///< Current scroll position
    glm::vec2 contentSize_{0.0f, 0.0f};                   ///< Size of content
    glm::vec2 viewportSize_{0.0f, 0.0f};                  ///< Size of visible area

    // Scrollbar dragging state
    bool draggingVerticalScrollbar_ = false;
    bool draggingHorizontalScrollbar_ = false;
    glm::vec2 dragStartMousePos_{0.0f, 0.0f};
    glm::vec2 dragStartScrollOffset_{0.0f, 0.0f};
};

}  // namespace esengine::ui
