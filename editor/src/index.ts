/**
 * @file    index.ts
 * @brief   ESEngine Web Editor exports
 */

// =============================================================================
// Editor
// =============================================================================

export { Editor, createEditor } from './Editor';

// =============================================================================
// Error Handling
// =============================================================================

export { ErrorBoundary, createErrorFallback, installGlobalErrorHandler } from './error';
export type { ErrorBoundaryOptions } from './error';

// =============================================================================
// Logging
// =============================================================================

export { EditorLogger, createConsoleHandler, createToastHandler } from './logging';
export type { LogLevel, LogEntry, LogHandler } from './logging';

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
    type DirtyFlag,
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
    registerBuiltinPanels,
} from './panels';

// =============================================================================
// Panel Registry
// =============================================================================

export {
    type PanelPosition,
    type PanelDescriptor,
    type PanelFactory,
    type PanelInstance,
    type PanelHooks,
    type PanelFactoryResult,
    registerPanel,
    getPanel,
    getAllPanels,
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
    TransformSchema,
    SpriteSchema,
    CameraSchema,
    TextSchema,
    registerComponentSchema,
    getComponentSchema,
    getAllComponentSchemas,
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
    registerContextMenuItem,
    getContextMenuItems,
    type ContextMenuLocation,
    type ContextMenuContext,
    type ContextMenuContribution,
} from './ui/ContextMenuRegistry';

// =============================================================================
// Inspector Registry
// =============================================================================

export {
    registerInspectorSection,
    registerComponentInspector,
    getInspectorSections,
    getComponentInspector,
    type InspectorContext,
    type InspectorSectionDescriptor,
    type InspectorSectionInstance,
    type ComponentInspectorDescriptor,
    type ComponentInspectorContext,
    type ComponentInspectorInstance,
} from './panels/inspector/InspectorRegistry';

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

export { AssetPathResolver, getGlobalPathResolver, getAssetDatabase } from './asset';

// =============================================================================
// Math
// =============================================================================

export { quatToEuler, eulerToQuat, type TransformValue } from './math/Transform';

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
    type ProjectLauncherOptions,
    type CreateProjectOptions,
    type ProjectServiceResult,
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
// IoC Container
// =============================================================================

export {
    type PluginRegistrar,
    EditorContainer,
    getEditorContainer,
} from './container';

export * as tokens from './container/tokens';

// =============================================================================
// Plugins
// =============================================================================

export type { EditorPlugin, EditorPluginContext } from './plugins/EditorPlugin';

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

// =============================================================================
// Multi-Window
// =============================================================================

export {
    RemoteEditorStore,
    MainWindowBridge,
    WindowManager,
    serializeEditorState,
    CHANNEL_STATE,
    CHANNEL_ACTION,
    CHANNEL_ACTION_RESULT,
    CHANNEL_PANEL_OPENED,
    CHANNEL_PANEL_CLOSED,
    CHANNEL_OUTPUT,
    CHANNEL_PROFILER_STATS,
    type SerializedEditorState,
    type ActionType,
    type ActionMessage,
    type ActionResultMessage,
    type PanelOpenedMessage,
    type PanelClosedMessage,
    type OutputType,
    type OutputMessage,
    type ProfilerStatsMessage,
} from './multiwindow';
