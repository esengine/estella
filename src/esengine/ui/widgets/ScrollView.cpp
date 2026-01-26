/**
 * @file    ScrollView.cpp
 * @brief   Scrollable container widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ScrollView.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../math/Math.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

ScrollView::ScrollView(const WidgetId& id) : Widget(id) {}

// =============================================================================
// Content Management
// =============================================================================

void ScrollView::setContent(Unique<Widget> content) {
    if (content_) {
        removeChild(content_);
    }

    if (content) {
        content_ = content.get();
        addChild(std::move(content));
        invalidateLayout();
    } else {
        content_ = nullptr;
    }
}

// =============================================================================
// Scroll Position
// =============================================================================

void ScrollView::setScrollOffset(const glm::vec2& offset) {
    scrollOffset_ = offset;
    clampScrollOffset();
    updateContentLayout();
}

void ScrollView::scrollBy(const glm::vec2& delta) {
    setScrollOffset(scrollOffset_ + delta);
}

void ScrollView::scrollToWidget(const Widget* widget) {
    if (!widget || !content_) return;

    const Rect& widgetBounds = widget->getBounds();
    const Rect& viewBounds = getBounds();

    glm::vec2 newOffset = scrollOffset_;

    if (scrollDirection_ & ScrollDirection::Vertical) {
        f32 widgetTop = widgetBounds.y;
        f32 widgetBottom = widgetBounds.y + widgetBounds.height;
        f32 viewTop = viewBounds.y + scrollOffset_.y;
        f32 viewBottom = viewTop + viewportSize_.y;

        if (widgetTop < viewTop) {
            newOffset.y = widgetTop - viewBounds.y;
        } else if (widgetBottom > viewBottom) {
            newOffset.y = widgetBottom - viewBounds.y - viewportSize_.y;
        }
    }

    if (scrollDirection_ & ScrollDirection::Horizontal) {
        f32 widgetLeft = widgetBounds.x;
        f32 widgetRight = widgetBounds.x + widgetBounds.width;
        f32 viewLeft = viewBounds.x + scrollOffset_.x;
        f32 viewRight = viewLeft + viewportSize_.x;

        if (widgetLeft < viewLeft) {
            newOffset.x = widgetLeft - viewBounds.x;
        } else if (widgetRight > viewRight) {
            newOffset.x = widgetRight - viewBounds.x - viewportSize_.x;
        }
    }

    setScrollOffset(newOffset);
}

glm::vec2 ScrollView::getMaxScrollOffset() const {
    glm::vec2 maxOffset{0.0f, 0.0f};

    if (scrollDirection_ & ScrollDirection::Vertical) {
        maxOffset.y = glm::max(0.0f, contentSize_.y - viewportSize_.y);
    }

    if (scrollDirection_ & ScrollDirection::Horizontal) {
        maxOffset.x = glm::max(0.0f, contentSize_.x - viewportSize_.x);
    }

    return maxOffset;
}

// =============================================================================
// Layout
// =============================================================================

glm::vec2 ScrollView::measure(f32 availableWidth, f32 availableHeight) {
    glm::vec2 size = Widget::measure(availableWidth, availableHeight);

    if (content_) {
        f32 contentAvailableWidth = availableWidth;
        f32 contentAvailableHeight = availableHeight;

        if (showScrollbars_) {
            if (scrollDirection_ & ScrollDirection::Vertical) {
                contentAvailableWidth -= scrollbarWidth_;
            }
            if (scrollDirection_ & ScrollDirection::Horizontal) {
                contentAvailableHeight -= scrollbarWidth_;
            }
        }

        contentSize_ = content_->measure(std::numeric_limits<f32>::infinity(),
                                          std::numeric_limits<f32>::infinity());
    }

    return size;
}

void ScrollView::layout(const Rect& bounds) {
    Widget::layout(bounds);

    const Insets& padding = getPadding();
    viewportSize_ = glm::vec2(
        bounds.width - padding.left - padding.right,
        bounds.height - padding.top - padding.bottom
    );

    if (showScrollbars_) {
        if (scrollDirection_ & ScrollDirection::Vertical) {
            viewportSize_.x -= scrollbarWidth_;
        }
        if (scrollDirection_ & ScrollDirection::Horizontal) {
            viewportSize_.y -= scrollbarWidth_;
        }
    }

    clampScrollOffset();
    updateContentLayout();
}

// =============================================================================
// Rendering
// =============================================================================

void ScrollView::render(UIBatchRenderer& renderer) {
    if (!content_) return;

    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    Rect viewportRect{
        bounds.x + padding.left,
        bounds.y + padding.top,
        viewportSize_.x,
        viewportSize_.y
    };

    renderer.pushClipRect(viewportRect);
    content_->renderTree(renderer);
    renderer.popClipRect();

    if (showScrollbars_) {
        if (canScrollVertically()) {
            renderVerticalScrollbar(renderer);
        }
        if (canScrollHorizontally()) {
            renderHorizontalScrollbar(renderer);
        }
    }
}

Widget* ScrollView::hitTest(f32 x, f32 y) {
    if (!containsPoint(x, y)) {
        return nullptr;
    }

    if (showScrollbars_) {
        if (canScrollVertically()) {
            Rect vScrollbarBounds = getVerticalScrollbarBounds();
            if (vScrollbarBounds.contains(x, y)) {
                return this;
            }
        }

        if (canScrollHorizontally()) {
            Rect hScrollbarBounds = getHorizontalScrollbarBounds();
            if (hScrollbarBounds.contains(x, y)) {
                return this;
            }
        }
    }

    if (content_) {
        Widget* hit = content_->hitTest(x, y);
        if (hit) {
            return hit;
        }
    }

    return this;
}

// =============================================================================
// Event Handling
// =============================================================================

bool ScrollView::onScroll(const ScrollEvent& event) {
    glm::vec2 delta{0.0f, 0.0f};

    if (scrollDirection_ & ScrollDirection::Vertical) {
        delta.y = -event.deltaY * scrollSpeed_;
    }

    if (scrollDirection_ & ScrollDirection::Horizontal) {
        delta.x = -event.deltaX * scrollSpeed_;
    }

    if (glm::length(delta) > 0.0f) {
        scrollBy(delta);
        return true;
    }

    return false;
}

bool ScrollView::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    if (showScrollbars_ && canScrollVertically()) {
        Rect thumbBounds = getVerticalScrollbarThumbBounds();
        if (thumbBounds.contains(event.x, event.y)) {
            draggingVerticalScrollbar_ = true;
            dragStartMousePos_ = glm::vec2(event.x, event.y);
            dragStartScrollOffset_ = scrollOffset_;
            return true;
        }
    }

    if (showScrollbars_ && canScrollHorizontally()) {
        Rect thumbBounds = getHorizontalScrollbarThumbBounds();
        if (thumbBounds.contains(event.x, event.y)) {
            draggingHorizontalScrollbar_ = true;
            dragStartMousePos_ = glm::vec2(event.x, event.y);
            dragStartScrollOffset_ = scrollOffset_;
            return true;
        }
    }

    return false;
}

bool ScrollView::onMouseUp(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    bool wasDragging = draggingVerticalScrollbar_ || draggingHorizontalScrollbar_;
    draggingVerticalScrollbar_ = false;
    draggingHorizontalScrollbar_ = false;

    return wasDragging;
}

bool ScrollView::onMouseMove(const MouseMoveEvent& event) {
    if (draggingVerticalScrollbar_) {
        f32 mouseDelta = event.y - dragStartMousePos_.y;
        f32 trackHeight = viewportSize_.y;
        f32 maxScroll = getMaxScrollOffset().y;

        if (trackHeight > 0.0f) {
            f32 scrollRatio = maxScroll / trackHeight;
            f32 scrollDelta = mouseDelta * scrollRatio;

            glm::vec2 newOffset = dragStartScrollOffset_;
            newOffset.y += scrollDelta;
            setScrollOffset(newOffset);
        }

        return true;
    }

    if (draggingHorizontalScrollbar_) {
        f32 mouseDelta = event.x - dragStartMousePos_.x;
        f32 trackWidth = viewportSize_.x;
        f32 maxScroll = getMaxScrollOffset().x;

        if (trackWidth > 0.0f) {
            f32 scrollRatio = maxScroll / trackWidth;
            f32 scrollDelta = mouseDelta * scrollRatio;

            glm::vec2 newOffset = dragStartScrollOffset_;
            newOffset.x += scrollDelta;
            setScrollOffset(newOffset);
        }

        return true;
    }

    return false;
}

// =============================================================================
// Private Methods
// =============================================================================

void ScrollView::clampScrollOffset() {
    glm::vec2 maxOffset = getMaxScrollOffset();
    scrollOffset_.x = glm::clamp(scrollOffset_.x, 0.0f, maxOffset.x);
    scrollOffset_.y = glm::clamp(scrollOffset_.y, 0.0f, maxOffset.y);
}

void ScrollView::updateContentLayout() {
    if (!content_) return;

    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    Rect contentBounds{
        bounds.x + padding.left - scrollOffset_.x,
        bounds.y + padding.top - scrollOffset_.y,
        contentSize_.x,
        contentSize_.y
    };

    content_->layout(contentBounds);
}

void ScrollView::renderVerticalScrollbar(UIBatchRenderer& renderer) {
    Rect trackBounds = getVerticalScrollbarBounds();
    Rect thumbBounds = getVerticalScrollbarThumbBounds();

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getScrollbarStyle();
    }

    glm::vec4 trackColor = style.getBackgroundColor(getState());
    glm::vec4 thumbColor = style.getForegroundColor(getState());

    renderer.drawRect(trackBounds, trackColor);
    renderer.drawRoundedRect(thumbBounds, thumbColor, CornerRadii::all(4.0f));
}

void ScrollView::renderHorizontalScrollbar(UIBatchRenderer& renderer) {
    Rect trackBounds = getHorizontalScrollbarBounds();
    Rect thumbBounds = getHorizontalScrollbarThumbBounds();

    WidgetStyle style;
    if (getContext()) {
        style = getContext()->getTheme().getScrollbarStyle();
    }

    glm::vec4 trackColor = style.getBackgroundColor(getState());
    glm::vec4 thumbColor = style.getForegroundColor(getState());

    renderer.drawRect(trackBounds, trackColor);
    renderer.drawRoundedRect(thumbBounds, thumbColor, CornerRadii::all(4.0f));
}

Rect ScrollView::getVerticalScrollbarBounds() const {
    const Rect& bounds = getBounds();
    return Rect{
        bounds.x + bounds.width - scrollbarWidth_,
        bounds.y,
        scrollbarWidth_,
        viewportSize_.y
    };
}

Rect ScrollView::getHorizontalScrollbarBounds() const {
    const Rect& bounds = getBounds();
    return Rect{
        bounds.x,
        bounds.y + bounds.height - scrollbarWidth_,
        viewportSize_.x,
        scrollbarWidth_
    };
}

Rect ScrollView::getVerticalScrollbarThumbBounds() const {
    Rect trackBounds = getVerticalScrollbarBounds();
    f32 maxScroll = getMaxScrollOffset().y;

    if (maxScroll <= 0.0f) {
        return trackBounds;
    }

    f32 visibleRatio = viewportSize_.y / contentSize_.y;
    f32 thumbHeight = glm::max(20.0f, trackBounds.height * visibleRatio);
    f32 scrollRatio = scrollOffset_.y / maxScroll;
    f32 thumbY = trackBounds.y + scrollRatio * (trackBounds.height - thumbHeight);

    return Rect{
        trackBounds.x + 2.0f,
        thumbY,
        scrollbarWidth_ - 4.0f,
        thumbHeight
    };
}

Rect ScrollView::getHorizontalScrollbarThumbBounds() const {
    Rect trackBounds = getHorizontalScrollbarBounds();
    f32 maxScroll = getMaxScrollOffset().x;

    if (maxScroll <= 0.0f) {
        return trackBounds;
    }

    f32 visibleRatio = viewportSize_.x / contentSize_.x;
    f32 thumbWidth = glm::max(20.0f, trackBounds.width * visibleRatio);
    f32 scrollRatio = scrollOffset_.x / maxScroll;
    f32 thumbX = trackBounds.x + scrollRatio * (trackBounds.width - thumbWidth);

    return Rect{
        thumbX,
        trackBounds.y + 2.0f,
        thumbWidth,
        scrollbarWidth_ - 4.0f
    };
}

bool ScrollView::canScrollVertically() const {
    return (scrollDirection_ & ScrollDirection::Vertical) &&
           contentSize_.y > viewportSize_.y;
}

bool ScrollView::canScrollHorizontally() const {
    return (scrollDirection_ & ScrollDirection::Horizontal) &&
           contentSize_.x > viewportSize_.x;
}

}  // namespace esengine::ui
