/**
 * @file    NewProjectDialog.hpp
 * @brief   Dialog for creating new projects
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

#include "../../ui/widgets/Widget.hpp"
#include "../../ui/core/Types.hpp"
#include "../../events/Signal.hpp"
#include "../../events/Connection.hpp"

#include <string>
#include <vector>

namespace esengine::ui {
class Button;
class Label;
class TextField;
class Panel;
}

namespace esengine::editor {

// =============================================================================
// NewProjectDialog
// =============================================================================

class NewProjectDialog : public ui::Widget {
public:
    NewProjectDialog(const ui::WidgetId& id);
    ~NewProjectDialog() override;

    // =========================================================================
    // Signals
    // =========================================================================

    Signal<void(const std::string& name, const std::string& path)> onProjectCreate;
    Signal<void()> onCancel;

    // =========================================================================
    // Methods
    // =========================================================================

    void show();
    void hide();
    bool isShowing() const { return showing_; }

    // =========================================================================
    // Widget Overrides
    // =========================================================================

    glm::vec2 measure(f32 availableWidth, f32 availableHeight) override;
    void layout(const ui::Rect& bounds) override;
    void render(ui::UIBatchRenderer& renderer) override;

private:
    void setupUI();
    void onBrowseClicked();
    void onCreateClicked();
    void onCancelClicked();

    ui::Panel* dialogPanel_ = nullptr;
    ui::Label* titleLabel_ = nullptr;
    ui::Label* nameLabel_ = nullptr;
    ui::TextField* nameField_ = nullptr;
    ui::Label* pathLabel_ = nullptr;
    ui::TextField* pathField_ = nullptr;
    ui::Button* browseButton_ = nullptr;
    ui::Button* createButton_ = nullptr;
    ui::Button* cancelButton_ = nullptr;

    bool showing_ = false;
    std::vector<Connection> connections_;
};

}  // namespace esengine::editor
