/**
 * @file    index.ts
 * @brief   ESEngine Web Editor exports
 */

// =============================================================================
// Editor
// =============================================================================

export { Editor, createEditor } from './Editor';

// =============================================================================
// Types
// =============================================================================

export {
    type SceneData,
    type EntityData,
    type ComponentData,
    type SelectionState,
    type ViewportState,
    createEmptyScene,
    createEntityData,
} from './types';

// =============================================================================
// Store
// =============================================================================

export {
    EditorStore,
    getEditorStore,
    resetEditorStore,
    type EditorState,
    type EditorListener,
} from './store';

// =============================================================================
// Commands
// =============================================================================

export {
    type Command,
    BaseCommand,
    PropertyCommand,
    CreateEntityCommand,
    DeleteEntityCommand,
    ReparentCommand,
    AddComponentCommand,
    RemoveComponentCommand,
    CommandHistory,
} from './commands';

// =============================================================================
// Panels
// =============================================================================

export {
    HierarchyPanel,
    InspectorPanel,
    SceneViewPanel,
} from './panels';

// =============================================================================
// Property Editors
// =============================================================================

export {
    type PropertyMeta,
    type PropertyEditorContext,
    type PropertyEditorFactory,
    type PropertyEditorInstance,
    registerPropertyEditor,
    getPropertyEditor,
    createPropertyEditor,
    registerBuiltinEditors,
} from './property';

// =============================================================================
// Schemas
// =============================================================================

export {
    type ComponentSchema,
    LocalTransformSchema,
    SpriteSchema,
    CameraSchema,
    TextSchema,
    registerComponentSchema,
    getComponentSchema,
    getAllComponentSchemas,
    registerBuiltinSchemas,
} from './schemas';

// =============================================================================
// Bridge
// =============================================================================

export { EditorBridge } from './bridge';

// =============================================================================
// IO
// =============================================================================

export {
    SceneSerializer,
    saveSceneToFile,
    loadSceneFromFile,
    loadSceneFromPath,
} from './io';

// =============================================================================
// Launcher
// =============================================================================

export {
    ProjectLauncher,
    NewProjectDialog,
    createProject,
    openProject,
    openProjectDialog,
    selectProjectLocation,
    getRecentProjects,
    loadProjectConfig,
    type ProjectLauncherOptions,
    type CreateProjectOptions,
    type ProjectServiceResult,
} from './launcher';

// =============================================================================
// Project Types
// =============================================================================

export {
    type ProjectConfig,
    type RecentProject,
    type ProjectTemplate,
    PROJECT_TEMPLATES,
    PROJECT_FILE_EXTENSION,
    SCENE_FILE_EXTENSION,
    ENGINE_VERSION,
} from './types/ProjectTypes';

// =============================================================================
// Styles
// =============================================================================

export { EDITOR_STYLES_URL, injectEditorStyles } from './styles';
