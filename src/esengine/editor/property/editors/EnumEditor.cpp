/**
 * @file    EnumEditor.cpp
 * @brief   EnumEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "EnumEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

EnumEditor::EnumEditor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto labelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        labelWidget->setText(label_);
        labelWidget->setFontSize(12.0f);
        labelWidget_ = labelWidget.get();
        addChild(std::move(labelWidget));
    }

    auto dropdownWidget = makeUnique<ui::Dropdown>(ui::WidgetId(getId().path + "_dropdown"));
    dropdownWidget->setFontSize(12.0f);
    dropdown_ = dropdownWidget.get();
    addChild(std::move(dropdownWidget));

    connections_.add(sink(dropdown_->onSelectionChanged).connect(
        [this](i32 value) { onDropdownChanged(value); }
    ));
}

// =============================================================================
// Options
// =============================================================================

void EnumEditor::addOption(const EnumOption& option) {
    options_.push_back(option);
    rebuildDropdown();
}

void EnumEditor::addOptions(const std::vector<EnumOption>& options) {
    options_.insert(options_.end(), options.begin(), options.end());
    rebuildDropdown();
}

void EnumEditor::clearOptions() {
    options_.clear();
    rebuildDropdown();
}

void EnumEditor::rebuildDropdown() {
    if (!dropdown_) return;

    dropdown_->clearItems();
    for (const auto& opt : options_) {
        dropdown_->addItem(ui::DropdownItem::create(opt.value, opt.label));
    }
    dropdown_->setSelectedValue(value_);
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void EnumEditor::setValue(const std::any& value) {
    try {
        i32 newValue = std::any_cast<i32>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;

        updatingFromExternal_ = true;
        if (dropdown_) {
            dropdown_->setSelectedValue(value_);
        }
        updatingFromExternal_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any EnumEditor::getValue() const {
    return value_;
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 EnumEditor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = 24.0f;

    if (labelWidget_ && showLabel_) {
        width += LABEL_WIDTH + SPACING;
    }

    f32 dropdownWidth = availableWidth - width;
    if (dropdownWidth < DROPDOWN_WIDTH) {
        dropdownWidth = DROPDOWN_WIDTH;
    }
    width += dropdownWidth;

    return glm::vec2(width, height);
}

void EnumEditor::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    f32 x = bounds.x;
    f32 remainingWidth = bounds.width;

    if (labelWidget_ && showLabel_) {
        ui::Rect labelBounds{x, bounds.y, LABEL_WIDTH, bounds.height};
        labelWidget_->layout(labelBounds);
        x += LABEL_WIDTH + SPACING;
        remainingWidth -= LABEL_WIDTH + SPACING;
    }

    if (dropdown_) {
        ui::Rect dropdownBounds{x, bounds.y, remainingWidth, bounds.height};
        dropdown_->layout(dropdownBounds);
    }
}

void EnumEditor::render(ui::UIBatchRenderer& renderer) {
    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};

    if (labelWidget_ && showLabel_) {
        labelWidget_->setColor(labelColor);
        labelWidget_->renderTree(renderer);
    }

    if (dropdown_) {
        dropdown_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> EnumEditor::createCommand(const std::any& oldValue,
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

void EnumEditor::onDropdownChanged(i32 value) {
    if (updatingFromExternal_) {
        return;
    }

    i32 oldValue = value_;
    if (oldValue != value) {
        value_ = value;
        notifyValueChanged(oldValue, value);
    }
}

}  // namespace esengine::editor
