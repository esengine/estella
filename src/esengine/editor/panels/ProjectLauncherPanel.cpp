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
#include "../../ui/icons/Icons.hpp"
#include "../../core/Log.hpp"

namespace esengine::editor {

namespace {

glm::vec4 hexColor(u32 hex, f32 alpha = 1.0f) {
    return glm::vec4(
        ((hex >> 16) & 0xFF) / 255.0f,
        ((hex >> 8) & 0xFF) / 255.0f,
        (hex & 0xFF) / 255.0f,
        alpha
    );
}

constexpr f32 HEADER_PADDING_TOP = 60.0f;
constexpr f32 HEADER_PADDING_HORIZONTAL = 40.0f;
constexpr f32 HEADER_PADDING_BOTTOM = 40.0f;
constexpr f32 CONTENT_GAP = 60.0f;
constexpr f32 ACTIONS_MIN_WIDTH = 280.0f;
constexpr f32 RECENT_MAX_WIDTH = 600.0f;
constexpr f32 FOOTER_HEIGHT = 50.0f;
constexpr f32 BUTTON_HEIGHT = 40.0f;
constexpr f32 BUTTON_GAP = 12.0f;
constexpr f32 RECENT_ITEM_HEIGHT = 52.0f;

}  // namespace

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
    auto leftPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".left"));
    leftPanel->setBackgroundColor(hexColor(0x1e1e1e));
    auto leftLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f);
    leftPanel->setLayout(std::move(leftLayout));
    leftPanel->setPadding(ui::Insets(HEADER_PADDING_TOP, HEADER_PADDING_HORIZONTAL,
                                      HEADER_PADDING_BOTTOM, HEADER_PADDING_HORIZONTAL));
    leftPanel_ = leftPanel.get();

    auto titleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".title"), "ESEngine Editor");
    titleLabel->setFontSize(32.0f);
    titleLabel->setColor(hexColor(0xffffff));
    titleLabel_ = titleLabel.get();
    leftPanel->addChild(std::move(titleLabel));

    auto subtitleSpacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".subtitle_spacer"));
    subtitleSpacer->setHeight(ui::SizeValue::px(8.0f));
    leftPanel->addChild(std::move(subtitleSpacer));

    auto subtitleLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".subtitle"),
                                                "Professional Game Development Tool");
    subtitleLabel->setFontSize(14.0f);
    subtitleLabel->setColor(hexColor(0x858585));
    subtitleLabel_ = subtitleLabel.get();
    leftPanel->addChild(std::move(subtitleLabel));

    auto actionsSpacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".actions_spacer"));
    actionsSpacer->setHeight(ui::SizeValue::px(40.0f));
    leftPanel->addChild(std::move(actionsSpacer));

    auto openProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".open"),
                                                     "Open Project");
    openProjectButton->setButtonStyle(ui::ButtonStyle::Primary);
    openProjectButton->setWidth(ui::SizeValue::percent(100.0f));
    openProjectButton->setHeight(ui::SizeValue::px(BUTTON_HEIGHT));
    openProjectButton->setFontSize(13.0f);
    openProjectButton->setCornerRadii(ui::CornerRadii::all(2.0f));
    openProjectButton_ = openProjectButton.get();
    connections_.push_back(
        sink(openProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: Browse project requested");
            onBrowseProjectRequested.publish();
        }));
    leftPanel->addChild(std::move(openProjectButton));

    auto buttonSpacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".button_spacer"));
    buttonSpacer->setHeight(ui::SizeValue::px(BUTTON_GAP));
    leftPanel->addChild(std::move(buttonSpacer));

    auto newProjectButton = makeUnique<ui::Button>(ui::WidgetId(getId().path + ".new"),
                                                    "Create Project");
    newProjectButton->setButtonStyle(ui::ButtonStyle::Secondary);
    newProjectButton->setWidth(ui::SizeValue::percent(100.0f));
    newProjectButton->setHeight(ui::SizeValue::px(BUTTON_HEIGHT));
    newProjectButton->setFontSize(13.0f);
    newProjectButton->setCornerRadii(ui::CornerRadii::all(2.0f));
    newProjectButton_ = newProjectButton.get();
    connections_.push_back(
        sink(newProjectButton_->onClick).connect([this]() {
            ES_LOG_INFO("ProjectLauncher: New project requested");
            onCreateProjectRequested.publish();
        }));
    leftPanel->addChild(std::move(newProjectButton));

    auto flexSpacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".flex_spacer"));
    flexSpacer->setHeight(ui::SizeValue::percent(100.0f));
    leftPanel->addChild(std::move(flexSpacer));

    auto versionLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".version"),
                                               "Version 1.0.0");
    versionLabel->setFontSize(11.0f);
    versionLabel->setColor(hexColor(0x6e6e6e));
    versionLabel_ = versionLabel.get();
    leftPanel->addChild(std::move(versionLabel));

    addChild(std::move(leftPanel));

    auto rightPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".right"));
    rightPanel->setBackgroundColor(hexColor(0x1e1e1e));
    auto rightLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 0.0f);
    rightPanel->setLayout(std::move(rightLayout));
    rightPanel->setPadding(ui::Insets(HEADER_PADDING_TOP, HEADER_PADDING_HORIZONTAL,
                                       HEADER_PADDING_BOTTOM, HEADER_PADDING_HORIZONTAL));
    rightPanel_ = rightPanel.get();

    auto recentLabel = makeUnique<ui::Label>(ui::WidgetId(getId().path + ".recent_label"),
                                              "RECENT PROJECTS");
    recentLabel->setFontSize(13.0f);
    recentLabel->setColor(hexColor(0xcccccc));
    recentLabel_ = recentLabel.get();
    rightPanel->addChild(std::move(recentLabel));

    auto recentSpacer = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".recent_spacer"));
    recentSpacer->setHeight(ui::SizeValue::px(16.0f));
    rightPanel->addChild(std::move(recentSpacer));

    auto recentScrollView = makeUnique<ui::ScrollView>(
        ui::WidgetId(getId().path + ".recent_scroll"));
    recentScrollView->setScrollDirection(ui::ScrollDirection::Vertical);
    recentScrollView->setShowScrollbars(true);
    recentScrollView->setWidth(ui::SizeValue::percent(100.0f));
    recentScrollView->setHeight(ui::SizeValue::percent(100.0f));
    recentScrollView_ = recentScrollView.get();

    auto recentListPanel = makeUnique<ui::Panel>(ui::WidgetId(getId().path + ".recent_list"));
    auto listLayout = makeUnique<ui::StackLayout>(ui::StackDirection::Vertical, 1.0f);
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
        emptyLabel->setFontSize(13.0f);
        emptyLabel->setColor(hexColor(0x858585));
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
    itemButton->setButtonStyle(ui::ButtonStyle::Ghost);
    itemButton->setWidth(ui::SizeValue::percent(100.0f));
    itemButton->setHeight(ui::SizeValue::px(RECENT_ITEM_HEIGHT));
    itemButton->setFontSize(13.0f);
    itemButton->setCornerRadii(ui::CornerRadii::all(2.0f));
    itemButton->setTextAlignment(ui::HAlign::Left);

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

    f32 contentWidth = bounds.width - HEADER_PADDING_HORIZONTAL * 2;
    f32 leftWidth = ACTIONS_MIN_WIDTH;
    f32 rightWidth = contentWidth - leftWidth - CONTENT_GAP;

    if (rightWidth > RECENT_MAX_WIDTH) {
        rightWidth = RECENT_MAX_WIDTH;
    }

    if (leftPanel_) {
        leftPanel_->layout(ui::Rect{
            bounds.x,
            bounds.y,
            leftWidth + HEADER_PADDING_HORIZONTAL * 2,
            bounds.height
        });
    }

    if (rightPanel_) {
        rightPanel_->layout(ui::Rect{
            bounds.x + leftWidth + HEADER_PADDING_HORIZONTAL * 2 + CONTENT_GAP,
            bounds.y,
            rightWidth + HEADER_PADDING_HORIZONTAL * 2,
            bounds.height
        });
    }
}

void ProjectLauncherPanel::render(ui::UIBatchRenderer& renderer) {
    renderer.drawRect(getBounds(), hexColor(0x1e1e1e));
}

}  // namespace esengine::editor
