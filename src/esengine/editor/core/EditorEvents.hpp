/**
 * @file    EditorEvents.hpp
 * @brief   Editor event definitions
 * @details Defines all event types used by the editor for communication
 *          between components. Events are pure data structures that carry
 *          information about state changes.
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

#include "../../core/Types.hpp"

#include <string>
#include <vector>

namespace esengine::editor {

// =============================================================================
// Selection Events
// =============================================================================

/**
 * @brief Fired when an entity is selected
 */
struct EntitySelected {
    Entity entity;
    bool additive;
};

/**
 * @brief Fired when selection is cleared
 */
struct SelectionCleared {};

/**
 * @brief Fired when selection changes
 */
struct SelectionChanged {
    std::vector<Entity> previousSelection;
    std::vector<Entity> currentSelection;
};

// =============================================================================
// Entity Lifecycle Events
// =============================================================================

/**
 * @brief Fired when a new entity is created
 */
struct EntityCreated {
    Entity entity;
    std::string name;
};

/**
 * @brief Fired when an entity is about to be deleted
 */
struct EntityDeleting {
    Entity entity;
};

/**
 * @brief Fired after an entity is deleted
 */
struct EntityDeleted {
    Entity entity;
};

/**
 * @brief Fired when an entity is renamed
 */
struct EntityRenamed {
    Entity entity;
    std::string oldName;
    std::string newName;
};

/**
 * @brief Fired when entity hierarchy changes
 */
struct EntityHierarchyChanged {
    Entity entity;
    Entity oldParent;
    Entity newParent;
};

// =============================================================================
// Component Events
// =============================================================================

/**
 * @brief Fired when a component is added to an entity
 */
struct ComponentAdded {
    Entity entity;
    TypeId componentType;
};

/**
 * @brief Fired when a component is removed from an entity
 */
struct ComponentRemoved {
    Entity entity;
    TypeId componentType;
};

/**
 * @brief Fired when a component is modified
 */
struct ComponentModified {
    Entity entity;
    TypeId componentType;
    std::string propertyName;
};

// =============================================================================
// Scene Events
// =============================================================================

/**
 * @brief Fired when a new scene is created
 */
struct SceneCreated {
    std::string name;
};

/**
 * @brief Fired when a scene is about to be loaded
 */
struct SceneLoading {
    std::string path;
};

/**
 * @brief Fired when a scene has finished loading
 */
struct SceneLoaded {
    std::string path;
    bool success;
};

/**
 * @brief Fired when a scene is about to be saved
 */
struct SceneSaving {
    std::string path;
};

/**
 * @brief Fired when a scene has been saved
 */
struct SceneSaved {
    std::string path;
    bool success;
};

/**
 * @brief Fired when the scene is marked as modified
 */
struct SceneModified {};

// =============================================================================
// Editor State Events
// =============================================================================

/**
 * @brief Editor play mode states
 */
enum class PlayMode : u8 {
    Edit,
    Play,
    Pause
};

/**
 * @brief Fired when play mode changes
 */
struct PlayModeChanged {
    PlayMode previousMode;
    PlayMode currentMode;
};

/**
 * @brief Fired when undo/redo occurs
 */
struct UndoRedoEvent {
    bool isUndo;
    std::string commandDescription;
};

/**
 * @brief Fired when undo/redo history changes
 */
struct HistoryChanged {
    bool canUndo;
    bool canRedo;
    std::string undoDescription;
    std::string redoDescription;
};

// =============================================================================
// Project Events
// =============================================================================

/**
 * @brief Fired when a project is opened
 */
struct ProjectOpened {
    std::string path;
    std::string name;
};

/**
 * @brief Fired when a project is closed
 */
struct ProjectClosed {};

/**
 * @brief Fired when project settings change
 */
struct ProjectSettingsChanged {};

// =============================================================================
// Asset Events
// =============================================================================

/**
 * @brief Fired when an asset is imported
 */
struct AssetImported {
    std::string path;
    std::string type;
};

/**
 * @brief Fired when an asset is deleted
 */
struct AssetDeleted {
    std::string path;
};

/**
 * @brief Fired when an asset is renamed
 */
struct AssetRenamed {
    std::string oldPath;
    std::string newPath;
};

/**
 * @brief Fired when an asset is selected in the browser
 */
struct AssetSelected {
    std::string path;
};

// =============================================================================
// UI Events
// =============================================================================

/**
 * @brief Fired when a panel gains focus
 */
struct PanelFocused {
    std::string panelId;
};

/**
 * @brief Fired when a panel is opened
 */
struct PanelOpened {
    std::string panelId;
};

/**
 * @brief Fired when a panel is closed
 */
struct PanelClosed {
    std::string panelId;
};

/**
 * @brief Fired when the layout changes
 */
struct LayoutChanged {};

/**
 * @brief Fired when theme changes
 */
struct ThemeChanged {
    std::string themeName;
};

// =============================================================================
// Tool Events
// =============================================================================

/**
 * @brief Editor tool types
 */
enum class EditorTool : u8 {
    Select,
    Move,
    Rotate,
    Scale,
    Rect
};

/**
 * @brief Fired when the active tool changes
 */
struct ToolChanged {
    EditorTool previousTool;
    EditorTool currentTool;
};

/**
 * @brief Fired when gizmo mode changes
 */
struct GizmoModeChanged {
    bool isLocal;
};

/**
 * @brief Fired when snap settings change
 */
struct SnapSettingsChanged {
    bool snapEnabled;
    float snapValue;
};

}  // namespace esengine::editor
