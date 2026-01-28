/**
 * @file    NewProjectDialog.cpp
 * @brief   Dialog for creating new projects implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "NewProjectDialog.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../ui/widgets/TextField.hpp"
#include "../../ui/widgets/Panel.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../platform/FileDialog.hpp"
#include "../../events/Sink.hpp"
#include "../../core/Log.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor / Destructor
// =============================================================================

NewProjectDialog::NewProjectDialog(const ui::WidgetId& id)
    : Widget(id) {
    setupUI();
}

NewProjectDialog::~NewProjectDialog() = default;

// =============================================================================
// Setup
// =============================================================================

void NewProjectDialog::setupUI() {
    auto dialogPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".dialog"));
    dialogPanel->setBackgroundColor(glm::vec4(0.18f, 0.18f, 0.20f, 1.0f));
    dialogPanel->setCornerRadii(ui::CornerRadii::all(12.0f));
    dialogPanel->setWidth(ui::SizeValue::px(480.0f));
    dialogPanel->setHeight(ui::SizeValue::px(340.0f));

    auto layout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 12.0f);
    dialogPanel->setLayout(std::move(layout));
    dialogPanel->setPadding(ui::Insets(32.0f, 32.0f, 32.0f, 32.0f));

    auto titleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".title"), "Create New Project");
    titleLabel->setFontSize(22.0f);
    titleLabel->setColor(glm::vec4(1.0f));
    titleLabel_ = titleLabel.get();
    dialogPanel->addChild(std::move(titleLabel));

    auto spacer1 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer1"));
    spacer1->setHeight(ui::SizeValue::px(8.0f));
    dialogPanel->addChild(std::move(spacer1));

    auto nameLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".name_label"), "Project Name");
    nameLabel->setFontSize(13.0f);
    nameLabel->setColor(glm::vec4(0.7f, 0.7f, 0.7f, 1.0f));
    nameLabel_ = nameLabel.get();
    dialogPanel->addChild(std::move(nameLabel));

    auto nameField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + ".name_field"));
    nameField->setPlaceholder("MyGame");
    nameField->setWidth(ui::SizeValue::percent(100.0f));
    nameField->setHeight(ui::SizeValue::px(38.0f));
    nameField_ = nameField.get();
    dialogPanel->addChild(std::move(nameField));

    auto pathLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".path_label"), "Location");
    pathLabel->setFontSize(13.0f);
    pathLabel->setColor(glm::vec4(0.7f, 0.7f, 0.7f, 1.0f));
    pathLabel_ = pathLabel.get();
    dialogPanel->addChild(std::move(pathLabel));

    auto pathRow = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".path_row"));
    auto pathRowLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 8.0f);
    pathRow->setLayout(std::move(pathRowLayout));
    pathRow->setWidth(ui::SizeValue::percent(100.0f));
    pathRow->setHeight(ui::SizeValue::px(38.0f));

    auto pathField = makeUnique<ui::TextField>(ui::WidgetId(getId().path + ".path_field"));
    pathField->setPlaceholder("Select folder...");
    pathField->setWidth(ui::SizeValue::px(320.0f));
    pathField->setHeight(ui::SizeValue::px(38.0f));
    pathField_ = pathField.get();
    pathRow->addChild(std::move(pathField));

    auto browseButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".browse"), "Browse...");
    browseButton->setButtonStyle(ui::ButtonStyle::Secondary);
    browseButton->setWidth(ui::SizeValue::px(90.0f));
    browseButton->setHeight(ui::SizeValue::px(38.0f));
    browseButton_ = browseButton.get();
    connections_.push_back(
        sink(browseButton_->onClick).connect([this]() { onBrowseClicked(); }));
    pathRow->addChild(std::move(browseButton));

    dialogPanel->addChild(std::move(pathRow));

    auto spacer2 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer2"));
    spacer2->setHeight(ui::SizeValue::px(24.0f));
    dialogPanel->addChild(std::move(spacer2));

    auto buttonRow = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".buttons"));
    auto buttonLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 12.0f);
    buttonRow->setLayout(std::move(buttonLayout));
    buttonRow->setHeight(ui::SizeValue::px(42.0f));

    auto cancelButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".cancel"), "Cancel");
    cancelButton->setButtonStyle(ui::ButtonStyle::Secondary);
    cancelButton->setWidth(ui::SizeValue::px(110.0f));
    cancelButton->setHeight(ui::SizeValue::px(42.0f));
    cancelButton_ = cancelButton.get();
    connections_.push_back(
        sink(cancelButton_->onClick).connect([this]() { onCancelClicked(); }));
    buttonRow->addChild(std::move(cancelButton));

    auto createButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".create"), "Create Project");
    createButton->setButtonStyle(ui::ButtonStyle::Primary);
    createButton->setWidth(ui::SizeValue::px(130.0f));
    createButton->setHeight(ui::SizeValue::px(42.0f));
    createButton_ = createButton.get();
    connections_.push_back(
        sink(createButton_->onClick).connect([this]() { onCreateClicked(); }));
    buttonRow->addChild(std::move(createButton));

    dialogPanel->addChild(std::move(buttonRow));

    dialogPanel_ = dialogPanel.get();
    addChild(std::move(dialogPanel));
}

// =============================================================================
// Methods
// =============================================================================

void NewProjectDialog::show() {
    showing_ = true;
    setVisible(true);
    if (nameField_) {
        nameField_->setText("");
    }
    if (pathField_) {
        pathField_->setText("");
    }
}

void NewProjectDialog::hide() {
    showing_ = false;
    setVisible(false);
}

void NewProjectDialog::onBrowseClicked() {
    std::string folder = FileDialog::selectFolder("Select Project Location");
    if (!folder.empty() && pathField_) {
        pathField_->setText(folder);
    }
}

void NewProjectDialog::onCreateClicked() {
    if (!nameField_ || !pathField_) return;

    std::string name = nameField_->getText();
    std::string basePath = pathField_->getText();

    if (name.empty()) {
        ES_LOG_WARN("Project name cannot be empty");
        return;
    }

    if (basePath.empty()) {
        ES_LOG_WARN("Project location cannot be empty");
        return;
    }

    std::string fullPath = basePath + "/" + name;
    ES_LOG_INFO("Creating project '{}' at {}", name, fullPath);

    onProjectCreate.publish(name, fullPath);
    hide();
}

void NewProjectDialog::onCancelClicked() {
    onCancel.publish();
    hide();
}

// =============================================================================
// Widget Overrides
// =============================================================================

glm::vec2 NewProjectDialog::measure(f32 availableWidth, f32 availableHeight) {
    return glm::vec2(availableWidth, availableHeight);
}

void NewProjectDialog::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    if (dialogPanel_) {
        f32 dialogWidth = 480.0f;
        f32 dialogHeight = 340.0f;
        f32 dialogX = bounds.x + (bounds.width - dialogWidth) / 2.0f;
        f32 dialogY = bounds.y + (bounds.height - dialogHeight) / 2.0f;
        dialogPanel_->layout(ui::Rect{dialogX, dialogY, dialogWidth, dialogHeight});
    }
}

void NewProjectDialog::render(ui::UIBatchRenderer& renderer) {
    if (!showing_) return;

    renderer.drawRect(getBounds(), glm::vec4(0.0f, 0.0f, 0.0f, 0.6f));

    for (usize i = 0; i < getChildCount(); ++i) {
        auto* child = getChild(i);
        if (child && child->isVisible()) {
            child->renderTree(renderer);
        }
    }
}

}  // namespace esengine::editor
