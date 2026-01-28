/**
 * @file    StringEditor.hpp
 * @brief   Property editor for string values
 * @details Uses a TextField for text input.
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
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

namespace esengine::editor {

// =============================================================================
// StringEditor Class
// =============================================================================

class StringEditor : public PropertyEditor {
public:
    explicit StringEditor(const ui::WidgetId& id, const std::string& propertyName);
    ~StringEditor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    void setPlaceholder(const std::string& placeholder);

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onTextChanged(const std::string& text);
    void onTextSubmit(const std::string& text);

    std::string value_;
    std::string pendingValue_;
    bool updatingFromValue_ = false;
    bool hasUncommittedChanges_ = false;

    ui::Label* labelWidget_ = nullptr;
    ui::TextField* textField_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 LABEL_WIDTH = 60.0f;
    static constexpr f32 SPACING = 8.0f;
};

}  // namespace esengine::editor
