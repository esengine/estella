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
#include "../../events/Connection.hpp"

#include <unordered_set>

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
     */
    InspectorPanel(ecs::Registry& registry,
                  EntitySelection& selection,
                  CommandHistory& history);

    ~InspectorPanel() override;

    /**
     * @brief Refreshes inspector to show selected entity's components
     * @details Called automatically when selection changes
     */
    void refresh();

    // =========================================================================
    // Widget Interface
    // =========================================================================

    void render(ui::UIBatchRenderer& renderer) override;

private:
    void buildUI();
    void rebuildInspector();
    void clearInspector();

    ui::Panel* createComponentSection(const std::string& name, const std::string& icon);
    void toggleSection(const std::string& name);

    // Component editors
    void addNameEditor(Entity entity);
    void addLocalTransformEditor(Entity entity);
    void addCameraEditor(Entity entity);
    void addSpriteEditor(Entity entity);
    void addTagsEditor(Entity entity);

    ecs::Registry& registry_;
    EntitySelection& selection_;
    CommandHistory& history_;

    ui::Panel* rootPanel_ = nullptr;
    ui::Panel* headerPanel_ = nullptr;
    ui::Label* entityNameLabel_ = nullptr;
    ui::ScrollView* scrollView_ = nullptr;
    ui::Panel* contentPanel_ = nullptr;

    std::unordered_set<std::string> collapsedSections_;

    Entity currentEntity_ = INVALID_ENTITY;
    u32 selectionListenerId_ = 0;

    ConnectionHolder editorConnections_;
};

}  // namespace esengine::editor
