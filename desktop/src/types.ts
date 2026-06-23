// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
  | 'color'
  | 'enum' // an int field with named options, shown as a dropdown
  | 'asset'; // a texture/material/font/... ref (@uuid: string, or 0 for none)

/** A dropdown option for an `enum` field: the label shown, the int stored. */
export interface EnumOption {
  label: string;
  value: number;
}

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
  /** For `type: 'asset'` — the asset kind (texture/material/font/...). */
  assetType?: string;
  /** For `type: 'enum'` — the selectable options (label + stored int). */
  options?: EnumOption[];
  /**
   * The value this field resets to — the prefab-instance base if the entity is a
   * prefab instance, else the component's registered default. Absent when no base
   * is known. `value !== defaultValue` ⇒ the field is "modified" (override).
   */
  defaultValue?: InspectorFieldValue;
  // — Numeric presentation (number fields only) —
  /** Hard range; clamps both typed entry and drag-scrub. */
  min?: number;
  max?: number;
  /** Scrub/step granularity (defaults to 0.1 per pixel). */
  step?: number;
  /** Render as a slider; set only when `min`/`max` are both finite. */
  slider?: boolean;
  /** Unit shown after the resting value (e.g. '°', 'px'). */
  unit?: string;
}

export interface InspectorComponent {
  /** engine component name, e.g. 'Transform' */
  name: string;
  label: string;
  fields: InspectorField[];
  /**
   * The component's enable toggle — its `enabled`/`isActive`/`visible` field +
   * current value — surfaced in the header (and hidden from `fields`). Absent for
   * components that can't be disabled (e.g. Transform).
   */
  enable?: { key: string; value: boolean };
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
  | 'script'
  | 'animation'
  | 'tileset'
  | 'tilemap'
  | 'file';

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
