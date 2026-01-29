/**
 * @file    FloatEditor.hpp
 * @brief   Property editor for floating-point values
 * @details Combines a TextField for precise input with an optional Slider
 *          for visual adjustment.
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

#include "../PropertyEditor.hpp"
#include "../../../ui/widgets/TextField.hpp"
#include "../../../ui/widgets/Slider.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

namespace esengine::editor {

// =============================================================================
// FloatEditor Class
// =============================================================================

/**
 * @brief Property editor for f32 values
 *
 * @details Renders a label (optional), text field, and optional slider.
 *          Creates PropertyCommand<f32> for undo/redo support.
 *
 * @code
 * auto editor = makeUnique<FloatEditor>(WidgetId("speed"), "Speed");
 * editor->setValue(5.0f);
 * editor->setRange(0.0f, 100.0f);
 * editor->setShowSlider(true);
 * editor->onValueChanged.connect([](const std::any& value) {
 *     f32 speed = std::any_cast<f32>(value);
 *     ES_LOG_INFO("Speed: {}", speed);
 * });
 * @endcode
 */
class FloatEditor : public PropertyEditor {
public:
    /**
     * @brief Constructs a float editor
     * @param id Unique widget identifier
     * @param propertyName Name of the property being edited
     */
    explicit FloatEditor(const ui::WidgetId& id, const std::string& propertyName);

    ~FloatEditor() override = default;

    // =========================================================================
    // PropertyEditor Interface
    // =========================================================================

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    // =========================================================================
    // Range Configuration
    // =========================================================================

    /**
     * @brief Sets the value range for the slider
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
     * @brief Sets the step size for the slider
     * @param step Step size
     */
    void setStep(f32 step);

    /**
     * @brief Gets the step size
     * @return Step size
     */
    f32 getStep() const { return step_; }

    // =========================================================================
    // Display Options
    // =========================================================================

    /**
     * @brief Sets whether to show the slider
     * @param show True to show slider
     */
    void setShowSlider(bool show);

    /**
     * @brief Gets whether the slider is shown
     * @return True if slider is shown
     */
    bool getShowSlider() const { return showSlider_; }

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onTextChanged(const std::string& text);
    void onSliderChanged(f32 value);

    void updateTextFromValue();
    void updateSliderFromValue();

    f32 value_ = 0.0f;
    f32 min_ = 0.0f;
    f32 max_ = 100.0f;
    f32 step_ = 1.0f;

    bool showSlider_ = false;
    bool updatingFromText_ = false;
    bool updatingFromSlider_ = false;

    ui::Label* labelWidget_ = nullptr;
    ui::TextField* textField_ = nullptr;
    ui::Slider* slider_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 LABEL_WIDTH = 60.0f;
    static constexpr f32 TEXTFIELD_WIDTH = 80.0f;
    static constexpr f32 SPACING = 8.0f;
};

}  // namespace esengine::editor
