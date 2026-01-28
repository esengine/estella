/**
 * @file    BoolEditor.cpp
 * @brief   BoolEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "BoolEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

BoolEditor::BoolEditor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto labelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        labelWidget->setText(label_);
        labelWidget->setFontSize(12.0f);
        labelWidget_ = labelWidget.get();
        addChild(std::move(labelWidget));
    }

    auto checkboxWidget = makeUnique<ui::Checkbox>(ui::WidgetId(getId().path + "_checkbox"));
    checkboxWidget->setCheckboxSize(CHECKBOX_SIZE);
    checkbox_ = checkboxWidget.get();
    addChild(std::move(checkboxWidget));

    connections_.add(sink(checkbox_->onChanged).connect(
        [this](bool checked) { onCheckboxChanged(checked); }
    ));
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void BoolEditor::setValue(const std::any& value) {
    try {
        bool newValue = std::any_cast<bool>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;

        updatingFromValue_ = true;
        if (checkbox_) {
            checkbox_->setChecked(value_);
        }
        updatingFromValue_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any BoolEditor::getValue() const {
    return value_;
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 BoolEditor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = 20.0f;

    if (labelWidget_ && showLabel_) {
        width += LABEL_WIDTH + SPACING;
    }

    width += CHECKBOX_SIZE;

    return glm::vec2(width, height);
}

void BoolEditor::render(ui::UIBatchRenderer& renderer) {
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

    if (checkbox_) {
        f32 checkboxY = bounds.y + (bounds.height - CHECKBOX_SIZE) * 0.5f;
        ui::Rect checkboxBounds{x, checkboxY, CHECKBOX_SIZE, CHECKBOX_SIZE};
        checkbox_->layout(checkboxBounds);
        checkbox_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> BoolEditor::createCommand(const std::any& oldValue,
                                          const std::any& newValue) {
    try {
        bool oldBool = std::any_cast<bool>(oldValue);
        bool newBool = std::any_cast<bool>(newValue);

        return makeUnique<LambdaCommand>(
            "Modify " + propertyName_,
            [this, newBool]() {
                setValue(newBool);
                return CommandResult::Success;
            },
            [this, oldBool]() {
                setValue(oldBool);
            }
        );
    } catch (const std::bad_any_cast&) {
        return nullptr;
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void BoolEditor::onCheckboxChanged(bool checked) {
    if (updatingFromValue_) {
        return;
    }

    bool oldValue = value_;
    if (oldValue != checked) {
        value_ = checked;
        notifyValueChanged(oldValue, checked);
    }
}

}  // namespace esengine::editor
