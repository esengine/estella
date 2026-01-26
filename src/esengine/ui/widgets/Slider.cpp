/**
 * @file    Slider.cpp
 * @brief   Slider widget implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Slider.hpp"
#include "../UIContext.hpp"
#include "../rendering/UIBatchRenderer.hpp"
#include "../../math/Math.hpp"

#include <cmath>

namespace esengine::ui {

// =============================================================================
// Constructor
// =============================================================================

Slider::Slider(const WidgetId& id, SliderOrientation orientation)
    : Widget(id), orientation_(orientation) {}

// =============================================================================
// Value Management
// =============================================================================

void Slider::setValue(f32 value) {
    f32 clampedValue = glm::clamp(value, min_, max_);
    clampedValue = quantizeValue(clampedValue);

    if (value_ == clampedValue) {
        return;
    }

    value_ = clampedValue;
    onValueChanged.publish(value_);
}

void Slider::setRange(f32 min, f32 max) {
    min_ = min;
    max_ = max;

    if (max_ < min_) {
        std::swap(min_, max_);
    }

    setValue(value_);
}

void Slider::setStep(f32 step) {
    step_ = glm::max(0.0f, step);
    setValue(value_);
}

// =============================================================================
// Orientation
// =============================================================================

void Slider::setOrientation(SliderOrientation orientation) {
    if (orientation_ == orientation) {
        return;
    }

    orientation_ = orientation;
    invalidateLayout();
}

// =============================================================================
// Appearance
// =============================================================================

void Slider::setTrackThickness(f32 thickness) {
    if (trackThickness_ == thickness) {
        return;
    }

    trackThickness_ = thickness;
    invalidateLayout();
}

void Slider::setThumbSize(f32 size) {
    if (thumbSize_ == size) {
        return;
    }

    thumbSize_ = size;
    invalidateLayout();
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 Slider::measure(f32 availableWidth, f32 availableHeight) {
    f32 width = 0.0f;
    f32 height = 0.0f;

    if (orientation_ == SliderOrientation::Horizontal) {
        width = availableWidth;
        height = thumbSize_;
    } else {
        width = thumbSize_;
        height = availableHeight;
    }

    const SizeConstraints& constraints = getConstraints();
    width = glm::clamp(width, constraints.minWidth, constraints.maxWidth);
    height = glm::clamp(height, constraints.minHeight, constraints.maxHeight);

    return glm::vec2(width, height);
}

void Slider::render(UIBatchRenderer& renderer) {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    WidgetStyle trackStyle;
    WidgetStyle thumbStyle;
    if (getContext()) {
        trackStyle = getContext()->getTheme().getSliderTrackStyle();
        thumbStyle = getContext()->getTheme().getSliderThumbStyle();
    }

    WidgetState state{
        .hovered = isHovered(),
        .pressed = isPressed(),
        .focused = false,
        .disabled = !isEnabled(),
        .visible = true
    };

    f32 normalizedValue = getNormalizedValue();

    if (orientation_ == SliderOrientation::Horizontal) {
        f32 trackWidth = bounds.width - padding.left - padding.right - thumbSize_;
        f32 trackHeight = trackThickness_;
        f32 trackX = bounds.x + padding.left + thumbSize_ * 0.5f;
        f32 trackY = bounds.y + (bounds.height - trackHeight) * 0.5f;

        Rect trackBounds{trackX, trackY, trackWidth, trackHeight};
        glm::vec4 trackColor = trackStyle.getBackgroundColor(state);
        renderer.drawRoundedRect(trackBounds, trackColor, trackStyle.cornerRadii);

        f32 thumbX = trackX + normalizedValue * trackWidth - thumbSize_ * 0.5f;
        f32 thumbY = bounds.y + (bounds.height - thumbSize_) * 0.5f;

        Rect thumbBounds{thumbX, thumbY, thumbSize_, thumbSize_};
        glm::vec4 thumbColor = thumbStyle.getBackgroundColor(state);
        renderer.drawRoundedRect(thumbBounds, thumbColor, thumbStyle.cornerRadii);
    } else {
        f32 trackWidth = trackThickness_;
        f32 trackHeight = bounds.height - padding.top - padding.bottom - thumbSize_;
        f32 trackX = bounds.x + (bounds.width - trackWidth) * 0.5f;
        f32 trackY = bounds.y + padding.top + thumbSize_ * 0.5f;

        Rect trackBounds{trackX, trackY, trackWidth, trackHeight};
        glm::vec4 trackColor = trackStyle.getBackgroundColor(state);
        renderer.drawRoundedRect(trackBounds, trackColor, trackStyle.cornerRadii);

        f32 thumbX = bounds.x + (bounds.width - thumbSize_) * 0.5f;
        f32 thumbY = trackY + (1.0f - normalizedValue) * trackHeight - thumbSize_ * 0.5f;

        Rect thumbBounds{thumbX, thumbY, thumbSize_, thumbSize_};
        glm::vec4 thumbColor = thumbStyle.getBackgroundColor(state);
        renderer.drawRoundedRect(thumbBounds, thumbColor, thumbStyle.cornerRadii);
    }
}

bool Slider::onMouseDown(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    const Rect& bounds = getBounds();
    if (!bounds.contains(event.x, event.y)) {
        return false;
    }

    dragging_ = true;
    updateValueFromPosition(event.x, event.y);

    return true;
}

bool Slider::onMouseMove(const MouseMoveEvent& event) {
    if (!dragging_) {
        return false;
    }

    updateValueFromPosition(event.x, event.y);
    return true;
}

bool Slider::onMouseUp(const MouseButtonEvent& event) {
    if (event.button != MouseButton::Left) {
        return false;
    }

    dragging_ = false;
    return true;
}

// =============================================================================
// Private Methods
// =============================================================================

void Slider::updateValueFromPosition(f32 x, f32 y) {
    const Rect& bounds = getBounds();
    const Insets& padding = getPadding();

    f32 normalizedValue = 0.0f;

    if (orientation_ == SliderOrientation::Horizontal) {
        f32 trackWidth = bounds.width - padding.left - padding.right - thumbSize_;
        f32 trackX = bounds.x + padding.left + thumbSize_ * 0.5f;

        f32 relativeX = x - trackX;
        normalizedValue = glm::clamp(relativeX / trackWidth, 0.0f, 1.0f);
    } else {
        f32 trackHeight = bounds.height - padding.top - padding.bottom - thumbSize_;
        f32 trackY = bounds.y + padding.top + thumbSize_ * 0.5f;

        f32 relativeY = y - trackY;
        normalizedValue = 1.0f - glm::clamp(relativeY / trackHeight, 0.0f, 1.0f);
    }

    f32 newValue = min_ + normalizedValue * (max_ - min_);
    setValue(newValue);
}

f32 Slider::quantizeValue(f32 value) const {
    if (step_ <= 0.0f) {
        return value;
    }

    f32 steps = std::round((value - min_) / step_);
    return min_ + steps * step_;
}

f32 Slider::getNormalizedValue() const {
    if (max_ <= min_) {
        return 0.0f;
    }

    return (value_ - min_) / (max_ - min_);
}

}  // namespace esengine::ui
