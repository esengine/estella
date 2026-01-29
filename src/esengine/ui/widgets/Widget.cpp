/**
 * @file    Widget.cpp
 * @brief   Widget base class implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Widget.hpp"
#include "../layout/Layout.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../UIContext.hpp"

namespace esengine::ui {

// =============================================================================
// Constructor / Destructor
// =============================================================================

Widget::Widget(const WidgetId& id) : id_(id), name_(id.name()) {}

Widget::~Widget() = default;

// =============================================================================
// Hierarchy
// =============================================================================

Widget* Widget::getChild(usize index) const {
    if (index >= children_.size()) {
        return nullptr;
    }
    return children_[index].get();
}

Widget* Widget::findChild(const WidgetId& id) const {
    for (const auto& child : children_) {
        if (child->getId() == id) {
            return child.get();
        }
        if (auto* found = child->findChild(id)) {
            return found;
        }
    }
    return nullptr;
}

void Widget::addChild(Unique<Widget> child) {
    if (!child) return;

    child->parent_ = this;
    child->setContext(context_);
    children_.push_back(std::move(child));
    invalidateLayout();
}

Unique<Widget> Widget::removeChild(Widget* child) {
    for (auto it = children_.begin(); it != children_.end(); ++it) {
        if (it->get() == child) {
            auto removed = std::move(*it);
            children_.erase(it);
            removed->parent_ = nullptr;
            removed->setContext(nullptr);
            invalidateLayout();
            return removed;
        }
    }
    return nullptr;
}

void Widget::clearChildren() {
    for (auto& child : children_) {
        child->parent_ = nullptr;
        child->setContext(nullptr);
    }
    children_.clear();
    invalidateLayout();
}

// =============================================================================
// Layout
// =============================================================================

void Widget::setLayout(Unique<Layout> layout) {
    layout_ = std::move(layout);
    invalidateLayout();
}

void Widget::setSize(const SizeValue& width, const SizeValue& height) {
    width_ = width;
    height_ = height;
    invalidateLayout();
}

void Widget::setMinSize(f32 minWidth, f32 minHeight) {
    constraints_.minWidth = minWidth;
    constraints_.minHeight = minHeight;
    invalidateLayout();
}

void Widget::setMaxSize(f32 maxWidth, f32 maxHeight) {
    constraints_.maxWidth = maxWidth;
    constraints_.maxHeight = maxHeight;
    invalidateLayout();
}

glm::vec2 Widget::measure(f32 availableWidth, f32 availableHeight) {
    f32 contentWidth = 0.0f;
    f32 contentHeight = 0.0f;

    if (layout_) {
        auto size = layout_->measure(*this, availableWidth, availableHeight);
        contentWidth = size.x;
        contentHeight = size.y;
    } else {
        for (const auto& child : children_) {
            auto childSize = child->measure(availableWidth, availableHeight);
            contentWidth = (childSize.x > contentWidth) ? childSize.x : contentWidth;
            contentHeight = (childSize.y > contentHeight) ? childSize.y : contentHeight;
        }
    }

    contentWidth += padding_.totalHorizontal();
    contentHeight += padding_.totalVertical();

    f32 width = width_.resolve(availableWidth, contentWidth);
    f32 height = height_.resolve(availableHeight, contentHeight);

    width = constraints_.constrainWidth(width);
    height = constraints_.constrainHeight(height);

    return {width, height};
}

void Widget::layout(const Rect& bounds) {
    bounds_ = bounds;
    layoutDirty_ = false;

    if (layout_) {
        layout_->layout(*this, getContentBounds());
    } else {
        Rect content = getContentBounds();
        for (auto& child : children_) {
            auto childSize = child->measure(content.width, content.height);
            Rect childBounds(content.x, content.y, childSize.x, childSize.y);
            child->layout(childBounds);
        }
    }
}

Rect Widget::getContentBounds() const {
    return padding_.shrink(bounds_);
}

void Widget::invalidateLayout() {
    layoutDirty_ = true;
    if (parent_) {
        parent_->invalidateLayout();
    }
}

// =============================================================================
// State
// =============================================================================

void Widget::setVisible(bool visible) {
    if (state_.visible != visible) {
        state_.visible = visible;
        onStateChanged();
        invalidateLayout();
    }
}

void Widget::setEnabled(bool enabled) {
    bool disabled = !enabled;
    if (state_.disabled != disabled) {
        state_.disabled = disabled;
        if (disabled) {
            state_.hovered = false;
            state_.pressed = false;
        }
        onStateChanged();
    }
}

void Widget::setState(bool hovered, bool pressed) {
    if (state_.hovered != hovered || state_.pressed != pressed) {
        state_.hovered = hovered;
        state_.pressed = pressed;
        onStateChanged();
    }
}

void Widget::setFocused(bool focused) {
    if (state_.focused != focused) {
        state_.focused = focused;
        onStateChanged();
    }
}

// =============================================================================
// Rendering
// =============================================================================

void Widget::render(UIBatchRenderer& renderer) {
    (void)renderer;
}

void Widget::renderTree(UIBatchRenderer& renderer) {
    if (!state_.visible) return;

    render(renderer);

    for (auto& child : children_) {
        child->renderTree(renderer);
    }
}

// =============================================================================
// Hit Testing
// =============================================================================

Widget* Widget::hitTest(f32 x, f32 y) {
    if (!state_.visible || state_.disabled) {
        return nullptr;
    }

    if (!containsPoint(x, y)) {
        return nullptr;
    }

    for (auto it = children_.rbegin(); it != children_.rend(); ++it) {
        if (auto* hit = (*it)->hitTest(x, y)) {
            return hit;
        }
    }

    return this;
}

bool Widget::containsPoint(f32 x, f32 y) const {
    return bounds_.contains(x, y);
}

// =============================================================================
// Context
// =============================================================================

void Widget::setContext(UIContext* context) {
    if (context_ && context_ != context) {
        context_->clearWidgetReferences(this);
    }
    context_ = context;
    for (auto& child : children_) {
        child->setContext(context);
    }
}

}  // namespace esengine::ui
