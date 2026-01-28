/**
 * @file    HierarchyPanel.hpp
 * @brief   Hierarchy panel for scene entity management
 * @details Displays all entities in the scene in a tree view, showing
 *          parent-child relationships and allowing entity selection.
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
#include "../../ui/widgets/TreeView.hpp"
#include "../../ui/widgets/ScrollView.hpp"
#include "../../ui/widgets/Panel.hpp"
#include "../../ui/widgets/TextField.hpp"
#include "../../ui/widgets/Button.hpp"
#include "../../ui/widgets/Label.hpp"
#include "../../ui/widgets/ContextMenu.hpp"
#include "../../ecs/Registry.hpp"
#include "../core/Selection.hpp"
#include "../../events/Connection.hpp"

#include <unordered_map>

namespace esengine::editor {

// =============================================================================
// HierarchyPanel Class
// =============================================================================

/**
 * @brief Hierarchy panel for displaying and managing scene entities
 *
 * @details HierarchyPanel provides a tree view of all entities in the scene.
 *          It displays:
 *          - Entity names (from Name component)
 *          - Parent-child relationships (from Parent/Children components)
 *          - Selection state (synchronized with EntitySelection)
 *
 *          The panel automatically updates when entities are created, destroyed,
 *          or modified.
 *
 * @code
 * auto hierarchyPanel = makeUnique<HierarchyPanel>(registry, selection);
 * hierarchyPanel->setPanelType("Hierarchy");
 * dockArea->addPanel(std::move(hierarchyPanel));
 * @endcode
 */
class HierarchyPanel : public ui::DockPanel {
public:
    /**
     * @brief Constructs a hierarchy panel
     * @param registry The ECS registry to display
     * @param selection The entity selection manager
     */
    HierarchyPanel(ecs::Registry& registry, EntitySelection& selection);

    ~HierarchyPanel() override;

    /**
     * @brief Refreshes the tree view from the registry
     *
     * @details Rebuilds the entire tree structure from scratch.
     *          Call this after batch entity operations.
     */
    void refresh();

    /**
     * @brief Sets whether to show entities without Parent component as roots
     * @param showOrphans True to show orphaned entities at root level
     */
    void setShowOrphans(bool showOrphans);

    /**
     * @brief Returns true if showing orphaned entities
     */
    bool getShowOrphans() const { return showOrphans_; }

    void render(ui::UIBatchRenderer& renderer) override;
    bool onMouseDown(const ui::MouseButtonEvent& event) override;
    bool onKeyDown(const ui::KeyEvent& event) override;

protected:
    void onActivated() override;
    void onDeactivated() override;

private:
    // =========================================================================
    // Tree Building
    // =========================================================================

    /**
     * @brief Rebuilds the tree from registry state
     */
    void rebuildTree();

    /**
     * @brief Adds an entity to the tree
     * @param entity Entity to add
     * @param parentNodeId Parent tree node (INVALID_TREE_NODE for root)
     */
    ui::TreeNodeId addEntityToTree(Entity entity, ui::TreeNodeId parentNodeId);

    /**
     * @brief Gets the display name for an entity
     * @param entity Entity to get name for
     * @return Display name (Name component or "Entity {id}")
     */
    std::string getEntityDisplayName(Entity entity) const;

    /**
     * @brief Gets the icon for an entity based on its components
     * @param entity Entity to get icon for
     * @return Icon Unicode character or empty string for default
     */
    std::string getEntityIcon(Entity entity) const;

    /**
     * @brief Gets the type name for an entity based on its components
     * @param entity Entity to get type for
     * @return Type name string
     */
    std::string getEntityType(Entity entity) const;

    // =========================================================================
    // Event Handlers
    // =========================================================================

    /**
     * @brief Called when a tree node is selected
     * @param nodeId Selected node ID
     */
    void onNodeSelected(ui::TreeNodeId nodeId);

    /**
     * @brief Called when a tree node is double-clicked
     * @param nodeId Clicked node ID
     */
    void onNodeDoubleClicked(ui::TreeNodeId nodeId);

    /**
     * @brief Called when a tree node is right-clicked
     * @param nodeId Clicked node ID
     * @param x Screen X position
     * @param y Screen Y position
     */
    void onNodeRightClicked(ui::TreeNodeId nodeId, f32 x, f32 y);

    /**
     * @brief Handles context menu item selection
     * @param itemId Selected menu item ID
     */
    void onContextMenuItemSelected(const std::string& itemId);

    /**
     * @brief Called when entity selection changes externally
     * @param previous Previous selection
     * @param current Current selection
     */
    void onSelectionChanged(const std::vector<Entity>& previous,
                            const std::vector<Entity>& current);

    void createEntity();
    void createChildEntity(Entity parent);
    void createFolder();
    void deleteSelectedEntity();
    void renameSelectedEntity();
    void updateStatusBar();

    // =========================================================================
    // Mapping Helpers
    // =========================================================================

    /**
     * @brief Gets the entity for a tree node
     * @param nodeId Tree node ID
     * @return Entity or INVALID_ENTITY if not found
     */
    Entity getEntityForNode(ui::TreeNodeId nodeId) const;

    /**
     * @brief Gets the tree node for an entity
     * @param entity Entity
     * @return Tree node ID or INVALID_TREE_NODE if not found
     */
    ui::TreeNodeId getNodeForEntity(Entity entity) const;

    void buildUI();
    void onSearchTextChanged(const std::string& text);

    // =========================================================================
    // Member Variables
    // =========================================================================

    ecs::Registry& registry_;
    EntitySelection& selection_;

    ui::Panel* rootPanel_ = nullptr;
    ui::Panel* toolbar_ = nullptr;
    ui::Button* addEntityButton_ = nullptr;
    ui::Button* createFolderButton_ = nullptr;
    ui::TextField* searchField_ = nullptr;
    ui::Panel* columnHeader_ = nullptr;
    ui::ScrollView* scrollView_ = nullptr;
    ui::TreeView* treeView_ = nullptr;
    ui::Panel* statusBar_ = nullptr;
    ui::Label* entityCountLabel_ = nullptr;

    Unique<ui::ContextMenu> contextMenu_;
    Entity contextMenuTargetEntity_ = INVALID_ENTITY;

    // Bidirectional mapping between entities and tree nodes
    std::unordered_map<ui::TreeNodeId, Entity> nodeToEntity_;
    std::unordered_map<Entity, ui::TreeNodeId> entityToNode_;

    std::string searchFilter_;

    // Settings
    bool showOrphans_ = true;
    bool needsRebuild_ = false;
    bool processingSelection_ = false;

    // Event connections
    Connection selectionChangedConnection_;
    Connection nodeSelectedConnection_;
    Connection nodeDoubleClickedConnection_;
    Connection nodeRightClickedConnection_;
    Connection searchChangedConnection_;
    Connection addEntityClickedConnection_;
    Connection createFolderClickedConnection_;
    Connection contextMenuItemSelectedConnection_;
    Connection contextMenuClosedConnection_;
};

}  // namespace esengine::editor
