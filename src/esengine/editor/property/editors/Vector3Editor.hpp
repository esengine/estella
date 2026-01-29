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
#include "../../../events/Connection.hpp"

#include <glm/glm.hpp>

namespace esengine::editor {

// =============================================================================
// Vector3Editor Class
// =============================================================================

/**
 * @brief Property editor for glm::vec3 values
 *
 * @details Renders three axis inputs with colored bars and drag-to-adjust
 *          support. Drag on axis bars to change values with different
 *          sensitivities (Shift for fine, Ctrl for coarse).
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
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onMouseMove(const ui::MouseMoveEvent& event) override;
    bool onMouseUp(const ui::MouseButtonEvent& event) override;

protected:
    Unique<Command> createCommand(const std::any& oldValue,
                                  const std::any& newValue) override;

private:
    enum class DragAxis { None, X, Y, Z };

    void onComponentChanged();
    i32 getAxisAtPosition(f32 x, f32 y) const;

    glm::vec3 value_{0.0f};
    bool updatingFromValue_ = false;

    ui::Label* mainLabel_ = nullptr;
    FloatEditor* xEditor_ = nullptr;
    FloatEditor* yEditor_ = nullptr;
    FloatEditor* zEditor_ = nullptr;
    ConnectionHolder connections_;

    DragAxis draggingAxis_ = DragAxis::None;
    f32 dragStartX_ = 0.0f;
    f32 dragStartValue_ = 0.0f;
    glm::vec3 valueBeforeDrag_{0.0f};

    ui::Rect xAxisBounds_{};
    ui::Rect yAxisBounds_{};
    ui::Rect zAxisBounds_{};

    static constexpr f32 MAIN_LABEL_WIDTH = 60.0f;
    static constexpr f32 AXIS_BAR_WIDTH = 4.0f;
    static constexpr f32 AXIS_INPUT_WIDTH = 54.0f;
    static constexpr f32 SPACING = 2.0f;
};

}  // namespace esengine::editor
