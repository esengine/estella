// Shared editor domain types. These mirror the shapes the engine bridge
// (CoreApiBridge / generated EditorAPI) will eventually supply, so panels are
// written against the real contract from day one — the mock layer just fills it.

export type EntityId = number;

export type NodeKind =
  | 'camera'
  | 'sprite'
  | 'spine'
  | 'physics'
  | 'ui'
  | 'audio'
  | 'group'
  | 'light'
  | 'empty';

export interface SceneNode {
  id: EntityId;
  name: string;
  kind: NodeKind;
  visible: boolean;
  locked: boolean;
  children?: SceneNode[];
}

// — Inspector model: built from live engine component data via introspection —
export type InspectorFieldType =
  | 'number'
  | 'bool'
  | 'string'
  | 'vec2'
  | 'vec3'
  | 'angle' // 2D rotation: a quaternion shown/edited as Z degrees
  | 'color';

export type InspectorFieldValue =
  | number
  | boolean
  | string
  | [number, number]
  | [number, number, number];

export interface InspectorField {
  /** key in the component data object */
  key: string;
  label: string;
  type: InspectorFieldType;
  value: InspectorFieldValue;
}

export interface InspectorComponent {
  /** engine component name, e.g. 'Transform' */
  name: string;
  label: string;
  fields: InspectorField[];
}

export type AssetType =
  | 'folder'
  | 'scene'
  | 'sprite'
  | 'texture'
  | 'spine'
  | 'audio'
  | 'prefab'
  | 'material'
  | 'script';

export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  time: string;
  source: string;
  message: string;
}

export type ToolMode = 'select' | 'move' | 'rotate' | 'scale';
