import type { SceneData } from '../types/SceneTypes';
import type { AssetSelection } from '../store/EditorStore';

// =============================================================================
// Tauri Event Channels
// =============================================================================

export const CHANNEL_STATE = 'editor:state';
export const CHANNEL_ACTION = 'editor:action';
export const CHANNEL_ACTION_RESULT = 'editor:action-result';
export const CHANNEL_PANEL_OPENED = 'editor:panel-opened';
export const CHANNEL_PANEL_CLOSED = 'editor:panel-closed';
export const CHANNEL_OUTPUT = 'editor:output';
export const CHANNEL_PROFILER_STATS = 'editor:profiler-stats';
export const CHANNEL_FRAME_DEBUGGER_DATA = 'editor:frame-debugger-data';
export const CHANNEL_FRAME_DEBUGGER_REPLAY_REQ = 'editor:frame-debugger-replay-req';
export const CHANNEL_FRAME_DEBUGGER_SNAPSHOT = 'editor:frame-debugger-snapshot';
export const CHANNEL_EXTENSIONS_DATA = 'editor:extensions-data';
export const CHANNEL_EXTENSIONS_TOGGLE = 'editor:extensions-toggle';
export const CHANNEL_EXTENSIONS_RELOAD = 'editor:extensions-reload';
export const CHANNEL_EXTENSIONS_REQUEST = 'editor:extensions-request';

// =============================================================================
// State Snapshot
// =============================================================================

export interface SerializedEditorState {
    scene: SceneData;
    selectedEntities: number[];
    selectedAsset: AssetSelection | null;
    isDirty: boolean;
    filePath: string | null;
    canUndo: boolean;
    canRedo: boolean;
    isEditingPrefab: boolean;
    prefabEditingPath: string | null;
    sceneVersion: number;
}

// =============================================================================
// Action Messages
// =============================================================================

export type ActionType =
    | 'selectEntity'
    | 'selectEntities'
    | 'selectAsset'
    | 'createEntity'
    | 'deleteEntity'
    | 'deleteSelectedEntities'
    | 'renameEntity'
    | 'reparentEntity'
    | 'moveEntity'
    | 'addComponent'
    | 'removeComponent'
    | 'reorderComponent'
    | 'updateProperty'
    | 'updateProperties'
    | 'updatePropertyDirect'
    | 'toggleVisibility'
    | 'undo'
    | 'redo';

export interface ActionMessage {
    id: string;
    type: ActionType;
    args: unknown[];
}

export interface ActionResultMessage {
    id: string;
    result?: unknown;
    error?: string;
}

// =============================================================================
// Panel Messages
// =============================================================================

export interface PanelOpenedMessage {
    panelId: string;
    windowLabel: string;
}

export interface PanelClosedMessage {
    panelId: string;
    windowLabel: string;
}

// =============================================================================
// Output Messages
// =============================================================================

export type OutputType = 'command' | 'stdout' | 'stderr' | 'error' | 'success';

export interface OutputMessage {
    text: string;
    type: OutputType;
}

// =============================================================================
// Profiler Stats Messages
// =============================================================================

export interface ProfilerStatsMessage {
    frameTimeMs: number;
    phaseTimings: [string, number][];
    systemTimings: [string, number][];
}

// =============================================================================
// Frame Debugger Messages
// =============================================================================

export interface FrameDebuggerDataMessage {
    drawCalls: import('esengine').DrawCallInfo[];
    cameraCount: number;
}

export interface FrameDebuggerReplayReqMessage {
    drawCallIndex: number;
}

export interface FrameDebuggerSnapshotMessage {
    dataUrl: string;
    width: number;
    height: number;
}

// =============================================================================
// Extensions Messages
// =============================================================================

export interface ExtensionDataMessage {
    plugins: ExtensionPluginData[];
    reloading: boolean;
}

export interface ExtensionPluginData {
    id: string;
    type: 'local' | 'npm';
    name: string;
    version?: string;
    description?: string;
    status: 'loaded' | 'error' | 'disabled';
    error?: string;
}

export interface ExtensionToggleMessage {
    pluginId: string;
}

export interface ExtensionReloadMessage {}
