/**
 * @file    Vector2Editor.hpp
 * @brief   Property editor for 2D vector values
 * @details Combines two FloatEditors (X, Y) for editing glm::vec2.
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
#include "FloatEditor.hpp"
#include "../../../ui/widgets/Label.hpp"
#include "../../../events/Connection.hpp"

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// Vector2Editor Class
// =============================================================================

class Vector2Editor : public PropertyEditor {
public:
    explicit Vector2Editor(const ui::WidgetId& id, const std::string& propertyName);
    ~Vector2Editor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onComponentChanged();

    glm::vec2 value_{0.0f};
    bool updatingFromValue_ = false;

    ui::Label* mainLabel_ = nullptr;
    ui::Label* xLabel_ = nullptr;
    ui::Label* yLabel_ = nullptr;

    FloatEditor* xEditor_ = nullptr;
    FloatEditor* yEditor_ = nullptr;
    ConnectionHolder connections_;

    static constexpr f32 MAIN_LABEL_WIDTH = 60.0f;
    static constexpr f32 COMPONENT_LABEL_WIDTH = 12.0f;
    static constexpr f32 FLOAT_EDITOR_WIDTH = 60.0f;
    static constexpr f32 SPACING = 4.0f;
};

}  // namespace esengine::editor
