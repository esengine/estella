/**
 * @file    StringEditor.cpp
 * @brief   StringEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "StringEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

StringEditor::StringEditor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto labelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        labelWidget->setText(label_);
        labelWidget->setFontSize(12.0f);
        labelWidget_ = labelWidget.get();
        addChild(std::move(labelWidget));
    }

    auto textField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + "_text"));
    textField_ = textField.get();
    addChild(std::move(textField));

    connections_.add(sink(textField_->onTextChanged).connect(
        [this](const std::string& text) { onTextChanged(text); }
    ));

    connections_.add(sink(textField_->onSubmit).connect(
        [this](const std::string& text) { onTextSubmit(text); }
    ));
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void StringEditor::setValue(const std::any& value) {
    try {
        std::string newValue = std::any_cast<std::string>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;
        pendingValue_ = newValue;
        hasUncommittedChanges_ = false;

        updatingFromValue_ = true;
        if (textField_) {
            textField_->setText(value_);
        }
        updatingFromValue_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any StringEditor::getValue() const {
    return value_;
}

void StringEditor::setPlaceholder(const std::string& placeholder) {
    if (textField_) {
        textField_->setPlaceholder(placeholder);
    }
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 StringEditor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = 20.0f;

    if (labelWidget_ && showLabel_) {
        width += LABEL_WIDTH + SPACING;
    }

    f32 textFieldWidth = availableWidth - width;
    if (textFieldWidth < 80.0f) {
        textFieldWidth = 80.0f;
    }
    width += textFieldWidth;

    return glm::vec2(width, height);
}

void StringEditor::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();
    f32 x = bounds.x;

    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};

    if (labelWidget_ && showLabel_) {
        labelWidget_->setColor(labelColor);
        ui::Rect labelBounds{x, bounds.y, LABEL_WIDTH, bounds.height};
        labelWidget_->layout(labelBounds);
        labelWidget_->renderTree(renderer);
        x += LABEL_WIDTH + SPACING;
    }

    if (textField_) {
        f32 textFieldWidth = bounds.x + bounds.width - x;
        ui::Rect textBounds{x, bounds.y, textFieldWidth, bounds.height};
        textField_->layout(textBounds);
        textField_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> StringEditor::createCommand(const std::any& oldValue,
                                            const std::any& newValue) {
    try {
        std::string oldStr = std::any_cast<std::string>(oldValue);
        std::string newStr = std::any_cast<std::string>(newValue);

        return makeUnique<LambdaCommand>(
            "Modify " + propertyName_,
            [this, newStr]() {
                setValue(newStr);
                return CommandResult::Success;
            },
            [this, oldStr]() {
                setValue(oldStr);
            }
        );
    } catch (const std::bad_any_cast&) {
        return nullptr;
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void StringEditor::onTextChanged(const std::string& text) {
    if (updatingFromValue_) {
        return;
    }

    pendingValue_ = text;
    hasUncommittedChanges_ = (pendingValue_ != value_);
}

void StringEditor::onTextSubmit(const std::string& text) {
    if (updatingFromValue_) {
        return;
    }

    if (value_ != text) {
        std::string oldValue = value_;
        value_ = text;
        pendingValue_ = text;
        hasUncommittedChanges_ = false;
        notifyValueChanged(oldValue, value_);
    }
}

}  // namespace esengine::editor
