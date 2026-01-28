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
    // Left panel - branding and actions
    auto leftPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".left"));
    leftPanel->setBackgroundColor(glm::vec4(0.08f, 0.08f, 0.10f, 1.0f));
    auto leftLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 8.0f);
    leftPanel->setLayout(std::move(leftLayout));
    leftPanel->setPadding(ui::Insets(60.0f, 50.0f, 40.0f, 50.0f));
    leftPanel_ = leftPanel.get();

    auto titleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".title"), "ESENGINE");
    titleLabel->setFontSize(42.0f);
    titleLabel->setColor(glm::vec4(1.0f));
    titleLabel_ = titleLabel.get();
    leftPanel->addChild(std::move(titleLabel));

    auto subtitleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".subtitle"),
                                                "Game Development Platform");
    subtitleLabel->setFontSize(14.0f);
    subtitleLabel->setColor(glm::vec4(0.5f, 0.5f, 0.5f, 1.0f));
    subtitleLabel_ = subtitleLabel.get();
    leftPanel->addChild(std::move(subtitleLabel));

    auto spacer1 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer1"));
    spacer1->setHeight(ui::SizeValue::px(60.0f));
    leftPanel->addChild(std::move(spacer1));

    auto newProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".new"),
                                                    "New Project");
    newProjectButton->setButtonStyle(ui::ButtonStyle::Primary);
    newProjectButton->setWidth(ui::SizeValue::px(220.0f));
    newProjectButton->setHeight(ui::SizeValue::px(48.0f));
    newProjectButton->setFontSize(15.0f);
    newProjectButton->setCornerRadii(ui::CornerRadii::all(6.0f));
    newProjectButton_ = newProjectButton.get();
    connections_.push_back(
        sink(newProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: New project requested");
            onCreateProjectRequested.publish();
        }));
    leftPanel->addChild(std::move(newProjectButton));

    auto spacer2 = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".spacer2"));
    spacer2->setHeight(ui::SizeValue::px(12.0f));
    leftPanel->addChild(std::move(spacer2));

    auto openProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".open"),
                                                     "Open Project");
    openProjectButton->setButtonStyle(ui::ButtonStyle::Secondary);
    openProjectButton->setWidth(ui::SizeValue::px(220.0f));
    openProjectButton->setHeight(ui::SizeValue::px(48.0f));
    openProjectButton->setFontSize(15.0f);
    openProjectButton->setCornerRadii(ui::CornerRadii::all(6.0f));
    openProjectButton_ = openProjectButton.get();
    connections_.push_back(
        sink(openProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: Browse project requested");
            onBrowseProjectRequested.publish();
        }));
    leftPanel->addChild(std::move(openProjectButton));

    auto versionLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".version"),
                                               "Version 1.0.0");
    versionLabel->setFontSize(11.0f);
    versionLabel->setColor(glm::vec4(0.35f, 0.35f, 0.35f, 1.0f));
    versionLabel_ = versionLabel.get();
    leftPanel->addChild(std::move(versionLabel));

    addChild(std::move(leftPanel));

    // Right panel - recent projects
    auto rightPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".right"));
    rightPanel->setBackgroundColor(glm::vec4(0.11f, 0.11f, 0.13f, 1.0f));
    auto rightLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 16.0f);
    rightPanel->setLayout(std::move(rightLayout));
    rightPanel->setPadding(ui::Insets(40.0f, 40.0f, 40.0f, 40.0f));
    rightPanel_ = rightPanel.get();

    auto recentLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".recent_label"),
                                              "Recent Projects");
    recentLabel->setFontSize(18.0f);
    recentLabel->setColor(glm::vec4(0.9f, 0.9f, 0.9f, 1.0f));
    recentLabel_ = recentLabel.get();
    rightPanel->addChild(std::move(recentLabel));

    auto recentScrollView = makeUnique<ui::ScrollView>(
        ui::WidgetId(getId().path + ".recent_scroll"));
    recentScrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    recentScrollView->setShowScrollbars(true);
    recentScrollView->setWidth(ui::SizeValue::percent(100.0f));
    recentScrollView->setHeight(ui::SizeValue::percent(100.0f));
    recentScrollView_ = recentScrollView.get();

    auto recentListPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".recent_list"));
    auto listLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 8.0f);
    recentListPanel->setLayout(std::move(listLayout));
    recentListPanel_ = recentListPanel.get();
    recentScrollView->setContent(std::move(recentListPanel));

    rightPanel->addChild(std::move(recentScrollView));

    addChild(std::move(rightPanel));
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
    std::string projectPath = project.path;

    auto itemButton = makeUnique<ui::Button>(ui::WidgetId(itemId), project.name);
    itemButton->setButtonStyle(ui::ButtonStyle::Secondary);
    itemButton->setWidth(ui::SizeValue::percent(100.0f));
    itemButton->setHeight(ui::SizeValue::px(56.0f));
    itemButton->setFontSize(14.0f);
    itemButton->setCornerRadii(ui::CornerRadii::all(6.0f));

    connections_.push_back(
        sink(itemButton->onClick).connect([this, projectPath]() {
            ES_LOG_INFO("ProjectLauncher: Opening project {}", projectPath);
            onProjectOpened.publish(projectPath);
        }));

    container->addChild(std::move(itemButton));
}

// =============================================================================
// Widget Overrides
// =============================================================================

glm::vec2 ProjectLauncherPanel::measure(f32 availableWidth, f32 availableHeight) {
    return glm::vec2(availableWidth, availableHeight);
}

void ProjectLauncherPanel::layout(const ui::Rect& bounds) {
    Widget::layout(bounds);

    f32 leftWidth = std::max(320.0f, bounds.width * 0.35f);
    f32 rightWidth = bounds.width - leftWidth;

    if (leftPanel_) {
        leftPanel_->layout(ui::Rect{bounds.x, bounds.y, leftWidth, bounds.height});
    }

    if (rightPanel_) {
        rightPanel_->layout(ui::Rect{bounds.x + leftWidth, bounds.y, rightWidth, bounds.height});
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
