/**
 * @file    InspectorPanel.hpp
 * @brief   Inspector panel for editing entity properties
 * @details Displays and edits components of the selected entity with undo/redo support.
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

#include "../../ui/docking/DockPanel.hpp"
#include "../../ui/widgets/ScrollView.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../ui/widgets/Panel.hpp"
#include "../../ui/widgets/TextField.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../ecs/Registry.hpp"
#include "../../ecs/Entity.hpp"
#include "../core/Selection.hpp"
#include "../command/CommandHistory.hpp"
#include "../property/editors/Vector3Editor.hpp"
#include "../property/editors/Vector2Editor.hpp"
#include "../property/editors/FloatEditor.hpp"
#include "../property/editors/BoolEditor.hpp"
#include "../property/editors/IntEditor.hpp"
#include "../property/editors/StringEditor.hpp"
#include "../property/editors/ColorEditor.hpp"
#include "../property/editors/EnumEditor.hpp"
#include "../../events/Connection.hpp"
#include "../script/ScriptComponentRegistry.hpp"

#include <unordered_set>
#include <unordered_map>

namespace esengine::editor {

// =============================================================================
// InspectorPanel Class
// =============================================================================

/**
 * @brief Panel for inspecting and editing entity properties
 *
 * @details Shows all components of the selected entity and provides
 *          property editors for each component. Changes are tracked
 *          through CommandHistory for undo/redo support.
 *
 * @code
 * InspectorPanel inspector(registry, selection, history);
 * // Selection changes trigger automatic refresh
 * @endcode
 */
class InspectorPanel : public ui::DockPanel {
public:
    /**
     * @brief Constructs inspector panel
     * @param registry Entity registry
     * @param selection Entity selection manager
     * @param history Command history for undo/redo
     * @param scriptRegistry Script component registry (optional)
     */
    InspectorPanel(ecs::Registry& registry,
                  EntitySelection& selection,
                  CommandHistory& history,
                  ScriptComponentRegistry* scriptRegistry = nullptr);

    ~InspectorPanel() override;

    /**
     * @brief Refreshes inspector to show selected entity's components
     * @details Called automatically when selection changes
     */
    void refresh();

    /**
     * @brief Updates editor values from component data without rebuilding
     * @details Should be called each frame to sync with external changes
     */
    void syncEditorValues();

    // =========================================================================
    // Widget Interface
    // =========================================================================

    void render(ui::UIBatchRenderer& renderer) override;

private:
    void buildUI();
    void rebuildInspector();
    void clearInspector();

    struct SectionWidgets {
        ui::Panel* section = nullptr;
        ui::Panel* content = nullptr;
        ui::Label* chevron = nullptr;
    };

    SectionWidgets createComponentSection(const std::string& name, const std::string& icon);
    void toggleSection(const std::string& name);
    void updateSectionVisibility(const std::string& name, SectionWidgets& widgets);

    // Component editors
    void addNameEditor(Entity entity);
    void addLocalTransformEditor(Entity entity);
    void addCameraEditor(Entity entity);
    void addSpriteEditor(Entity entity);
    void addTagsEditor(Entity entity);
    void addScriptComponentEditors(Entity entity);

    ecs::Registry& registry_;
    EntitySelection& selection_;
    CommandHistory& history_;
    ScriptComponentRegistry* scriptRegistry_ = nullptr;

    ui::Panel* rootPanel_ = nullptr;
    ui::Panel* headerPanel_ = nullptr;
    ui::Label* entityIconLabel_ = nullptr;
    ui::Label* entityNameLabel_ = nullptr;
    ui::Label* entityIdLabel_ = nullptr;
    ui::Label* componentCountLabel_ = nullptr;
    ui::ScrollView* scrollView_ = nullptr;
    ui::Panel* contentPanel_ = nullptr;

    std::unordered_set<std::string> collapsedSections_;
    std::unordered_map<std::string, SectionWidgets> sectionWidgets_;

    Entity currentEntity_ = INVALID_ENTITY;
    u32 selectionListenerId_ = 0;

    ConnectionHolder editorConnections_;
    ConnectionHolder toolbarConnections_;

    Vector3Editor* positionEditor_ = nullptr;
    Vector3Editor* rotationEditor_ = nullptr;
    Vector3Editor* scaleEditor_ = nullptr;

    // Toolbar buttons
    ui::Button* addComponentButton_ = nullptr;
    ui::Button* lockButton_ = nullptr;
    ui::Button* debugButton_ = nullptr;
    ui::Button* settingsButton_ = nullptr;

    void connectToolbarButtons();
    void onAddComponentClicked();
};

}  // namespace esengine::editor
