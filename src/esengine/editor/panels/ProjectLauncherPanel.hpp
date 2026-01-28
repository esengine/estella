/**
 * @file    ProjectLauncherPanel.hpp
 * @brief   Project launcher panel for selecting or creating projects
 *
 * @author  ESEngine Team
 * @date    2026
 *
 * @copyright Copyright (c) 2026 ESEngine Team
 *            Licensed under the MIT License.
 */
#pragma once

#include "../../ui/widgets/Widget.hpp"
#include "../../ui/core/Types.hpp"
#include "../../events/Signal.hpp"
#include "../../events/Connection.hpp"
#include "../project/ProjectTypes.hpp"

#include <string>
#include <vector>

namespace esengine {
class Dispatcher;
}

namespace esengine::ui {
class Panel;
class Label;
class Button;
class ScrollView;
}

namespace esengine::editor {

class ProjectManager;

// =============================================================================
// ProjectLauncherPanel
// =============================================================================

class ProjectLauncherPanel : public ui::Widget {
public:
    ProjectLauncherPanel(const ui::WidgetId& id, ProjectManager& projectManager,
                         Dispatcher& dispatcher);
    ~ProjectLauncherPanel() override;

    Signal<void(const std::string&)> onProjectOpened;
    Signal<void()> onCreateProjectRequested;
    Signal<void()> onBrowseProjectRequested;

    void refreshRecentProjects();

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

private:
    void setupUI();
    void createRecentProjectItem(const RecentProject& project, ui::Panel* container, usize index);

    ProjectManager& project_manager_;
    Dispatcher& dispatcher_;

    ui::Panel* leftPanel_ = nullptr;
    ui::Panel* rightPanel_ = nullptr;
    ui::Label* titleLabel_ = nullptr;
    ui::Label* subtitleLabel_ = nullptr;
    ui::Button* newProjectButton_ = nullptr;
    ui::Button* openProjectButton_ = nullptr;
    ui::Label* versionLabel_ = nullptr;
    ui::Label* recentLabel_ = nullptr;
    ui::ScrollView* recentScrollView_ = nullptr;
    ui::Panel* recentListPanel_ = nullptr;

    std::vector<Connection> connections_;
};

}  // namespace esengine::editor
