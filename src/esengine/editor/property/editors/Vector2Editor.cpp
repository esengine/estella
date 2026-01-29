/**
 * @file    Vector2Editor.cpp
 * @brief   Vector2Editor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Vector2Editor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

Vector2Editor::Vector2Editor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto mainLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        mainLabelWidget->setText(label_);
        mainLabelWidget->setFontSize(12.0f);
        mainLabel_ = mainLabelWidget.get();
        addChild(std::move(mainLabelWidget));
    }

    auto xEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_x"), "x");
    xEditorWidget->setShowLabel(false);
    xEditor_ = xEditorWidget.get();
    addChild(std::move(xEditorWidget));

    auto yEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_y"), "y");
    yEditorWidget->setShowLabel(false);
    yEditor_ = yEditorWidget.get();
    addChild(std::move(yEditorWidget));

    connections_.add(sink(xEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(yEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void Vector2Editor::setValue(const std::any& value) {
    try {
        glm::vec2 newValue = std::any_cast<glm::vec2>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;

        updatingFromValue_ = true;
        xEditor_->setValue(value_.x);
        yEditor_->setValue(value_.y);
        updatingFromValue_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any Vector2Editor::getValue() const {
    return value_;
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 Vector2Editor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = 22.0f;

    if (mainLabel_ && showLabel_) {
        width += MAIN_LABEL_WIDTH + SPACING;
    }

    f32 axisWidth = AXIS_BAR_WIDTH + AXIS_INPUT_WIDTH;
    width += axisWidth + SPACING + axisWidth;

    return glm::vec2(width, height);
}

void Vector2Editor::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    f32 x = bounds.x;
    f32 axisWidth = AXIS_BAR_WIDTH + AXIS_INPUT_WIDTH;

    if (mainLabel_ && showLabel_) {
        ui::Rect labelBounds{x, bounds.y, MAIN_LABEL_WIDTH, bounds.height};
        mainLabel_->layout(labelBounds);
        x += MAIN_LABEL_WIDTH + SPACING;
    }

    xAxisBounds_ = ui::Rect{x, bounds.y, AXIS_BAR_WIDTH, bounds.height};
    if (xEditor_) {
        ui::Rect editorBounds{x + AXIS_BAR_WIDTH, bounds.y, AXIS_INPUT_WIDTH, bounds.height};
        xEditor_->layout(editorBounds);
    }
    x += axisWidth + SPACING;

    yAxisBounds_ = ui::Rect{x, bounds.y, AXIS_BAR_WIDTH, bounds.height};
    if (yEditor_) {
        ui::Rect editorBounds{x + AXIS_BAR_WIDTH, bounds.y, AXIS_INPUT_WIDTH, bounds.height};
        yEditor_->layout(editorBounds);
    }
}

void Vector2Editor::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();

    constexpr glm::vec4 labelColor{0.6f, 0.6f, 0.6f, 1.0f};
    constexpr glm::vec4 xBarColor{0.75f, 0.25f, 0.25f, 1.0f};
    constexpr glm::vec4 yBarColor{0.25f, 0.63f, 0.25f, 1.0f};
    constexpr glm::vec4 inputBg{0.1f, 0.1f, 0.1f, 1.0f};
    constexpr glm::vec4 inputBorder{0.27f, 0.27f, 0.27f, 1.0f};

    f32 axisWidth = AXIS_BAR_WIDTH + AXIS_INPUT_WIDTH;

    if (mainLabel_ && showLabel_) {
        mainLabel_->setColor(labelColor);
        mainLabel_->renderTree(renderer);
    }

    renderer.drawRoundedRect(
        ui::Rect{xAxisBounds_.x, bounds.y, axisWidth, bounds.height},
        inputBg,
        ui::CornerRadii::all(2.0f)
    );
    renderer.drawRoundedRectOutline(
        ui::Rect{xAxisBounds_.x, bounds.y, axisWidth, bounds.height},
        inputBorder,
        ui::CornerRadii::all(2.0f),
        1.0f
    );
    renderer.drawRect(ui::Rect{xAxisBounds_.x, bounds.y + 1.0f, AXIS_BAR_WIDTH, bounds.height - 2.0f}, xBarColor);
    if (xEditor_) {
        xEditor_->renderTree(renderer);
    }

    renderer.drawRoundedRect(
        ui::Rect{yAxisBounds_.x, bounds.y, axisWidth, bounds.height},
        inputBg,
        ui::CornerRadii::all(2.0f)
    );
    renderer.drawRoundedRectOutline(
        ui::Rect{yAxisBounds_.x, bounds.y, axisWidth, bounds.height},
        inputBorder,
        ui::CornerRadii::all(2.0f),
        1.0f
    );
    renderer.drawRect(ui::Rect{yAxisBounds_.x, bounds.y + 1.0f, AXIS_BAR_WIDTH, bounds.height - 2.0f}, yBarColor);
    if (yEditor_) {
        yEditor_->renderTree(renderer);
    }
}

bool Vector2Editor::onMouseDown(const ui::MouseButtonEvent& event) {
    if (event.button != ui::MouseButton::Left) {
        return false;
    }

    i32 axis = getAxisAtPosition(event.x, event.y);
    if (axis < 0) {
        return false;
    }

    dragStartX_ = event.x;

    switch (axis) {
        case 0:
            draggingAxis_ = DragAxis::X;
            dragStartValue_ = value_.x;
            break;
        case 1:
            draggingAxis_ = DragAxis::Y;
            dragStartValue_ = value_.y;
            break;
        default:
            return false;
    }

    return true;
}

bool Vector2Editor::onMouseMove(const ui::MouseMoveEvent& event) {
    if (draggingAxis_ == DragAxis::None) {
        return false;
    }

    f32 delta = event.x - dragStartX_;
    f32 sensitivity = 0.1f;

    if (event.shift) {
        sensitivity = 0.01f;
    } else if (event.ctrl) {
        sensitivity = 1.0f;
    }

    f32 newValue = dragStartValue_ + delta * sensitivity;
    newValue = std::round(newValue * 1000.0f) / 1000.0f;

    glm::vec2 oldValue = value_;

    switch (draggingAxis_) {
        case DragAxis::X:
            value_.x = newValue;
            break;
        case DragAxis::Y:
            value_.y = newValue;
            break;
        default:
            break;
    }

    if (oldValue != value_) {
        updatingFromValue_ = true;
        xEditor_->setValue(value_.x);
        yEditor_->setValue(value_.y);
        updatingFromValue_ = false;

        notifyValueChanged(oldValue, value_);
    }

    return true;
}

bool Vector2Editor::onMouseUp(const ui::MouseButtonEvent& event) {
    if (event.button != ui::MouseButton::Left || draggingAxis_ == DragAxis::None) {
        return false;
    }

    draggingAxis_ = DragAxis::None;
    return true;
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> Vector2Editor::createCommand(const std::any& oldValue,
                                             const std::any& newValue) {
    try {
        glm::vec2 oldVec = std::any_cast<glm::vec2>(oldValue);
        glm::vec2 newVec = std::any_cast<glm::vec2>(newValue);

        return makeUnique<LambdaCommand>(
            "Modify " + propertyName_,
            [this, newVec]() {
                setValue(newVec);
                return CommandResult::Success;
            },
            [this, oldVec]() {
                setValue(oldVec);
            }
        );
    } catch (const std::bad_any_cast&) {
        return nullptr;
    }
}

// =============================================================================
// Private Methods
// =============================================================================

void Vector2Editor::onComponentChanged() {
    if (updatingFromValue_) {
        return;
    }

    glm::vec2 oldValue = value_;

    try {
        value_.x = std::any_cast<f32>(xEditor_->getValue());
        value_.y = std::any_cast<f32>(yEditor_->getValue());

        if (oldValue != value_) {
            notifyValueChanged(oldValue, value_);
        }
    } catch (const std::bad_any_cast&) {
    }
}

i32 Vector2Editor::getAxisAtPosition(f32 x, f32 y) const {
    if (xAxisBounds_.contains(x, y)) {
        return 0;
    }
    if (yAxisBounds_.contains(x, y)) {
        return 1;
    }
    return -1;
}

}  // namespace esengine::editor
