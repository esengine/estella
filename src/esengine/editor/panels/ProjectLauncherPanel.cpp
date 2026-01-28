/**
 * @file    ProjectLauncherPanel.cpp
 * @brief   Project launcher panel implementation
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */

#include "ProjectLauncherPanel.hpp"
#include "../project/ProjectManager.hpp"
#include "../project/ProjectTypes.hpp"
#include "../../events/Dispatcher.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../ui/widgets/Panel.hpp"
#include "../../ui/widgets/ScrollView.hpp"
#include "../../ui/layout/StackLayout.hpp"
#include "../../ui/rendering/UIBatchRenderer.hpp"
#include "../../core/Log.hpp"

namespace esengine::editor {

// =============================================================================
// Constructor / Destructor
// =============================================================================

ProjectLauncherPanel::ProjectLauncherPanel(const ui::WidgetId& id,
                                           ProjectManager& projectManager,
                                           Dispatcher& dispatcher)
    : Widget(id)
    , project_manager_(projectManager)
    , dispatcher_(dispatcher) {
    setupUI();
    refreshRecentProjects();
}

ProjectLauncherPanel::~ProjectLauncherPanel() = default;

// =============================================================================
// Setup
// =============================================================================

void ProjectLauncherPanel::setupUI() {
    auto mainPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".main"));

    auto layout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 16.0f);
    mainPanel->setLayout(std::move(layout));
    mainPanel->setPadding(ui::Insets(40.0f, 60.0f, 40.0f, 60.0f));

    auto titleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".title"), "ESEngine");
    titleLabel->setFontSize(36.0f);
    titleLabel->setColor(glm::vec4(1.0f));
    titleLabel_ = titleLabel.get();
    mainPanel->addChild(std::move(titleLabel));

    auto subtitleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".subtitle"),
                                                "Game Engine");
    subtitleLabel->setFontSize(16.0f);
    subtitleLabel->setColor(glm::vec4(0.6f, 0.6f, 0.6f, 1.0f));
    subtitleLabel_ = subtitleLabel.get();
    mainPanel->addChild(std::move(subtitleLabel));

    auto spacer1 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer1"));
    spacer1->setHeight(ui::SizeValue::px(20.0f));
    mainPanel->addChild(std::move(spacer1));

    auto buttonContainer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".buttons"));
    auto buttonLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Horizontal, 16.0f);
    buttonContainer->setLayout(std::move(buttonLayout));

    auto newProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".new"),
                                                    "New Project");
    newProjectButton->setButtonStyle(ui::ButtonStyle::Primary);
    newProjectButton->setWidth(ui::SizeValue::px(140.0f));
    newProjectButton->setHeight(ui::SizeValue::px(40.0f));
    newProjectButton_ = newProjectButton.get();
    connections_.push_back(
        sink(newProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: New project requested");
            onCreateProjectRequested.publish();
        }));
    buttonContainer->addChild(std::move(newProjectButton));

    auto openProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".open"),
                                                     "Open Project");
    openProjectButton->setButtonStyle(ui::ButtonStyle::Secondary);
    openProjectButton->setWidth(ui::SizeValue::px(140.0f));
    openProjectButton->setHeight(ui::SizeValue::px(40.0f));
    openProjectButton_ = openProjectButton.get();
    connections_.push_back(
        sink(openProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: Browse project requested");
            onBrowseProjectRequested.publish();
        }));
    buttonContainer->addChild(std::move(openProjectButton));

    mainPanel->addChild(std::move(buttonContainer));

    auto spacer2 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer2"));
    spacer2->setHeight(ui::SizeValue::px(30.0f));
    mainPanel->addChild(std::move(spacer2));

    auto recentLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".recent_label"),
                                              "Recent Projects");
    recentLabel->setFontSize(18.0f);
    recentLabel->setColor(glm::vec4(0.8f, 0.8f, 0.8f, 1.0f));
    recentLabel_ = recentLabel.get();
    mainPanel->addChild(std::move(recentLabel));

    auto recentScrollView = makeUnique<ui::ScrollView>(
        ui::WidgetId(getId().path + ".recent_scroll"));
    recentScrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    recentScrollView->setShowScrollbars(true);
    recentScrollView->setWidth(ui::SizeValue::px(400.0f));
    recentScrollView->setHeight(ui::SizeValue::px(300.0f));
    recentScrollView_ = recentScrollView.get();

    auto recentListPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".recent_list"));
    auto listLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f);
    recentListPanel->setLayout(std::move(listLayout));
    recentListPanel_ = recentListPanel.get();
    recentScrollView->setContent(std::move(recentListPanel));

    mainPanel->addChild(std::move(recentScrollView));

    addChild(std::move(mainPanel));
}

// =============================================================================
// Recent Projects
// =============================================================================

void ProjectLauncherPanel::refreshRecentProjects() {
    if (!recentListPanel_) return;

    recentListPanel_->clearChildren();

    const auto& recentProjects = project_manager_.getRecentProjects().getRecentProjects();

    if (recentProjects.empty()) {
        auto emptyLabel = makeUnique<ui::Label>(
            ui::WidgetId(getId().path + ".empty"),
            "No recent projects");
        emptyLabel->setFontSize(14.0f);
        emptyLabel->setColor(glm::vec4(0.5f, 0.5f, 0.5f, 1.0f));
        recentListPanel_->addChild(std::move(emptyLabel));
        return;
    }

    for (usize i = 0; i < recentProjects.size(); ++i) {
        createRecentProjectItem(recentProjects[i], recentListPanel_, i);
    }
}

void ProjectLauncherPanel::createRecentProjectItem(const RecentProject& project,
                                                    ui::Panel* container, usize index) {
    std::string itemId = getId().path + ".item_" + std::to_string(index);

    auto itemPanel = makeUnique<ui::Panel>(ui::WidgetId(itemId));
    itemPanel->setBackgroundColor(glm::vec4(0.18f, 0.18f, 0.18f, 1.0f));
    itemPanel->setWidth(ui::SizeValue::percent(100.0f));
    itemPanel->setHeight(ui::SizeValue::px(60.0f));
    itemPanel->setCornerRadii(ui::CornerRadii::all(4.0f));

    auto itemLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 4.0f);
    itemPanel->setLayout(std::move(itemLayout));
    itemPanel->setPadding(ui::Insets(8.0f, 12.0f, 8.0f, 12.0f));

    auto nameLabel = makeUnique<ui::Label>(ui::WidgetId(itemId + ".name"), project.name);
    nameLabel->setFontSize(14.0f);
    nameLabel->setColor(glm::vec4(1.0f));
    itemPanel->addChild(std::move(nameLabel));

    auto pathLabel = makeUnique<ui::Label>(ui::WidgetId(itemId + ".path"), project.path);
    pathLabel->setFontSize(11.0f);
    pathLabel->setColor(glm::vec4(0.5f, 0.5f, 0.5f, 1.0f));
    itemPanel->addChild(std::move(pathLabel));

    container->addChild(std::move(itemPanel));
}

// =============================================================================
// Widget Overrides
// =============================================================================

glm::vec2 ProjectLauncherPanel::measure(f32 availableWidth, f32 availableHeight) {
    return glm::vec2(availableWidth, availableHeight);
}

void ProjectLauncherPanel::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    if (getChildCount() > 0) {
        auto* mainPanel = getChild(0);
        if (mainPanel) {
            f32 panelWidth = std::min(bounds.width, 600.0f);
            f32 panelHeight = bounds.height;
            f32 panelX = bounds.x + (bounds.width - panelWidth) / 2.0f;
            f32 panelY = bounds.y;
            mainPanel->layout(ui::Rect{panelX, panelY, panelWidth, panelHeight});
        }
    }
}

void ProjectLauncherPanel::render(ui::UIBatchRenderer& renderer) {
    renderer.pushClipRect(getBounds());
    renderer.drawRect(getBounds(), glm::vec4(0.12f, 0.12f, 0.12f, 1.0f));

    for (usize i = 0; i < getChildCount(); ++i) {
        auto* child = getChild(i);
        if (child && child->isVisible()) {
            child->renderTree(renderer);
        }
    }

    renderer.popClipRect();
}

}  // namespace esengine::editor
