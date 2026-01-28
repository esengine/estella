/**
 * @file    FloatEditor.cpp
 * @brief   FloatEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "FloatEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

#include <sstream>
#include <iomanip>

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

FloatEditor::FloatEditor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto labelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        labelWidget->setText(label_);
        labelWidget->setFontSize(12.0f);
        labelWidget_ = labelWidget.get();
        addChild(std::move(labelWidget));
    }

    auto textField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_text"));
    textField->setWidth(ui::SizeValue::px(TEXTFIELD_WIDTH));
    textField_ = textField.get();
    addChild(std::move(textField));

    connections_.add(sink(textField_->onTextChanged).connect(
        [this](const std::string& text) { onTextChanged(text); }
    ));

    updateTextFromValue();
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void FloatEditor::setValue(const std::any& value) {
    try {
        f32 newValue = std::any_cast<f32>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;
        updateTextFromValue();
        updateSliderFromValue();
    } catch (const std::bad_any_cast&) {
    }
}

std::any FloatEditor::getValue() const {
    return value_;
}

// =============================================================================
// Range Configuration
// =============================================================================

void FloatEditor::setRange(f32 min, f32 max) {
    min_ = min;
    max_ = max;

    if (slider_) {
        slider_->setRange(min_, max_);
    }
}

void FloatEditor::setStep(f32 step) {
    step_ = step;

    if (slider_) {
        slider_->setStep(step_);
    }
}

// =============================================================================
// Display Options
// =============================================================================

void FloatEditor::setShowSlider(bool show) {
    if (showSlider_ == show) {
        return;
    }

    showSlider_ = show;

    if (showSlider_ && !slider_) {
        auto sliderWidget = makeUnique<ui::Slider>(
            ui::WidgetId(getId().path + "_slider"),
            ui::SliderOrientation::Horizontal
        );
        sliderWidget->setRange(min_, max_);
        sliderWidget->setStep(step_);
        slider_ = sliderWidget.get();
        addChild(std::move(sliderWidget));

        connections_.add(sink(slider_->onValueChanged).connect(
            [this](f32 value) { onSliderChanged(value); }
        ));

        updateSliderFromValue();
    } else if (!showSlider_ && slider_) {
        removeChild(slider_);
        slider_ = nullptr;
    }

    invalidateLayout();
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 FloatEditor::measure(f32 availableWidth, f32 availableHeight) {
    f32 width = 0.0f;
    f32 height = 20.0f;

    if (labelWidget_ && showLabel_) {
        width += LABEL_WIDTH + SPACING;
    }

    width += TEXTFIELD_WIDTH;

    if (slider_ && showSlider_) {
        width += SPACING;
        f32 sliderWidth = availableWidth - width;
        if (sliderWidth > 100.0f) {
            width += sliderWidth;
        }
    }

    const ui::SizeConstraints& constraints = getConstraints();
    width = glm::clamp(width, constraints.minWidth, constraints.maxWidth);
    height = glm::clamp(height, constraints.minHeight, constraints.maxHeight);

    return glm::vec2(width, height);
}

void FloatEditor::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();
    f32 x = bounds.x;
    f32 remainingWidth = bounds.width;

    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};

    if (labelWidget_ && showLabel_) {
        labelWidget_->setColor(labelColor);
        ui::Rect labelBounds{x, bounds.y, LABEL_WIDTH, bounds.height};
        labelWidget_->layout(labelBounds);
        labelWidget_->renderTree(renderer);
        x += LABEL_WIDTH + SPACING;
        remainingWidth -= LABEL_WIDTH + SPACING;
    }

    if (textField_) {
        f32 textFieldWidth = remainingWidth;
        if (slider_ && showSlider_) {
            textFieldWidth = TEXTFIELD_WIDTH;
        }
        ui::Rect textBounds{x, bounds.y, textFieldWidth, bounds.height};
        textField_->layout(textBounds);
        textField_->renderTree(renderer);
        x += textFieldWidth;
    }

    if (slider_ && showSlider_) {
        x += SPACING;
        f32 sliderWidth = bounds.x + bounds.width - x;
        ui::Rect sliderBounds{x, bounds.y, sliderWidth, bounds.height};
        slider_->layout(sliderBounds);
        slider_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> FloatEditor::createCommand(const std::any& oldValue,
                                           const std::any& newValue) {
    try {
        f32 oldFloat = std::any_cast<f32>(oldValue);
        f32 newFloat = std::any_cast<f32>(newValue);

        return makeUnique<LambdaCommand>(
            "Modify " + propertyName_,
            [this, newFloat]() {
                setValue(newFloat);
                return CommandResult::Success;
            },
            [this, oldFloat]() {
                setValue(oldFloat);
            }
        );
    } catch (const std::bad_any_cast&) {
        return nullptr;
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void FloatEditor::onTextChanged(const std::string& text) {
    if (updatingFromSlider_) {
        return;
    }

    updatingFromText_ = true;

    try {
        f32 oldValue = value_;
        f32 newValue = std::stof(text);

        if (oldValue != newValue) {
            value_ = newValue;
            updateSliderFromValue();
            notifyValueChanged(oldValue, newValue);
        }
    } catch (const std::invalid_argument&) {
    } catch (const std::out_of_range&) {
    }

    updatingFromText_ = false;
}

void FloatEditor::onSliderChanged(f32 value) {
    if (updatingFromText_) {
        return;
    }

    updatingFromSlider_ = true;

    f32 oldValue = value_;
    if (oldValue != value) {
        value_ = value;
        updateTextFromValue();
        notifyValueChanged(oldValue, value);
    }

    updatingFromSlider_ = false;
}

void FloatEditor::updateTextFromValue() {
    if (updatingFromText_ || !textField_) {
        return;
    }

    std::ostringstream oss;
    oss << std::fixed << std::setprecision(2) << value_;
    textField_->setText(oss.str());
}

void FloatEditor::updateSliderFromValue() {
    if (updatingFromSlider_ || !slider_) {
        return;
    }

    slider_->setValue(value_);
}

}  // namespace esengine::editor
