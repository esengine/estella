/**
 * @file    PropertyEditor.hpp
 * @brief   Base class for property editing widgets
 * @details Provides the foundation for type-specific property editors that
 *          integrate with the command system for undo/redo support.
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

#include "../../ui/widgets/Widget.hpp"
#include "../../events/Signal.hpp"

#include <any>
#include <string>

namespace esengine::editor {

class Command;
class CommandHistory;

// =============================================================================
// PropertyEditor Class
// =============================================================================

/**
 * @brief Base class for property editing widgets
 *
 * @details PropertyEditor provides a common interface for widgets that edit
 *          component properties. Each editor creates commands for modifications
 *          to enable undo/redo support.
 *
 * @code
 * class FloatEditor : public PropertyEditor {
 * public:
 *     void setValue(const std::any& value) override {
 *         f32 floatValue = std::any_cast<f32>(value);
 *         textField_->setText(std::to_string(floatValue));
 *     }
 *
 *     std::any getValue() const override {
 *         return std::stof(textField_->getText());
 *     }
 * };
 * @endcode
 */
class PropertyEditor : public ui::Widget {
public:
    /**
     * @brief Constructs a property editor
     * @param id Unique widget identifier
     * @param propertyName Name of the property being edited
     */
    explicit PropertyEditor(const ui::WidgetId& id, const std::string& propertyName);

    ~PropertyEditor() override = default;

    // =========================================================================
    // Property Access
    // =========================================================================

    /**
     * @brief Sets the property value
     * @param value New value (type-specific, stored as std::any)
     */
    virtual void setValue(const std::any& value) = 0;

    /**
     * @brief Gets the current property value
     * @return Current value as std::any
     */
    virtual std::any getValue() const = 0;

    /**
     * @brief Gets the property name
     * @return Property name string
     */
    const std::string& getPropertyName() const { return propertyName_; }

    // =========================================================================
    // Label
    // =========================================================================

    /**
     * @brief Sets the display label
     * @param label Label text (defaults to property name)
     */
    void setLabel(const std::string& label);

    /**
     * @brief Gets the display label
     * @return Label text
     */
    const std::string& getLabel() const { return label_; }

    /**
     * @brief Sets whether to show the label
     * @param show True to show label
     */
    void setShowLabel(bool show);

    /**
     * @brief Gets whether the label is shown
     * @return True if label is shown
     */
    bool getShowLabel() const { return showLabel_; }

    // =========================================================================
    // Command Integration
    // =========================================================================

    /**
     * @brief Sets the command history for undo/redo
     * @param history Command history manager
     */
    void setCommandHistory(CommandHistory* history);

    /**
     * @brief Gets the command history
     * @return Command history manager or nullptr
     */
    CommandHistory* getCommandHistory() const { return commandHistory_; }

    // =========================================================================
    // Signals
    // =========================================================================

    /**
     * @brief Emitted when the value changes
     * @param value New value as std::any
     */
    Signal<void(const std::any&)> onValueChanged;

protected:
    /**
     * @brief Creates a command for a value change
     * @param oldValue Previous value
     * @param newValue New value
     * @return Command object or nullptr
     */
    virtual Unique<Command> createCommand(const std::any& oldValue,
                                          const std::any& newValue) = 0;

    /**
     * @brief Notifies that the value has changed
     * @param oldValue Previous value
     * @param newValue New value
     *
     * @details Creates and executes a command if command history is set,
     *          otherwise just emits the signal.
     */
    void notifyValueChanged(const std::any& oldValue, const std::any& newValue);

    std::string propertyName_;
    std::string label_;
    bool showLabel_ = true;

    CommandHistory* commandHistory_ = nullptr;
};

}  // namespace esengine::editor
