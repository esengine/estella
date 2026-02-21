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
