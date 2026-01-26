/**
 * @file    Vector3Editor.hpp
 * @brief   Property editor for 3D vector values
 * @details Combines three FloatEditors (X, Y, Z) for editing glm::vec3.
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

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// Vector3Editor Class
// =============================================================================

/**
 * @brief Property editor for glm::vec3 values
 *
 * @details Renders three FloatEditors for X, Y, Z components with labels.
 *          Creates LambdaCommand for undo/redo support.
 *
 * @code
 * auto editor = makeUnique<Vector3Editor>(WidgetId("position"), "Position");
 * editor->setValue(glm::vec3(1.0f, 2.0f, 3.0f));
 * editor->onValueChanged.connect([](const std::any& value) {
 *     glm::vec3 pos = std::any_cast<glm::vec3>(value);
 *     ES_LOG_INFO("Position: ({}, {}, {})", pos.x, pos.y, pos.z);
 * });
 * @endcode
 */
class Vector3Editor : public PropertyEditor {
public:
    /**
     * @brief Constructs a Vector3 editor
     * @param id Unique widget identifier
     * @param propertyName Name of the property being edited
     */
    explicit Vector3Editor(const ui::WidgetId& id, const std::string& propertyName);

    ~Vector3Editor() override = default;

    // =========================================================================
    // PropertyEditor Interface
    // =========================================================================

    void setValue(const std::any& value) override;
    std::any getValue() const override;

    // =========================================================================
    // Widget Interface
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void render(ui::UIBatchRenderer& renderer) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    void onComponentChanged();

    glm::vec3 value_{0.0f};
    bool updatingFromValue_ = false;

    ui::Label* mainLabel_ = nullptr;
    ui::Label* xLabel_ = nullptr;
    ui::Label* yLabel_ = nullptr;
    ui::Label* zLabel_ = nullptr;

    FloatEditor* xEditor_ = nullptr;
    FloatEditor* yEditor_ = nullptr;
    FloatEditor* zEditor_ = nullptr;

    static constexpr f32 MAIN_LABEL_WIDTH = 60.0f;
    static constexpr f32 COMPONENT_LABEL_WIDTH = 12.0f;
    static constexpr f32 FLOAT_EDITOR_WIDTH = 60.0f;
    static constexpr f32 SPACING = 4.0f;
};

}  // namespace esengine::editor
