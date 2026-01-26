/**
 * @file    Slider.hpp
 * @brief   Slider widget for numeric input
 * @details Provides a draggable slider for selecting values within a range.
 *          Supports both horizontal and vertical orientations with optional
 *          step quantization.
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
#include "../../events/Signal.hpp"

namespace esengine::ui {

// =============================================================================
// Slider Orientation
// =============================================================================

/**
 * @brief Slider orientation
 */
enum class SliderOrientation : u8 {
    Horizontal,
    Vertical
};

// =============================================================================
// Slider Class
// =============================================================================

/**
 * @brief Slider widget for numeric value selection
 *
 * @details Renders a track with a draggable thumb. Clicking the track
 *          jumps the value to that position. Dragging adjusts continuously.
 *
 * @code
 * auto slider = makeUnique<Slider>(WidgetId("volume"));
 * slider->setRange(0.0f, 1.0f);
 * slider->setValue(0.5f);
 * slider->onValueChanged.connect([](f32 value) {
 *     ES_LOG_INFO("Volume: {}", value);
 * });
 * @endcode
 */
class Slider : public Widget {
public:
    /**
     * @brief Constructs a slider widget
     * @param id Unique widget identifier
     * @param orientation Slider orientation (default horizontal)
     */
    explicit Slider(const WidgetId& id, SliderOrientation orientation = SliderOrientation::Horizontal);

    ~Slider() override = default;

    // =========================================================================
    // Value Management
    // =========================================================================

    /**
     * @brief Sets the current value
     * @param value New value (clamped to range)
     */
    void setValue(f32 value);

    /**
     * @brief Gets the current value
     * @return Current value
     */
    f32 getValue() const { return value_; }

    /**
     * @brief Sets the value range
     * @param min Minimum value
     * @param max Maximum value
     */
    void setRange(f32 min, f32 max);

    /**
     * @brief Gets the minimum value
     * @return Minimum value
     */
    f32 getMin() const { return min_; }

    /**
     * @brief Gets the maximum value
     * @return Maximum value
     */
    f32 getMax() const { return max_; }

    /**
     * @brief Sets the step size for quantization
     * @param step Step size (0 for continuous)
     */
    void setStep(f32 step);

    /**
     * @brief Gets the step size
     * @return Step size
     */
    f32 getStep() const { return step_; }

    // =========================================================================
    // Orientation
    // =========================================================================

    /**
     * @brief Sets the slider orientation
     * @param orientation Horizontal or Vertical
     */
    void setOrientation(SliderOrientation orientation);

    /**
     * @brief Gets the slider orientation
     * @return Current orientation
     */
    SliderOrientation getOrientation() const { return orientation_; }

    // =========================================================================
    // Appearance
    // =========================================================================

    /**
     * @brief Sets the track thickness
     * @param thickness Track thickness in pixels (default 4.0f)
     */
    void setTrackThickness(f32 thickness);

    /**
     * @brief Gets the track thickness
     * @return Track thickness in pixels
     */
    f32 getTrackThickness() const { return trackThickness_; }

    /**
     * @brief Sets the thumb size
     * @param size Thumb diameter in pixels (default 16.0f)
     */
    void setThumbSize(f32 size);

    /**
     * @brief Gets the thumb size
     * @return Thumb diameter in pixels
     */
    f32 getThumbSize() const { return thumbSize_; }

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(class UIBatchRenderer& renderer) override;

    bool onMouseDown(const MouseButtonEvent& event) override;
    bool onMouseMove(const MouseMoveEvent& event) override;
    bool onMouseUp(const MouseButtonEvent& event) override;

    // =========================================================================
    // Signals
    // =========================================================================

    /**
     * @brief Emitted when the value changes
     * @param value New value
     */
    Signal<void(f32)> onValueChanged;

private:
    /**
     * @brief Updates value from mouse position
     * @param x Mouse X coordinate
     * @param y Mouse Y coordinate
     */
    void updateValueFromPosition(f32 x, f32 y);

    /**
     * @brief Quantizes value to step size
     * @param value Raw value
     * @return Quantized value
     */
    f32 quantizeValue(f32 value) const;

    /**
     * @brief Gets the normalized value (0-1)
     * @return Normalized value
     */
    f32 getNormalizedValue() const;

    f32 value_ = 0.0f;
    f32 min_ = 0.0f;
    f32 max_ = 1.0f;
    f32 step_ = 0.0f;

    SliderOrientation orientation_ = SliderOrientation::Horizontal;
    f32 trackThickness_ = 4.0f;
    f32 thumbSize_ = 16.0f;

    bool dragging_ = false;
};

}  // namespace esengine::ui
