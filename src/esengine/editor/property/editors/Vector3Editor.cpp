/**
 * @file    Vector3Editor.cpp
 * @brief   Vector3Editor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "Vector3Editor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

Vector3Editor::Vector3Editor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto mainLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        mainLabelWidget->setText(label_);
        mainLabelWidget->setFontSize(12.0f);
        mainLabel_ = mainLabelWidget.get();
        addChild(std::move(mainLabelWidget));
    }

    auto xLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_x_label"));
    xLabelWidget->setText("X");
    xLabelWidget->setFontSize(12.0f);
    xLabel_ = xLabelWidget.get();
    addChild(std::move(xLabelWidget));

    auto xEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_x"), "x");
    xEditorWidget->setShowLabel(false);
    xEditor_ = xEditorWidget.get();
    addChild(std::move(xEditorWidget));

    auto yLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_y_label"));
    yLabelWidget->setText("Y");
    yLabelWidget->setFontSize(12.0f);
    yLabel_ = yLabelWidget.get();
    addChild(std::move(yLabelWidget));

    auto yEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_y"), "y");
    yEditorWidget->setShowLabel(false);
    yEditor_ = yEditorWidget.get();
    addChild(std::move(yEditorWidget));

    auto zLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_z_label"));
    zLabelWidget->setText("Z");
    zLabelWidget->setFontSize(12.0f);
    zLabel_ = zLabelWidget.get();
    addChild(std::move(zLabelWidget));

    auto zEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_z"), "z");
    zEditorWidget->setShowLabel(false);
    zEditor_ = zEditorWidget.get();
    addChild(std::move(zEditorWidget));

    connections_.add(sink(xEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(yEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(zEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void Vector3Editor::setValue(const std::any& value) {
    try {
        glm::vec3 newValue = std::any_cast<glm::vec3>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;

        updatingFromValue_ = true;
        xEditor_->setValue(value_.x);
        yEditor_->setValue(value_.y);
        zEditor_->setValue(value_.z);
        updatingFromValue_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any Vector3Editor::getValue() const {
    return value_;
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 Vector3Editor::measure(f32 availableWidth, f32 availableHeight) {
    f32 width = 0.0f;
    f32 height = 20.0f;

    if (mainLabel_ && showLabel_) {
        width += MAIN_LABEL_WIDTH + SPACING;
    }

    width += COMPONENT_LABEL_WIDTH + SPACING + FLOAT_EDITOR_WIDTH + SPACING;
    width += COMPONENT_LABEL_WIDTH + SPACING + FLOAT_EDITOR_WIDTH + SPACING;
    width += COMPONENT_LABEL_WIDTH + SPACING + FLOAT_EDITOR_WIDTH;

    const ui::SizeConstraints& constraints = getConstraints();
    width = glm::clamp(width, constraints.minWidth, constraints.maxWidth);
    height = glm::clamp(height, constraints.minHeight, constraints.maxHeight);

    return glm::vec2(width, height);
}

void Vector3Editor::render(ui::UIBatchRenderer& renderer) {
    const ui::Rect& bounds = getBounds();
    f32 x = bounds.x;

    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};
    constexpr glm::vec4 xColor{0.9f, 0.4f, 0.4f, 1.0f};
    constexpr glm::vec4 yColor{0.4f, 0.9f, 0.4f, 1.0f};
    constexpr glm::vec4 zColor{0.4f, 0.6f, 0.9f, 1.0f};

    if (mainLabel_ && showLabel_) {
        mainLabel_->setColor(labelColor);
        ui::Rect labelBounds{x, bounds.y, MAIN_LABEL_WIDTH, bounds.height};
        mainLabel_->layout(labelBounds);
        mainLabel_->renderTree(renderer);
        x += MAIN_LABEL_WIDTH + SPACING;
    }

    if (xLabel_) {
        xLabel_->setColor(xColor);
        ui::Rect labelBounds{x, bounds.y, COMPONENT_LABEL_WIDTH, bounds.height};
        xLabel_->layout(labelBounds);
        xLabel_->renderTree(renderer);
        x += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (xEditor_) {
        ui::Rect editorBounds{x, bounds.y, FLOAT_EDITOR_WIDTH, bounds.height};
        xEditor_->layout(editorBounds);
        xEditor_->renderTree(renderer);
        x += FLOAT_EDITOR_WIDTH + SPACING;
    }

    if (yLabel_) {
        yLabel_->setColor(yColor);
        ui::Rect labelBounds{x, bounds.y, COMPONENT_LABEL_WIDTH, bounds.height};
        yLabel_->layout(labelBounds);
        yLabel_->renderTree(renderer);
        x += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (yEditor_) {
        ui::Rect editorBounds{x, bounds.y, FLOAT_EDITOR_WIDTH, bounds.height};
        yEditor_->layout(editorBounds);
        yEditor_->renderTree(renderer);
        x += FLOAT_EDITOR_WIDTH + SPACING;
    }

    if (zLabel_) {
        zLabel_->setColor(zColor);
        ui::Rect labelBounds{x, bounds.y, COMPONENT_LABEL_WIDTH, bounds.height};
        zLabel_->layout(labelBounds);
        zLabel_->renderTree(renderer);
        x += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (zEditor_) {
        ui::Rect editorBounds{x, bounds.y, FLOAT_EDITOR_WIDTH, bounds.height};
        zEditor_->layout(editorBounds);
        zEditor_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> Vector3Editor::createCommand(const std::any& oldValue,
                                             const std::any& newValue) {
    try {
        glm::vec3 oldVec = std::any_cast<glm::vec3>(oldValue);
        glm::vec3 newVec = std::any_cast<glm::vec3>(newValue);

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

void Vector3Editor::onComponentChanged() {
    if (updatingFromValue_) {
        return;
    }

    glm::vec3 oldValue = value_;

    try {
        value_.x = std::any_cast<f32>(xEditor_->getValue());
        value_.y = std::any_cast<f32>(yEditor_->getValue());
        value_.z = std::any_cast<f32>(zEditor_->getValue());

        if (oldValue != value_) {
            notifyValueChanged(oldValue, value_);
        }
    } catch (const std::bad_any_cast&) {
    }
}

}  // namespace esengine::editor
