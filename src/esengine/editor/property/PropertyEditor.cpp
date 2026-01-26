/**
 * @file    PropertyEditor.cpp
 * @brief   PropertyEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "PropertyEditor.hpp"
#include "../command/CommandHistory.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

PropertyEditor::PropertyEditor(const ui::WidgetId& id, const std::string& propertyName)
    : ui::Widget(id), propertyName_(propertyName), label_(propertyName) {}

// =============================================================================
// Label
// =============================================================================

void PropertyEditor::setLabel(const std::string& label) {
    if (label_ == label) {
        return;
    }

    label_ = label;
    invalidateLayout();
}

void PropertyEditor::setShowLabel(bool show) {
    if (showLabel_ == show) {
        return;
    }

    showLabel_ = show;
    invalidateLayout();
}

// =============================================================================
// Command Integration
// =============================================================================

void PropertyEditor::setCommandHistory(CommandHistory* history) {
    commandHistory_ = history;
}

// =============================================================================
// Protected Methods
// =============================================================================

void PropertyEditor::notifyValueChanged(const std::any& oldValue, const std::any& newValue) {
    if (commandHistory_) {
        auto command = createCommand(oldValue, newValue);
        if (command) {
            commandHistory_->execute(std::move(command));
        }
    }

    onValueChanged.publish(newValue);
}

}  // namespace esengine::editor
