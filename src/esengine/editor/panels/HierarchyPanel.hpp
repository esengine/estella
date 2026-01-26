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
     * @brief Called when entity selection changes externally
     * @param previous Previous selection
     * @param current Current selection
     */
    void onSelectionChanged(const std::vector<Entity>& previous,
                            const std::vector<Entity>& current);

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

    // =========================================================================
    // Member Variables
    // =========================================================================

    ecs::Registry& registry_;
    EntitySelection& selection_;

    ui::TreeView* treeView_ = nullptr;

    // Bidirectional mapping between entities and tree nodes
    std::unordered_map<ui::TreeNodeId, Entity> nodeToEntity_;
    std::unordered_map<Entity, ui::TreeNodeId> entityToNode_;

    // Settings
    bool showOrphans_ = true;
    bool needsRebuild_ = false;

    // Event connections
    Connection selectionChangedConnection_;
    Connection nodeSelectedConnection_;
    Connection nodeDoubleClickedConnection_;
};

}  // namespace esengine::editor
