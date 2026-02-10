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
    OutputPanel,
} from './panels';

// =============================================================================
// Panel Registry
// =============================================================================

export {
    type PanelPosition,
    type PanelDescriptor,
    type PanelFactory,
    type PanelInstance,
    type Resizable,
    type BridgeAware,
    type AppAware,
    type AssetServerProvider,
    type AssetNavigable,
    type OutputAppendable,
    registerPanel,
    getPanel,
    getAllPanels,
    isResizable,
    isBridgeAware,
    isAppAware,
    isAssetServerProvider,
    isAssetNavigable,
    isOutputAppendable,
    isSpineControllerAware,
} from './panels/PanelRegistry';

// =============================================================================
// Gizmo Registry
// =============================================================================

export {
    type GizmoContext,
    type GizmoDescriptor,
    GizmoManager,
    registerGizmo,
    getGizmo,
    getAllGizmos,
} from './gizmos';

// =============================================================================
// Menu Registry
// =============================================================================

export {
    type MenuDescriptor,
    type MenuItemDescriptor,
    type StatusbarItemDescriptor,
    registerMenu,
    registerMenuItem,
    registerStatusbarItem,
    getAllMenus,
    getMenuItems,
} from './menus/MenuRegistry';

export { ShortcutManager } from './menus/ShortcutManager';

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
// Bounds
// =============================================================================

export {
    type Bounds,
    type BoundsProvider,
    registerBoundsProvider,
    getEntityBounds,
} from './bounds';

// =============================================================================
// Events
// =============================================================================

export {
    type AssetEvent,
    type AssetCategory,
    type AssetEventType,
    type AssetEventListener,
    AssetEventBus,
    getAssetEventBus,
} from './events/AssetEventBus';

// =============================================================================
// UI
// =============================================================================

export {
    showContextMenu,
    hideContextMenu,
    type ContextMenuItem,
    type ContextMenuOptions,
} from './ui/ContextMenu';

export {
    showToast,
    showSuccessToast,
    showErrorToast,
    showProgressToast,
    updateToast,
    dismissToast,
    type ToastOptions,
    type ToastAction,
} from './ui/Toast';

// =============================================================================
// Utils
// =============================================================================

export { icons } from './utils/icons';

// =============================================================================
// Asset
// =============================================================================

export { AssetPathResolver, getGlobalPathResolver } from './asset';

// =============================================================================
// Math
// =============================================================================

export { quatToEuler, eulerToQuat, type Transform } from './math/Transform';

// =============================================================================
// Content Browser
// =============================================================================

export { ContentBrowserPanel } from './panels/ContentBrowserPanel';

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
    showProjectSettingsDialog,
    type ProjectLauncherOptions,
    type CreateProjectOptions,
    type ProjectServiceResult,
    type ProjectSettingsDialogOptions,
} from './launcher';

// =============================================================================
// Project Types
// =============================================================================

export {
    type ProjectConfig,
    type SpineVersion,
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

// =============================================================================
// Platform
// =============================================================================

export {
    type PlatformAdapter,
    type FileDialogOptions,
    type SaveDialogOptions,
    WebPlatformAdapter,
    setPlatformAdapter,
    getPlatformAdapter,
} from './platform/PlatformAdapter';

// =============================================================================
// Dialog
// =============================================================================

export {
    Dialog,
    showDialog,
    showInputDialog,
    showConfirmDialog,
    showAlertDialog,
    type DialogRole,
    type DialogButton,
    type DialogOptions,
    type DialogResult,
    type InputDialogOptions,
    type ConfirmDialogOptions,
    type AlertDialogOptions,
} from './ui/dialog';

// =============================================================================
// Context
// =============================================================================

export {
    setEditorContext,
    getEditorContext,
    setEditorInstance,
    getEditorInstance,
    type EditorContextConfig,
    type NativeShell,
} from './context/EditorContext';

export type { NativeFS, DirectoryEntry } from './scripting/types';

// =============================================================================
// Extension
// =============================================================================

export {
    ExtensionLoader,
    EditorExportService,
    type ExtensionLoaderOptions,
} from './extension';

// =============================================================================
// Settings
// =============================================================================

export {
    type SettingsItemType,
    type SettingsSectionDescriptor,
    type SettingsItemDescriptor,
    registerSettingsSection,
    registerSettingsItem,
    getSettingsValue,
    setSettingsValue,
    onSettingsChange,
    getAllSections,
    getSectionItems,
    showSettingsDialog,
} from './settings';

// =============================================================================
// SDK Re-exports
// =============================================================================

export {
    Draw,
    BlendMode,
    type DrawAPI,
    Geometry,
    DataType,
    type GeometryHandle,
    type GeometryOptions,
    type VertexAttributeDescriptor,
    Material,
    ShaderSources,
    type ShaderHandle,
    type MaterialHandle,
    type MaterialOptions,
    type UniformValue,
    PostProcess,
    Renderer,
    RenderStage,
    type RenderTargetHandle,
    type RenderStats,
    RenderPipeline,
    type RenderParams,
    registerDrawCallback,
    unregisterDrawCallback,
    clearDrawCallbacks,
    type DrawCallback,
} from 'esengine';
