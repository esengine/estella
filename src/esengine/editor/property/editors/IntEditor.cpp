/**
 * @file    IntEditor.cpp
 * @brief   IntEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "IntEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

#include <sstream>

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

IntEditor::IntEditor(const ui::WidgetId& id, const std::string& propertyName)
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

void IntEditor::setValue(const std::any& value) {
    try {
        i32 newValue = std::any_cast<i32>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;
        updateTextFromValue();
        updateSliderFromValue();
    } catch (const std::bad_any_cast&) {
    }
}

std::any IntEditor::getValue() const {
    return value_;
}

// =============================================================================
// Range Configuration
// =============================================================================

void IntEditor::setRange(i32 min, i32 max) {
    min_ = min;
    max_ = max;

    if (slider_) {
        slider_->setRange(static_cast<f32>(min_), static_cast<f32>(max_));
    }
}

void IntEditor::setShowSlider(bool show) {
    if (showSlider_ == show) {
        return;
    }

    showSlider_ = show;

    if (showSlider_ && !slider_) {
        auto sliderWidget = makeUnique<ui::Slider>(
            ui::WidgetId(getId().path + "_slider"),
            ui::SliderOrientation::Horizontal
        );
        sliderWidget->setRange(static_cast<f32>(min_), static_cast<f32>(max_));
        sliderWidget->setStep(1.0f);
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

glm::vec2 IntEditor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = 20.0f;

    if (labelWidget_ && showLabel_) {
        width += LABEL_WIDTH + SPACING;
    }

    width += TEXTFIELD_WIDTH;

    if (slider_ && showSlider_) {
        width += SPACING;
        f32 sliderWidth = availableWidth - width;
        if (sliderWidth > 60.0f) {
            width += sliderWidth;
        }
    }

    return glm::vec2(width, height);
}

void IntEditor::render(ui::UIBatchRenderer& renderer) {
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

Unique<Command> IntEditor::createCommand(const std::any& oldValue,
                                         const std::any& newValue) {
    try {
        i32 oldInt = std::any_cast<i32>(oldValue);
        i32 newInt = std::any_cast<i32>(newValue);

        return makeUnique<LambdaCommand>(
            "Modify " + propertyName_,
            [this, newInt]() {
                setValue(newInt);
                return CommandResult::Success;
            },
            [this, oldInt]() {
                setValue(oldInt);
            }
        );
    } catch (const std::bad_any_cast&) {
        return nullptr;
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void IntEditor::onTextChanged(const std::string& text) {
    if (updatingFromSlider_) {
        return;
    }

    updatingFromText_ = true;

    try {
        i32 oldValue = value_;
        i32 newValue = std::stoi(text);

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

void IntEditor::onSliderChanged(f32 value) {
    if (updatingFromText_) {
        return;
    }

    updatingFromSlider_ = true;

    i32 oldValue = value_;
    i32 newValue = static_cast<i32>(value);
    if (oldValue != newValue) {
        value_ = newValue;
        updateTextFromValue();
        notifyValueChanged(oldValue, newValue);
    }

    updatingFromSlider_ = false;
}

void IntEditor::updateTextFromValue() {
    if (updatingFromText_ || !textField_) {
        return;
    }

    textField_->setText(std::to_string(value_));
}

void IntEditor::updateSliderFromValue() {
    if (updatingFromSlider_ || !slider_) {
        return;
    }

    slider_->setValue(static_cast<f32>(value_));
}

}  // namespace esengine::editor
