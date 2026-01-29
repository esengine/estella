/**
 * @file    ColorEditor.cpp
 * @brief   ColorEditor implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ColorEditor.hpp"
#include "../../command/PropertyCommand.hpp"
#include "../../../ui/UIContext.hpp"
#include "../../../ui/rendering/UIBatchRenderer.hpp"
#include "../../../events/Sink.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor
// =============================================================================

ColorEditor::ColorEditor(const ui::WidgetId& id, const std::string& propertyName)
    : PropertyEditor(id, propertyName) {

    if (showLabel_) {
        auto mainLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_label"));
        mainLabelWidget->setText(label_);
        mainLabelWidget->setFontSize(12.0f);
        mainLabel_ = mainLabelWidget.get();
        addChild(std::move(mainLabelWidget));
    }

    auto colorPreviewWidget = makeUnique<ui::Panel>(ui::WidgetId(getId().path + "_preview"));
    colorPreviewWidget->setDrawBackground(true);
    colorPreviewWidget->setBackgroundColor(value_);
    colorPreview_ = colorPreviewWidget.get();
    addChild(std::move(colorPreviewWidget));

    auto rLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_r_label"));
    rLabelWidget->setText("R");
    rLabelWidget->setFontSize(12.0f);
    rLabel_ = rLabelWidget.get();
    addChild(std::move(rLabelWidget));

    auto rEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_r"), "r");
    rEditorWidget->setShowLabel(false);
    rEditorWidget->setRange(0.0f, 1.0f);
    rEditor_ = rEditorWidget.get();
    addChild(std::move(rEditorWidget));

    auto gLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_g_label"));
    gLabelWidget->setText("G");
    gLabelWidget->setFontSize(12.0f);
    gLabel_ = gLabelWidget.get();
    addChild(std::move(gLabelWidget));

    auto gEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_g"), "g");
    gEditorWidget->setShowLabel(false);
    gEditorWidget->setRange(0.0f, 1.0f);
    gEditor_ = gEditorWidget.get();
    addChild(std::move(gEditorWidget));

    auto bLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_b_label"));
    bLabelWidget->setText("B");
    bLabelWidget->setFontSize(12.0f);
    bLabel_ = bLabelWidget.get();
    addChild(std::move(bLabelWidget));

    auto bEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_b"), "b");
    bEditorWidget->setShowLabel(false);
    bEditorWidget->setRange(0.0f, 1.0f);
    bEditor_ = bEditorWidget.get();
    addChild(std::move(bEditorWidget));

    auto aLabelWidget = makeUnique<ui::Label>(ui::WidgetId(getId().path + "_a_label"));
    aLabelWidget->setText("A");
    aLabelWidget->setFontSize(12.0f);
    aLabel_ = aLabelWidget.get();
    addChild(std::move(aLabelWidget));

    auto aEditorWidget = makeUnique<FloatEditor>(ui::WidgetId(getId().path + "_a"), "a");
    aEditorWidget->setShowLabel(false);
    aEditorWidget->setRange(0.0f, 1.0f);
    aEditor_ = aEditorWidget.get();
    addChild(std::move(aEditorWidget));

    connections_.add(sink(rEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(gEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(bEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
    connections_.add(sink(aEditor_->onValueChanged).connect(
        [this](const std::any&) { onComponentChanged(); }
    ));
}

// =============================================================================
// PropertyEditor Interface
// =============================================================================

void ColorEditor::setValue(const std::any& value) {
    try {
        glm::vec4 newValue = std::any_cast<glm::vec4>(value);
        if (value_ == newValue) {
            return;
        }

        value_ = newValue;

        updatingFromValue_ = true;
        rEditor_->setValue(value_.r);
        gEditor_->setValue(value_.g);
        bEditor_->setValue(value_.b);
        aEditor_->setValue(value_.a);
        if (colorPreview_) {
            colorPreview_->setBackgroundColor(value_);
        }
        updatingFromValue_ = false;
    } catch (const std::bad_any_cast&) {
    }
}

std::any ColorEditor::getValue() const {
    return value_;
}

// =============================================================================
// Widget Interface
// =============================================================================

glm::vec2 ColorEditor::measure(f32 availableWidth, f32 availableHeight) {
    (void)availableWidth;
    (void)availableHeight;

    f32 width = 0.0f;
    f32 height = ROW_HEIGHT * 2.0f + SPACING;

    if (mainLabel_ && showLabel_) {
        width += MAIN_LABEL_WIDTH + SPACING;
    }

    width += COLOR_PREVIEW_SIZE + SPACING;
    width += (COMPONENT_LABEL_WIDTH + SPACING + FLOAT_EDITOR_WIDTH + SPACING) * 2;

    return glm::vec2(width, height);
}

void ColorEditor::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    f32 x = bounds.x;
    f32 y = bounds.y;

    if (mainLabel_ && showLabel_) {
        ui::Rect labelBounds{x, y, MAIN_LABEL_WIDTH, ROW_HEIGHT};
        mainLabel_->layout(labelBounds);
        x += MAIN_LABEL_WIDTH + SPACING;
    }

    if (colorPreview_) {
        ui::Rect previewBounds{x, y, COLOR_PREVIEW_SIZE, ROW_HEIGHT * 2.0f + SPACING};
        colorPreview_->layout(previewBounds);
        x += COLOR_PREVIEW_SIZE + SPACING;
    }

    f32 rowX = x;

    if (rLabel_) {
        ui::Rect labelBounds{rowX, y, COMPONENT_LABEL_WIDTH, ROW_HEIGHT};
        rLabel_->layout(labelBounds);
        rowX += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (rEditor_) {
        ui::Rect editorBounds{rowX, y, FLOAT_EDITOR_WIDTH, ROW_HEIGHT};
        rEditor_->layout(editorBounds);
        rowX += FLOAT_EDITOR_WIDTH + SPACING;
    }

    if (gLabel_) {
        ui::Rect labelBounds{rowX, y, COMPONENT_LABEL_WIDTH, ROW_HEIGHT};
        gLabel_->layout(labelBounds);
        rowX += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (gEditor_) {
        ui::Rect editorBounds{rowX, y, FLOAT_EDITOR_WIDTH, ROW_HEIGHT};
        gEditor_->layout(editorBounds);
    }

    y += ROW_HEIGHT + SPACING;
    rowX = x;

    if (bLabel_) {
        ui::Rect labelBounds{rowX, y, COMPONENT_LABEL_WIDTH, ROW_HEIGHT};
        bLabel_->layout(labelBounds);
        rowX += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (bEditor_) {
        ui::Rect editorBounds{rowX, y, FLOAT_EDITOR_WIDTH, ROW_HEIGHT};
        bEditor_->layout(editorBounds);
        rowX += FLOAT_EDITOR_WIDTH + SPACING;
    }

    if (aLabel_) {
        ui::Rect labelBounds{rowX, y, COMPONENT_LABEL_WIDTH, ROW_HEIGHT};
        aLabel_->layout(labelBounds);
        rowX += COMPONENT_LABEL_WIDTH + SPACING;
    }

    if (aEditor_) {
        ui::Rect editorBounds{rowX, y, FLOAT_EDITOR_WIDTH, ROW_HEIGHT};
        aEditor_->layout(editorBounds);
    }
}

void ColorEditor::render(ui::UIBatchRenderer& renderer) {
    constexpr glm::vec4 labelColor{0.686f, 0.686f, 0.686f, 1.0f};
    constexpr glm::vec4 rColor{0.9f, 0.4f, 0.4f, 1.0f};
    constexpr glm::vec4 gColor{0.4f, 0.9f, 0.4f, 1.0f};
    constexpr glm::vec4 bColor{0.4f, 0.6f, 0.9f, 1.0f};
    constexpr glm::vec4 aColor{0.7f, 0.7f, 0.7f, 1.0f};

    if (mainLabel_ && showLabel_) {
        mainLabel_->setColor(labelColor);
        mainLabel_->renderTree(renderer);
    }

    if (colorPreview_) {
        colorPreview_->setBackgroundColor(value_);
        colorPreview_->renderTree(renderer);
    }

    if (rLabel_) {
        rLabel_->setColor(rColor);
        rLabel_->renderTree(renderer);
    }
    if (rEditor_) {
        rEditor_->renderTree(renderer);
    }

    if (gLabel_) {
        gLabel_->setColor(gColor);
        gLabel_->renderTree(renderer);
    }
    if (gEditor_) {
        gEditor_->renderTree(renderer);
    }

    if (bLabel_) {
        bLabel_->setColor(bColor);
        bLabel_->renderTree(renderer);
    }
    if (bEditor_) {
        bEditor_->renderTree(renderer);
    }

    if (aLabel_) {
        aLabel_->setColor(aColor);
        aLabel_->renderTree(renderer);
    }
    if (aEditor_) {
        aEditor_->renderTree(renderer);
    }
}

// =============================================================================
// Protected Methods
// =============================================================================

Unique<Command> ColorEditor::createCommand(const std::any& oldValue,
                                           const std::any& newValue) {
    try {
        glm::vec4 oldVec = std::any_cast<glm::vec4>(oldValue);
        glm::vec4 newVec = std::any_cast<glm::vec4>(newValue);

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

void ColorEditor::onComponentChanged() {
    if (updatingFromValue_) {
        return;
    }

    glm::vec4 oldValue = value_;

    try {
        value_.r = std::any_cast<f32>(rEditor_->getValue());
        value_.g = std::any_cast<f32>(gEditor_->getValue());
        value_.b = std::any_cast<f32>(bEditor_->getValue());
        value_.a = std::any_cast<f32>(aEditor_->getValue());

        if (colorPreview_) {
            colorPreview_->setBackgroundColor(value_);
        }

        if (oldValue != value_) {
            notifyValueChanged(oldValue, value_);
        }
    } catch (const std::bad_any_cast&) {
    }
}

}  // namespace esengine::editor
