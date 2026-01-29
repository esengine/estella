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

/**
 * @brief Property editor for glm::vec2 values
 *
 * @details Renders two axis inputs with colored bars and drag-to-adjust
 *          support. Drag on axis bars to change values with different
 *          sensitivities (Shift for fine, Ctrl for coarse).
 */
class Vector2Editor : public PropertyEditor {
public:
    explicit Vector2Editor(const ui::WidgetId& id, const std::string& propertyName);
    ~Vector2Editor() override = default;

    void setValue(const std::any& value) override;
    std::any getValue() const override;

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
    enum class DragAxis { None, X, Y };

    void onComponentChanged();
    i32 getAxisAtPosition(f32 x, f32 y) const;

    glm::vec2 value_{0.0f};
    bool updatingFromValue_ = false;

    ui::Label* mainLabel_ = nullptr;
    FloatEditor* xEditor_ = nullptr;
    FloatEditor* yEditor_ = nullptr;
    ConnectionHolder connections_;

    DragAxis draggingAxis_ = DragAxis::None;
    f32 dragStartX_ = 0.0f;
    f32 dragStartValue_ = 0.0f;

    ui::Rect xAxisBounds_{};
    ui::Rect yAxisBounds_{};

    static constexpr f32 MAIN_LABEL_WIDTH = 60.0f;
    static constexpr f32 AXIS_BAR_WIDTH = 4.0f;
    static constexpr f32 AXIS_INPUT_WIDTH = 54.0f;
    static constexpr f32 SPACING = 2.0f;
};

}  // namespace esengine::editor
