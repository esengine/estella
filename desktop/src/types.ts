// SPDX-License-Identifier: Apache-2.0
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
  | 'vec4' // four editable numbers (Camera viewport rect, a 9-slice border) — NOT a rotation quaternion (see 'angle')
  | 'vec2list' // a whole Vec2[] written at once (polygon vertices / chain points) — viewport vertex drag
  | 'angle' // 2D rotation: a quaternion shown/edited as Z degrees
  | 'color'
  | 'enum' // an int field with named options, shown as a dropdown
  | 'select' // a string field with a fixed choice set, shown as a dropdown
  | 'flags' // an int bitmask, shown as a multi-select of its bits
  | 'gradient' // a color-over-life gradient ({ stops: [...] })
  | 'curve' // a scalar over-life curve ({ keys: [...] })
  | 'map' // an arbitrary key→value string map (Marker.properties) — Tiled-style custom props
  | 'dimension' // a CSS-style length ({ value, unit }) — UINode box/inset fields
  | 'sides' // a four-edge box ({ left, top, right, bottom }) — FlexContainer/TextInput padding
  | 'asset' // a texture/material/font/... ref (@uuid: string, or 0 for none)
  | 'entity'; // a reference to another scene entity (source id, or 0/INVALID for none)

/** A dropdown option for an `enum` field: the label shown, the int stored. */
export interface EnumOption {
  label: string;
  value: number;
}

/** One stop of a `gradient` field: a 0..1 position + an RGBA color (0..1 channels). */
export interface GradientStop {
  t: number;
  color: { r: number; g: number; b: number; a: number };
}
/** A `gradient` field's value — color stops over [0,1]. */
export interface GradientValue {
  stops: GradientStop[];
}

/** One key of a `curve` field: a 0..1 position + a scalar value. */
export interface CurveKey {
  t: number;
  v: number;
}
/** A `curve` field's value — scalar keys over [0,1] (piecewise-linear). */
export interface CurveValue {
  keys: CurveKey[];
}

/** A CSS-style length ({ value, unit }) — the UINode Dimension wire shape. */
export interface DimensionValue {
  value: number;
  unit: number;
}

/** A `map` field's value — an arbitrary key→value string map (Marker custom properties). */
export type MapValue = Record<string, string>;

export type InspectorFieldValue =
  | number
  | boolean
  | string
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | GradientValue
  | CurveValue
  | DimensionValue
  | MapValue;

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
  /** For `type: 'select'` — the selectable string values. */
  selectOptions?: string[];
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
  /** A rarely-edited field — tucked behind the component's "Advanced" fold. */
  advanced?: boolean;
  /** Groups the field under a collapsible category header (UE's property categories). */
  category?: string;
  /** Hover help for the property (UE's UPROPERTY ToolTip). */
  tooltip?: string;
  /** Must be non-empty; the inspector flags an empty value (soft — doesn't block the edit). */
  required?: boolean;
  /**
   * Multi-selection: the selected entities disagree on this field's value. `value`
   * holds the primary entity's value (shown muted); an edit fans out to all.
   */
  mixed?: boolean;
  /**
   * Multi-selection, vector fields only: which axes actually disagree. Lets the
   * inspector show `—` on just the differing axis (Y) while a shared axis (X)
   * still shows its value, instead of masking the whole vector.
   */
  mixedAxes?: boolean[];
}

export interface InspectorComponent {
  /** engine component name, e.g. 'Transform' */
  name: string;
  label: string;
  fields: InspectorField[];
  /**
   * The component's enable toggle — its `enabled`/`isActive`/`visible` field +
   * current value — surfaced in the header (and hidden from `fields`). Absent for
   * components that can't be disabled (e.g. Transform). `mixed` ⇒ a multi-selection
   * disagrees (value is the primary's).
   */
  enable?: { key: string; value: boolean; mixed?: boolean };
  /**
   * A contextual heads-up shown under the component header — an entity state
   * that leaves the component silently inert (e.g. a Point light with no
   * Transform to position it). Informational, not an error.
   */
  notice?: string;
}

/**
 * A generic inspection source an editor pushes so its own sub-object selection
 * (an open timeline's clip settings, a track, a tileset slice…) renders in the
 * one shared Details inspector — no bespoke property panel. Consulted as a
 * FALLBACK: an entity/asset/folder selection always wins over it.
 * `subscribe`/`getRevision` drive a live re-render on the source's own edits;
 * `build` yields the components and `write` routes edits back to the source doc.
 */
export interface InspectSource {
  title: string;
  subscribe: (onChange: () => void) => () => void;
  getRevision: () => number;
  build: () => InspectorComponent[];
  write: (key: string, type: InspectorFieldType, value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue | MapValue) => void;
  /**
   * When true this is an explicit sub-object selection (a keyframe, a track) and
   * OVERRIDES the entity/asset inspector. Default (false) is a fallback — shown
   * only when nothing else is selected (an open document's clip-level settings).
   */
  override?: boolean;
}

/**
 * The asset types the editor ships. Kept as a closed union so `ASSET_TYPES` stays an
 * exhaustive record — a built-in type with no badge/icon entry is a compile error,
 * which is the guard that catches a half-added type.
 */
export type BuiltinAssetType =
  | 'folder'
  | 'scene'
  | 'sprite'
  | 'texture'
  | 'spine'
  | 'audio'
  | 'video'
  | 'prefab'
  | 'material'
  | 'materialgraph'
  | 'shader'
  | 'script'
  | 'animation'
  | 'animclip'
  | 'tileset'
  | 'tilemap'
  | 'inputmap'
  | 'statemachine'
  | 'animatorcontroller'
  | 'behaviortree'
  | 'locale'
  | 'file';

/** A built-in asset type, or one a plugin contributed. */
export type AssetType = BuiltinAssetType | (string & {});

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
