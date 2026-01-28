/**
 * @file    BoolEditor.hpp
 * @brief   Property editor for boolean values
 * @details Uses a Checkbox widget for visual editing of bool properties.
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
#include "../../../ui/widgets/Checkbox.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

namespace esengine::editor {

// =============================================================================
// BoolEditor Class
// =============================================================================

class BoolEditor : public PropertyEditor {
public:
    explicit BoolEditor(const ui::WidgetId& id, const std::string& propertyName);
    ~BoolEditor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onCheckboxChanged(bool checked);

    bool value_ = false;
    bool updatingFromValue_ = false;

    ui::Label* labelWidget_ = nullptr;
    ui::Checkbox* checkbox_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 LABEL_WIDTH = 80.0f;
    static constexpr f32 CHECKBOX_SIZE = 16.0f;
    static constexpr f32 SPACING = 8.0f;
};

}  // namespace esengine::editor
