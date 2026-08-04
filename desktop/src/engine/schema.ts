// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getComponentRegistry, getUserComponents, getComponent, getComponentAssetFieldDescriptors, getComponentSkeletalFieldDescriptor, getComponentFieldMeta, Light2DType, usesStagger, isHexOrientation } from 'esengine';
import type { App, SceneData } from 'esengine';
import type { NodeKind, EntityId, InspectorField, EnumOption, GradientValue, CurveValue } from '@/types';
import { t } from '@/i18n';

type SceneEntityLike = SceneData['entities'][number];

// Shared engine-schema utilities. The set of components and their data shape are
// owned by the ENGINE: `getComponentRegistry()` enumerates every registered
// component, and each component's `_default` describes its (JS-side) fields.
// The editor only adds presentation policy (what to hide, labels, order) and
// infers an editable control per field from its live value shape.
//
// Note: PTR_LAYOUTS (the C++ heap layout) is intentionally NOT used for fields —
// it can diverge from the JS data shape that world.get/set operate on. A field's
// control is inferred from its live value shape; the one ambiguity is {x,y,z,w},
// which is a rotation quaternion OR a vec4 (Camera `viewport`, a 9-slice border) —
// see isQuaternion.

export type WorldT = App['world'];
/**
 * Read-only projection of the engine World: the query surface, with no mutators.
 * EngineHost hands this out by default so reflection / picking / stats can read
 * the live world but cannot write it — a write must go through the one mutable
 * door (EngineHost.mutableWorld, used only by SceneCommands and bulk scene load).
 * Adding a method here is the deliberate way to widen the read surface.
 */
export type ReadonlyWorldT = Pick<
  WorldT,
  'valid' | 'has' | 'get' | 'getAllEntities' | 'getEntitiesWithComponents' | 'entityCount' | 'getWorldVersion'
>;
export type AnyComp = Parameters<WorldT['has']>[1];

// — Presentation policy (editor-side, not engine schema) —

// Structural/relationship components that drive the tree, not the inspector —
// plus UIController/UIGear, whose authoring surface is the Controllers panel and
// the Details gear dots (their array-of-object data has no generic field control).
const HIDDEN_COMPONENTS = new Set(['Parent', 'Children', 'Name', 'UIController', 'UIGear', 'EventBinding']);
// Which components the Outliner's eye reaches: hiding an entity forces the enable
// flag off on each of them (see Reconciler.foldHidden). Disabling a NON-render
// component (physics, audio, a script) turns that behaviour off without hiding
// anything, so those must stay out.
//
// The scene-space renderables are DERIVED, not listed: a component that names a
// sorting layer is a thing the renderer draws in scene order, which is exactly the
// set the eye has to reach. That derivation is what a hand-kept list kept getting
// wrong — DragonBonesAnimation, Mesh2D and TrailRenderer were all renderables the
// eye silently skipped, and every future one would have joined them.
const SORTING_LAYER_SOURCE = 'sortingLayers';
// The rest, which the registry gives no such marker for and so are named here:
//   BitmapText  — draws in a sorting layer, but its `layer` field predates the
//                 named-layer dropdown, so it carries no enumSource.
//   UIVisual    — UI draws in tree order, not a sorting layer.
//   Text        — same, and it has no enable flag of its own (a no-op fold, kept
//                 so adding one later doesn't quietly change what the eye covers).
//   Light2D / ShadowCaster2D — not drawn, but a hidden entity must stop LIGHTING
//                 and shadowing the scene too, not just stop drawing its own pixels.
const EXTRA_RENDER_COMPONENTS = new Set(['BitmapText', 'UIVisual', 'Text', 'Light2D', 'ShadowCaster2D']);
const renderComponentCache = new Map<string, boolean>();

/** Whether a component's enable flag participates in the entity's render visibility. */
export function isRenderComponent(name: string): boolean {
  const cached = renderComponentCache.get(name);
  if (cached !== undefined) return cached;
  const def = registryDef(name);
  const meta = def ? getComponentFieldMeta(name) : {};
  const drawsInLayer = Object.values(meta).some((f) => f.enumSource === SORTING_LAYER_SOURCE);
  const result = drawsInLayer || EXTRA_RENDER_COMPONENTS.has(name);
  // A name the registry doesn't know yet (a project component registered later)
  // isn't memoised — its answer would be a guess made before it existed.
  if (def) renderComponentCache.set(name, result);
  return result;
}
// Computed world-space mirrors on Transform — never editable.
const DERIVED_FIELDS = new Set(['worldPosition', 'worldRotation', 'worldScale']);
// Inspector display order; anything not listed follows in registration order.
const ORDER = ['Transform', 'Camera', 'Sprite', 'ShapeRenderer', 'SpineAnimation'];

const registryDef = (name: string): AnyComp | undefined =>
  getComponent(name) as unknown as AnyComp | undefined;

export function componentByName(name: string): AnyComp | undefined {
  return registryDef(name);
}

/** A component's registered default field values (the `_default` describing its shape). */
export function componentDefaults(def: AnyComp): Record<string, unknown> {
  return (def as unknown as { _default: Record<string, unknown> })._default;
}

/**
 * A component's default field values BY NAME — the engine registry's `_default`,
 * else a project component's extracted schema, else `{}`.
 *
 * Scene data stores only what was authored, so a field can be absent from a
 * component's data and still have a value: its default. Anything reading "what
 * this field is right now" (the inspector's effective view, a slice write's merge
 * base) has to resolve through this, or it sees a hole where there is a value.
 */
export function defaultDataFor(compType: string): Record<string, unknown> {
  const def = componentByName(compType);
  return (def ? componentDefaults(def) : userSchema(compType)?.default) ?? {};
}

/** The component's entity-reference fields (source-id-valued in scene data), [] if none. */
export function componentEntityFields(def: AnyComp | undefined): readonly string[] {
  return (def as unknown as { entityFields?: readonly string[] } | undefined)?.entityFields ?? [];
}

/** Entity-ref fields for any component — the builtin registry OR, for a project
 *  component, its extracted schema. Drives the inspector's entity picker. */
export function entityFieldsOf(compType: string): readonly string[] {
  const def = componentByName(compType);
  return def ? componentEntityFields(def) : (userSchema(compType)?.entityFields ?? []);
}

// Add-Component picker categories, in display order (the picker is grouped by
// category). Editor-side presentation policy — the engine has no category metadata
// today, so builtins are mapped/heuristic'd here; user/script components are
// authoritatively bucketed under "Scripts" via the engine's getUserComponents().
export const CATEGORY_ORDER = [
  'Common',
  'Rendering',
  'Physics',
  'Animation',
  'UI',
  'Audio',
  'Effects',
  'Scripts',
  'Other',
] as const;

const COMPONENT_CATEGORY: Record<string, string> = {
  Camera: 'Common',
  Sprite: 'Rendering',
  ShapeRenderer: 'Rendering',
  BitmapText: 'Rendering',
  TilemapLayer: 'Rendering',
  Video: 'Rendering',
  Canvas: 'UI',
  UINode: 'UI',
  UIVisual: 'UI',
  UIMask: 'UI',
  FlexContainer: 'UI',
  SafeArea: 'UI',
  Interactable: 'UI',
  Focusable: 'UI',
  Draggable: 'UI',
  TextInput: 'UI',
  ThemeStyle: 'UI',
  UIController: 'UI',
  UIGear: 'UI',
  SpineAnimation: 'Animation',
  ParticleEmitter: 'Effects',
  RigidBody: 'Physics',
};

/**
 * Classify a component into an Add-Component picker category. `isUser` (an
 * engine-authoritative flag from getUserComponents) wins first — project/script
 * components always land under "Scripts", never a name-heuristic bucket. Builtins
 * use the explicit map, then name heuristics, then "Other".
 */
export function componentCategory(name: string, isUser = false): string {
  if (isUser) return 'Scripts';
  const hit = COMPONENT_CATEGORY[name];
  if (hit) return hit;
  if (/Collider$|Joint$|^RigidBody/.test(name)) return 'Physics';
  if (/Audio|Sound/.test(name)) return 'Audio';
  if (/Particle|Emitter|Trail|PostProcess/.test(name)) return 'Effects';
  if (/Canvas|Widget|Layout|Button|Label/.test(name)) return 'UI';
  if (/Sprite|Render|Mesh|Tilemap|Light|Font|Text(?!ure)/.test(name)) return 'Rendering';
  if (/Anim|Tween|Spine/.test(name)) return 'Animation';
  return 'Other';
}

// — Field value inference (matches the JS data shape world.get/set use) —

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Word-split identifiers with acronym + digit-suffix awareness, so 'UIVisual'
// reads "UI Visual" (not "U I Visual") and 'Light2D' reads "Light 2D" (not "Light2 D").
export const prettyLabel = (key: string) =>
  key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym→word: UIVisual → UI Visual
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase: orthoSize → ortho Size
    .replace(/([a-zA-Z])(\d)/g, '$1 $2') // digit run: Light2D → Light 2D
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

// 2D rotation lives in a quaternion's z/w; surface it as a Z angle in degrees.
const quatToAngleZ = (q: { z: number; w: number }) =>
  Math.round(Math.atan2(q.z, q.w) * 2 * RAD2DEG * 100) / 100;
export const angleZToQuat = (deg: number) => {
  const h = (deg * DEG2RAD) / 2;
  // w-FIRST key order on purpose: the quaternion discriminator treats a w-first
  // layout as a rotation, so a USER component's quaternion field (not named
  // rotation/worldRotation) keeps its angle control after an edit instead of
  // flipping to four vec4 boxes. The engine reads x/y/z/w by name — order is free.
  return { w: Math.cos(h), x: 0, y: 0, z: Math.sin(h) };
};

// A rotation quaternion and a vec4 (Camera viewport rect, a 9-slice border) share the
// exact {x,y,z,w} shape, so value-shape alone can't tell them apart — the engine's only
// quaternions are the Transform rotation and its derived world mirror. Those are surfaced
// as a Z angle; every other 4-component field is four editable numbers. The named set is
// authoritative; a w-first layout (the engine's quaternion order, vs. a vec4's x-first)
// also reads as a quaternion, so a user component's rotation quat renders as an angle
// without a genuine vec4 (which is x-first) ever mis-rendering as a bogus rotation.
const QUAT_FIELDS = new Set(['rotation', 'worldRotation']);
const isQuaternion = (key: string, o: Record<string, number>): boolean =>
  QUAT_FIELDS.has(key) || Object.keys(o)[0] === 'w';

const chan = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n * 255)))
    .toString(16)
    .padStart(2, '0');
/** RGBA (0..1 channels) → `#rrggbbaa` — color fields carry alpha so it's editable. */
const rgbaToHex = (c: { r: number; g: number; b: number; a?: number }) =>
  `#${chan(c.r)}${chan(c.g)}${chan(c.b)}${chan(c.a ?? 1)}`;
/** `#rrggbb` or `#rrggbbaa` → RGBA (0..1); alpha defaults to 1 for a 6-digit hex. */
export const hexToRgba = (hex: string) => {
  const m = /^#?([0-9a-f]{6}([0-9a-f]{2})?)$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1, a: 1 };
  const h = m[1];
  const n = parseInt(h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
};

/** Infer an editable field from a live component value + its key. */
export function inferField(key: string, v: unknown, isColor: boolean): InspectorField | null {
  const label = prettyLabel(key);
  if (isColor && v && typeof v === 'object') {
    return { key, label, type: 'color', value: rgbaToHex(v as { r: number; g: number; b: number; a?: number }) };
  }
  if (typeof v === 'number') return { key, label, type: 'number', value: v };
  if (typeof v === 'boolean') return { key, label, type: 'bool', value: v };
  if (typeof v === 'string') return { key, label, type: 'string', value: v };
  if (v && typeof v === 'object') {
    const o = v as Record<string, number>;
    if ('w' in o && 'z' in o && 'x' in o) {
      return isQuaternion(key, o)
        ? { key, label, type: 'angle', value: quatToAngleZ(o as { z: number; w: number }) }
        : { key, label, type: 'vec4', value: [o.x, o.y ?? 0, o.z, o.w] };
    }
    if ('z' in o && 'x' in o && 'y' in o) return { key, label, type: 'vec3', value: [o.x, o.y, o.z] };
    if ('x' in o && 'y' in o) return { key, label, type: 'vec2', value: [o.x, o.y] };
    // CSS-length shape ({ value, unit }) — the UINode Dimension (width/height/inset/margin).
    if ('value' in o && 'unit' in o) return { key, label, type: 'dimension', value: { value: o.value, unit: o.unit } };
    // Four-edge box ({ left, top, right, bottom }) — FlexContainer / TextInput padding.
    if ('left' in o && 'top' in o && 'right' in o && 'bottom' in o) {
      return { key, label, type: 'sides', value: [o.left, o.top, o.right, o.bottom] };
    }
  }
  return null; // unknown shape — not editable here
}

// — User-component schemas (the `schemas.json` consumer) —
//
// Project/script components never run in the editor realm, so they're absent
// from the engine registry. Their field shapes come from `.esengine/cache/
// schemas.json` (built by electron/extractSchemas.ts). The inspector resolves a
// component's fields from the engine registry (builtins) or, failing that, this
// schema source — and, failing both, infers controls from the stored data
// values themselves so even schema-less components stay editable.

/** A project component's field schema, as serialized in `schemas.json`. */
export interface UserComponentSchema {
  name: string;
  isTag: boolean;
  default: Record<string, unknown>;
  colorKeys: string[];
  /** Asset-ref fields (e.g. `[{field:'texture', type:'texture'}]`). */
  assetFields?: Array<{ field: string; type: string }>;
  /** Entity-reference fields (source-id-valued) — rendered as an entity picker. */
  entityFields?: string[];
  /** Keyframeable field paths (Sequencer tracks). */
  animatableFields?: string[];
  /** Per-field editor metadata (enum + numeric range/unit), keyed by field name. */
  fields?: Record<string, UserFieldMeta>;
}

/** A serialized field's editor metadata, as carried in `schemas.json`. */
export interface UserFieldMeta {
  enum?: EnumOption[];
  enumSource?: string;
  flags?: EnumOption[];
  bitmask?: { bits?: number; source?: string };
  gradient?: boolean;
  curve?: boolean;
  /** Render as a key→value string map editor (arbitrary custom properties). */
  map?: boolean;
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
  unit?: string;
  advanced?: boolean;
  category?: string;
  /** Hover help (UE ToolTip). */
  tooltip?: string;
  /** A display name overriding the key-derived label (UE DisplayName). */
  label?: string;
  /** Must be non-empty (soft — the inspector flags it). Mirrors a future ES_PROPERTY(required). */
  required?: boolean;
}

const userSchemas = new Map<string, UserComponentSchema>();

// Revision bumped whenever the user-component schemas change, so the inspector
// re-renders when a project component is edited live (not only on scene change).
const schemaListeners = new Set<() => void>();
let schemaRevision = 0;
/** Subscribe to user-schema changes (for useSyncExternalStore). */
export const subscribeSchemas = (fn: () => void): (() => void) => {
  schemaListeners.add(fn);
  return () => { schemaListeners.delete(fn); };
};
export const getSchemaRevision = (): number => schemaRevision;

/** Replace the user-component schema source (project open, manual extract, or a
 *  live edit of the project's component sources). Notifies subscribers. */
export function setUserSchemas(schemas: UserComponentSchema[]): void {
  userSchemas.clear();
  for (const s of schemas) userSchemas.set(s.name, s);
  schemaRevision++;
  for (const l of schemaListeners) l();
}

/** The user schema for a component name, if any. */
export function userSchema(name: string): UserComponentSchema | undefined {
  return userSchemas.get(name);
}

/** Every project component the editor knows of, by name.
 *
 * The editor never runs project code, so the engine's own `getUserComponents()`
 * registry holds only what the EDITOR realm defined — never the open project's
 * components. `schemas.json` is how a project's components reach the editor, so
 * it is what every surface offering them has to read. */
export function userComponentNames(): string[] {
  return [...userSchemas.keys()];
}

/** Whether a component field renders as a color (registry colorKeys, then schema). */
export function isColorKey(compType: string, key: string): boolean {
  const def = componentByName(compType);
  if (def) return new Set<string>(def.colorKeys).has(key);
  return new Set(userSchema(compType)?.colorKeys ?? []).has(key);
}

// — Asset-ref fields (which component fields hold a texture/material/font/... ref) —
//
// Single source of truth: engine components carry their asset-field descriptors on
// the component def (codegen for C++ components, defineComponent for plugin ones) —
// the SAME descriptors the runtime scene loader resolves, so the inspector and the
// runtime never diverge. User/script components (absent from the engine registry)
// declare theirs in schemas.json. The inspector renders these as an asset control,
// not a raw `@uuid:` string.

/** The asset kind a component field holds (texture/material/font/...), or null. */
export function assetFieldType(compType: string, key: string): string | null {
  for (const d of getComponentAssetFieldDescriptors(compType)) if (d.field === key) return d.type;
  for (const f of userSchema(compType)?.assetFields ?? []) if (f.field === key) return f.type;
  return null;
}

/**
 * The spine slot a component field holds, or null. Spine skeleton/atlas are
 * PATH-VALUED asset refs: the component def carries them as a compound spine
 * descriptor (the pair loads together through the SpineManager), not as
 * handle-valued assetFields — so the World keeps the string and the Reconciler
 * must never handle-resolve them. The slot names match the SDK's
 * EditorAssetType spellings, which is what the asset picker filters on.
 */
export type SpineSlotType = 'spine-skeleton' | 'spine-atlas';
export function spineSlotType(compType: string, key: string): SpineSlotType | null {
  const d = getComponentSkeletalFieldDescriptor(compType);
  if (!d) return null;
  if (key === d.skeletonField) return 'spine-skeleton';
  if (key === d.atlasField) return 'spine-atlas';
  return null;
}

/** Keyframeable field paths of a component — builtin via the engine registry, user
 *  components via their serialized schema (so both are first-class Sequencer tracks). */
export function animatableFieldsFor(compType: string): readonly string[] {
  const builtin = getComponent(compType);
  if (builtin) return builtin.animatableFields ?? [];
  return userSchema(compType)?.animatableFields ?? [];
}

/** Engine-COMPUTED output fields (authored `readonly` at the C++ ES_PROPERTY site —
 *  e.g. Transform's worldPosition/worldRotation/worldScale). The reconciler must not
 *  push the model's stale value for these: the engine composes them each frame, so a
 *  write clobbers the live value. User components have none. */
export function readonlyFieldsFor(compType: string): readonly string[] {
  return getComponent(compType)?.readonlyFields ?? [];
}

// — Field presentation metadata (the SDK's UPROPERTY analog) —
//
// A component declares per-field editor policy (enum options, numeric range,
// step, slider, unit) at its definition site, so e.g. Camera.projectionType
// renders as a "Perspective / Orthographic" dropdown and TilemapLayer.opacity as
// a 0..1 slider — and the enum labels can never drift from the engine's enum
// constants. Builtins resolve via the engine registry; user/script components
// (absent from it) declare theirs in schemas.json.

/** Merged per-field metadata: the engine component def first, then the user schema. */
export function fieldMetaFor(compType: string, key: string): UserFieldMeta | null {
  const fromDef = getComponentFieldMeta(compType)[key];
  if (fromDef) {
    return {
      enum: fromDef.enum?.map((o) => ({ label: o.label, value: o.value })),
      enumSource: fromDef.enumSource,
      flags: fromDef.flags?.map((o) => ({ label: o.label, value: o.value })),
      bitmask: fromDef.bitmask,
      gradient: fromDef.gradient,
      curve: fromDef.curve,
      map: fromDef.map,
      min: fromDef.min,
      max: fromDef.max,
      step: fromDef.step,
      slider: fromDef.slider,
      unit: fromDef.unit,
      advanced: fromDef.advanced,
      category: fromDef.category,
      tooltip: fromDef.tooltip,
      label: fromDef.label,
    };
  }
  return userSchema(compType)?.fields?.[key] ?? null;
}

/**
 * Clamp a scalar field value to its declared min/max (if any). Applied at the single
 * write door (SceneCommands.setField) so EVERY writer — the inspector, PlayInspect and
 * material edits — is range-bounded, not just the Details UI's own clamp.
 */
export function clampFieldValue(compType: string, key: string, value: unknown): unknown {
  if (typeof value !== 'number') return value;
  const meta = fieldMetaFor(compType, key);
  if (!meta || (meta.min === undefined && meta.max === undefined)) return value;
  return Math.max(meta.min ?? -Infinity, Math.min(meta.max ?? Infinity, value));
}

// Editor-side non-empty (required) fields, until ES_PROPERTY(required) lowers this to
// the SDK like min/max (§7). These are asset-ref fields whose entity is meaningless
// without them — a Sprite with no texture, a SpineAnimation with no skeleton/atlas.
const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  Sprite: ['texture'],
  SpineAnimation: ['skeletonPath', 'atlasPath'],
  AudioSource: ['clip'],
};

/** Whether a field must be non-empty (builtin table, then user schema). Soft — the
 *  inspector flags an empty value; nothing blocks the edit. */
export function isRequiredField(compType: string, key: string): boolean {
  if (REQUIRED_FIELDS[compType]?.includes(key)) return true;
  return userSchema(compType)?.fields?.[key]?.required === true;
}

/** The ONE emptiness predicate for required fields — an unset asset ref is the
 *  numeric 0 handle sentinel, an unset string is ''. Consumed by the Details
 *  panel's red flag AND the surface's getDiagnostics sweep, so what automation
 *  gates on is exactly what the UI shows. */
export function isRequiredEmpty(value: unknown): boolean {
  return value === 0 || value === '' || value == null;
}

// Editor-side "Advanced" fold policy — rarely-tuned fields moved below the fold so a
// component's common controls stay uncluttered. UINode's flex-item knobs (min/max,
// grow/shrink/basis, cross-axis alignSelf) are set far less than its size/anchor.
const ADVANCED_FIELDS: Record<string, readonly string[]> = {
  UINode: ['minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf'],
};

/** Whether a field lives under the "Advanced" fold (builtin table OR its own metadata). */
export function isAdvancedField(compType: string, key: string): boolean {
  return ADVANCED_FIELDS[compType]?.includes(key) === true;
}

/** A four-sided box: the field keys for a spatial L/R/T/B editor (margin, offsets). */
export interface BoxGroupDef {
  label: string;
  left: string;
  right: string;
  top: string;
  bottom: string;
}

// Editor-side box-model grouping — four related edge fields that read best as one
// spatial control (a 2×2 of sides) instead of four near-identical rows. The keys
// still flow through the same per-field write path, so undo / mixed / reset are
// unchanged; only the layout is compound.
const BOX_GROUPS: Record<string, readonly BoxGroupDef[]> = {
  UINode: [
    { label: 'Margin', left: 'marginLeft', right: 'marginRight', top: 'marginTop', bottom: 'marginBottom' },
    { label: 'Offset', left: 'insetLeft', right: 'insetRight', top: 'insetTop', bottom: 'insetBottom' },
  ],
};

/** The spatial box-model groups a component's edge fields collapse into, if any. */
export function boxGroupsFor(compType: string): readonly BoxGroupDef[] {
  return BOX_GROUPS[compType] ?? [];
}

/** The dropdown options for an enum field, or null if the field isn't an enum. */
export function enumFieldOptions(compType: string, key: string): EnumOption[] | null {
  const e = fieldMetaFor(compType, key)?.enum;
  return e && e.length ? e.map((o) => ({ ...o })) : null;
}

// Editor-registered bit-label providers for bitmask fields (e.g. project collision
// layers). The component def only marks a field a bitmask + names a source; the
// labels are project-scoped, so the project layer injects them here.
const bitmaskSources = new Map<string, () => EnumOption[]>();
/** Register (or clear) a named source of bitmask bit labels. */
export function setBitmaskSource(name: string, provider: (() => EnumOption[]) | null): void {
  if (provider) bitmaskSources.set(name, provider);
  else bitmaskSources.delete(name);
}

// — Dynamic enum sources —
//
// The ONE door for "this field's choices are not knowable at definition time".
// A component names a source on the field (`enum_source=` in its C++ declaration,
// `enumSource` in schemas.json); the editor registers what that name yields. The
// field becomes a dropdown while its source answers, and stays a plain editable
// field while it doesn't — so free editing survives a source that isn't warm yet
// (a skeleton still being read) or isn't installed at all (a headless host).
//
// Options are values, not indices: a sorting layer is an int, an animation name
// is the string itself (see EnumOption). Both flow through the same control and
// the same write path.
/**
 * A provider is handed the component's own values AND the entity being inspected,
 * because option sets differ in where they come from:
 * - project facts ignore both (sorting layers);
 * - what an entity REFERENCES comes from the data (which armatures exist depends
 *   on the file this component's `skeletonPath` points at, so two entities of one
 *   component type legitimately answer differently);
 * - what an entity has LOADED comes from the id (a spine skeleton's animation
 *   list lives in the runtime instance bound to that entity).
 *
 * `entity` is absent where no single entity is on screen (a prefab diff, a test).
 */
export type EnumOptionProvider = (
  data: Readonly<Record<string, unknown>>,
  entity?: EntityId,
) => EnumOption[];

/**
 * Whether a source's options are the ONLY legal values, which is a property of
 * the thing being named and not of how it is spelled:
 *
 * - EXHAUSTIVE — a spine animation, a DragonBones armature. The names come out of
 *   the referenced file; one that isn't in it is a typo, and the editor should
 *   refuse it rather than store a reference to nothing.
 * - not exhaustive — a sorting layer (the names are aliases over an i32 the
 *   renderer sorts on regardless), a locale key (binding one before its entry
 *   exists is the normal authoring order). The options are SUGGESTIONS.
 *
 * Declared here once because both writers need the same answer: the inspector,
 * to decide whether the control may accept a value outside the list, and
 * coerceFieldValue, for the same decision on the MCP/agent path. That answer
 * used to be guessed independently from whether the value was a string, which
 * happened to be right for the skeleton sources and wrong for locale keys.
 */
export interface EnumSourceOptions {
  exhaustive: boolean;
}

const enumSources = new Map<string, { provider: EnumOptionProvider; exhaustive: boolean }>();
/** Register a named source of dynamic enum options. */
export function setEnumSource(name: string, provider: EnumOptionProvider, opts: EnumSourceOptions): void;
/** Clear a named source. */
export function setEnumSource(name: string, provider: null): void;
export function setEnumSource(name: string, provider: EnumOptionProvider | null, opts?: EnumSourceOptions): void {
  if (provider) enumSources.set(name, { provider, exhaustive: opts?.exhaustive ?? true });
  else enumSources.delete(name);
}
/** Whether values outside `name`'s options are illegal. Unknown sources answer
 *  true, but offer no options either, so the field stays freely editable. */
export function isEnumSourceExhaustive(name: string): boolean {
  return enumSources.get(name)?.exhaustive ?? true;
}
function enumSourceOptions(
  name: string,
  data: Readonly<Record<string, unknown>>,
  entity?: EntityId,
): EnumOption[] {
  return enumSources.get(name)?.provider(data, entity) ?? [];
}
/** The bit options for a bitmask field: its source's labels, else `Layer N`. */
function bitmaskOptions(meta: { bits?: number; source?: string }): EnumOption[] {
  const src = meta.source ? bitmaskSources.get(meta.source) : undefined;
  if (src) return src();
  const bits = meta.bits ?? 32;
  return Array.from({ length: bits }, (_, i) => ({ label: `Layer ${i}`, value: 1 << i }));
}

/**
 * Build one inspector field: an **asset control** for asset-ref fields (carrying
 * the `@uuid:` ref or 0 for none), else a value-shape-inferred control.
 */
function fieldFor(
  compType: string,
  key: string,
  value: unknown,
  isColor: boolean,
  data: Readonly<Record<string, unknown>> = {},
  entity?: EntityId,
): InspectorField | null {
  const meta = fieldMetaFor(compType, key);
  const at = assetFieldType(compType, key) ?? spineSlotType(compType, key);
  let field: InspectorField | null;
  if (at) {
    // Refs pass through; NUMBERS pass through too — a live realm snapshot holds
    // handles, and coercing a non-zero handle to 0 made the required-empty rule
    // flag a perfectly-loaded asset red. 0/other stays the empty sentinel.
    const v = typeof value === 'string' ? value : typeof value === 'number' ? value : 0;
    field = { key, label: prettyLabel(key), type: 'asset', value: v, assetType: at };
  } else if (entityFieldsOf(compType).includes(key)) {
    // An entity-reference field (a joint's connectedEntity, or a project
    // component's): a scene-entity picker, not a raw number. Value = source id.
    field = { key, label: prettyLabel(key), type: 'entity', value: typeof value === 'number' ? value : 0 };
  } else if (meta?.gradient) {
    const g = value && typeof value === 'object' && Array.isArray((value as GradientValue).stops) ? (value as GradientValue) : { stops: [] };
    field = { key, label: prettyLabel(key), type: 'gradient', value: g };
  } else if (meta?.curve) {
    const c = value && typeof value === 'object' && Array.isArray((value as CurveValue).keys) ? (value as CurveValue) : { keys: [] };
    field = { key, label: prettyLabel(key), type: 'curve', value: c };
  } else if (meta?.map) {
    // Arbitrary string→string map (Marker.properties). Normalize every value to a string
    // so the editor never chokes on a stray non-string import.
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const m: Record<string, string> = {};
    for (const k of Object.keys(raw)) m[k] = String(raw[k]);
    field = { key, label: prettyLabel(key), type: 'map', value: m };
  } else if (meta?.bitmask) {
    field = { key, label: prettyLabel(key), type: 'flags', value: Number(value) || 0, options: bitmaskOptions(meta.bitmask) };
  } else if (meta?.flags && meta.flags.length) {
    field = { key, label: prettyLabel(key), type: 'flags', value: Number(value) || 0, options: meta.flags.map((o) => ({ ...o })) };
  } else if (meta?.enum && meta.enum.length) {
    field = { key, label: prettyLabel(key), type: 'enum', value: Number(value) || 0, options: meta.enum.map((o) => ({ ...o })) };
  } else if (meta?.enumSource && enumSourceOptions(meta.enumSource, data, entity).length) {
    const options = enumSourceOptions(meta.enumSource, data, entity);
    // A string-valued source names things; coercing through Number would turn
    // every option into NaN and the field into a broken 0.
    const stringly = typeof options[0].value === 'string';
    const v = stringly ? (typeof value === 'string' ? value : '') : (Number(value) || 0);
    field = { key, label: prettyLabel(key), type: 'enum', value: v, options };
    // Suggestions, not a closed set — the control lets a value outside them in.
    if (!isEnumSourceExhaustive(meta.enumSource)) field.open = true;
  } else {
    field = inferField(key, value, isColor);
    if (field && field.type === 'number' && meta) {
      if (meta.min != null) field.min = meta.min;
      if (meta.max != null) field.max = meta.max;
      if (meta.step != null) field.step = meta.step;
      if (meta.unit != null) field.unit = meta.unit;
      if (meta.slider && meta.min != null && meta.max != null) field.slider = true;
    }
  }
  // Presentation policy that applies to any field type (folds, category, help text,
  // and a DisplayName override of the key-derived label).
  if (field && (meta?.advanced || isAdvancedField(compType, key))) field.advanced = true;
  if (field && meta?.category) field.category = meta.category;
  if (field && meta?.tooltip) field.tooltip = meta.tooltip;
  if (field && meta?.label) field.label = meta.label;
  if (field && isRequiredField(compType, key)) field.required = true;
  return field;
}

/**
 * The editable fields of a component from the MODEL's stored data. Field shape
 * comes from (in order): the engine registry, the user schema, or — as a
 * best-effort fallback — the data values themselves; asset-ref fields become an
 * asset control. `DERIVED_FIELDS` are skipped.
 *
 * Each field also carries `defaultValue` — the value a reset reverts to — taken
 * from `baseData` (the prefab-instance base, when given) else the component's
 * registered default. The caller diffs `value` vs `defaultValue` to mark
 * overrides; an entity with no prefab base just compares against the default.
 */
// Fields that only apply to some states of the SAME component — hidden from the
// inspector when inert so the panel shows just the controls that matter, gated on a
// sibling discriminator field's live value. Each rule hides ONLY a field that is
// definitively meaningless in the current state (never one that merely defaults),
// so switching the discriminator back brings the field (and its stored value) right
// back. `data` here is the effective view (stored values over registered defaults),
// so a discriminator omitted from the stored data still resolves.
function isConditionallyHidden(compType: string, key: string, data: Record<string, unknown>): boolean {
  switch (compType) {
    case 'TilemapLayer': {
      const orientation = Number(data.orientation) || 0;
      if (key === 'hexSideLength') return !isHexOrientation(orientation);
      if (key === 'staggerAxis' || key === 'staggerIndex') return !usesStagger(orientation);
      return false;
    }
    case 'Camera': {
      // projectionType: Perspective = 0, Orthographic = 1.
      const ortho = Number(data.projectionType) === 1;
      if (key === 'fov') return ortho;            // an ortho projection has no field of view
      if (key === 'orthoSize') return !ortho;     // ortho-only half-height
      if (key === 'pixelPerfect') return !ortho;  // pixel snap is an ortho pixel-art concern
      return false;
    }
    case 'Light2D': {
      // type: Point = 0, Directional = 1, Ambient = 2, Spot = 3.
      const type = Number(data.type) || 0;
      if (key === 'radius') return type === 1 || type === 2;    // Point / Spot reach only
      if (key === 'direction') return type === 0 || type === 2; // Directional / Spot aim only
      if (key === 'innerAngle' || key === 'outerAngle') return type !== 3; // Spot cone only
      if (key === 'shadowDistance') return type !== 1;          // Directional shadow only
      if (key === 'shadowSoftness') return type === 2;          // Ambient casts no shadow
      return false;
    }
    case 'ParticleEmitter': {
      // shape: Point = 0, Circle = 1, Rectangle = 2, Cone = 3 (Circle & Cone use the
      // radius; Rectangle the size; Cone the angle — see the emitter shape gizmo).
      const shape = Number(data.shape) || 0;
      if (key === 'shapeRadius') return shape === 0 || shape === 2;
      if (key === 'shapeSize') return shape !== 2;
      if (key === 'shapeAngle') return shape !== 3;
      // A disabled trail / floor collision hides its whole tuning block.
      if (key === 'trailWidth' || key === 'trailPoints' || key === 'trailMinDistance') {
        return data.trailEnabled === false;
      }
      if (key === 'collisionFloor' || key === 'collisionBounce' || key === 'collisionFriction' || key === 'collisionLifetimeLoss') {
        return data.collisionEnabled === false;
      }
      return false;
    }
    default:
      return false;
  }
}

export function inspectorFields(
  compType: string,
  data: Record<string, unknown>,
  baseData?: Record<string, unknown>,
  /** The entity being inspected — reaches enum sources whose options come from
   *  its LOADED runtime state (a spine skeleton's animations). */
  entity?: EntityId,
): InspectorField[] {
  const def = componentByName(compType);
  const schema = def ? undefined : userSchema(compType);
  const colorKeys = new Set<string>(def ? def.colorKeys : (schema?.colorKeys ?? []));
  const defaults = def ? componentDefaults(def) : schema?.default;
  // Field order: the registered / schema defaults; else the stored data's keys.
  const keys = defaults ? Object.keys(defaults) : Object.keys(data);
  // Effective values (stored data over registered defaults) — a conditional-visibility
  // discriminator (projection / light type / emitter shape) may be omitted from the
  // stored `data` when it equals its default, so resolve against defaults here.
  const eff = defaults ? { ...defaults, ...data } : data;
  const fields: InspectorField[] = [];
  for (const key of keys) {
    if (DERIVED_FIELDS.has(key)) continue;
    if (isConditionallyHidden(compType, key, eff)) continue;
    const value = key in data ? data[key] : defaults?.[key];
    const f = fieldFor(compType, key, value, colorKeys.has(key), eff, entity);
    if (!f) continue;
    // Reset target: the prefab base for this key, else the registered default.
    const baseRaw = baseData && key in baseData ? baseData[key] : defaults?.[key];
    if (baseRaw !== undefined) {
      const bf = fieldFor(compType, key, baseRaw, colorKeys.has(key), eff, entity);
      if (bf) f.defaultValue = bf.value;
    }
    fields.push(f);
  }
  return fields;
}

// The boolean field a component's header enable-checkbox toggles: `enabled` for
// most, `isActive` (Camera) / `visible` (TilemapLayer) for the few that name it
// differently. Promoted to the header (and hidden from the body field list) — the
// UE per-component enable affordance. Null when the component can't be disabled
// (Transform, Canvas), where the header shows a static, non-interactive check.
const ENABLE_KEYS = ['enabled', 'isActive', 'visible'] as const;

/** The component's enable field + current value, or null if it has none. */
export function componentEnable(
  compType: string,
  data: Record<string, unknown>,
): { key: string; value: boolean } | null {
  const def = componentByName(compType);
  const defaults = def ? componentDefaults(def) : userSchema(compType)?.default;
  const src = defaults ?? data;
  for (const key of ENABLE_KEYS) {
    if (typeof src[key] === 'boolean') {
      const raw = key in data ? data[key] : src[key];
      return { key, value: raw !== false };
    }
  }
  return null;
}

// — Model-based reflection (the editor reads the model, not the World) —

const orderIndex = (name: string): number => {
  const i = ORDER.indexOf(name);
  return i === -1 ? ORDER.length : i;
};

/** A source entity's editable component types (name + label), in display order. */
export function modelInspectableComponents(
  entity: SceneEntityLike,
): Array<{ name: string; label: string }> {
  return entity.components
    .filter((c) => !HIDDEN_COMPONENTS.has(c.type))
    .map((c) => ({ name: c.type, label: prettyLabel(c.type) }))
    .sort((a, b) => orderIndex(a.name) - orderIndex(b.name));
}

/**
 * Add-Component candidates for a source entity: registered components not yet on
 * it, plus user (schemas.json) components absent from both the entity and the
 * engine registry. Transform / structural components are excluded.
 */
export function modelAddableComponentEntries(
  entity: SceneEntityLike,
): Array<{ name: string; label: string; category: string }> {
  const present = new Set(entity.components.map((c) => c.type));
  const userNames = new Set(getUserComponents().keys());
  const out: Array<{ name: string; label: string; category: string }> = [];
  for (const [name, def] of getComponentRegistry()) {
    if (HIDDEN_COMPONENTS.has(name) || name === 'Transform' || present.has(name)) continue;
    if (def.transient) continue; // runtime-only state is never authorable
    out.push({ name, label: prettyLabel(name), category: componentCategory(name, userNames.has(name)) });
  }
  for (const name of userSchemas.keys()) {
    if (present.has(name) || componentByName(name)) continue;
    out.push({ name, label: prettyLabel(name), category: 'Scripts' });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

// Light2D types whose contribution samples the entity's world position (the
// engine skips them without a Transform); Ambient/Directional need none.
const POSITIONAL_LIGHT_TYPES = new Set([Light2DType.Point, Light2DType.Spot]);

/**
 * A contextual inspector notice for a component on an entity — an entity state
 * that leaves the component silently inert, surfaced so the silence is
 * explainable (e.g. the render path skips a positional light with no Transform).
 */
export function componentNotice(compType: string, entity: SceneEntityLike): string | null {
  // A UINode's placement is LAYOUT-owned: the layout pass writes the resolved box
  // into Transform.position every relayout, so editing it here holds only until the
  // next UI change and then snaps back. Said only once the scene actually CARRIES an
  // authored position — that dead value is the symptom someone is chasing ("I dragged
  // it and nothing moved"). Every well-formed UI node simply omits the field, and a
  // notice true of all of them would be noise on the card and in the diagnostics sweep.
  if (compType === 'Transform' && entity.components.some((c) => c.type === 'UINode')) {
    const d = entity.components.find((c) => c.type === 'Transform')?.data as
      | Record<string, unknown>
      | undefined;
    return d && d.position !== undefined ? t('det.noticeUILayoutOwnsPosition') : null;
  }
  // Text align/verticalAlign resolve against a layout box, which only a UINode (laid
  // out under a Canvas) provides. Without one the text anchors to the entity origin —
  // surfaced when the user has actually set an alignment, so the behavior is explained.
  if (compType === 'Text') {
    if (!entity.components.some((c) => c.type === 'UINode')) {
      const d = entity.components.find((c) => c.type === 'Text')?.data as
        | { align?: number; verticalAlign?: number }
        | undefined;
      if ((d?.align ?? 0) !== 0 || (d?.verticalAlign ?? 0) !== 0) return t('det.noticeTextNoLayoutBox');
    }
    return null;
  }
  const hasTransform = entity.components.some((c) => c.type === 'Transform');
  if (hasTransform) return null;
  if (compType === 'Light2D') {
    const data = entity.components.find((c) => c.type === compType)?.data as { type?: number } | undefined;
    if (POSITIONAL_LIGHT_TYPES.has(Number(data?.type ?? 0))) return t('det.noticeLightNeedsTransform');
  }
  if (compType === 'ShadowCaster2D') return t('det.noticeShadowNeedsTransform');
  return null;
}

/** Outliner icon kind for a source entity (which components it carries). */
export function modelKindOf(entity: SceneEntityLike): NodeKind {
  const types = new Set(entity.components.map((c) => c.type));
  if (types.has('Camera')) return 'camera';
  if (types.has('Light2D')) return 'light';
  // One kind for both: to someone scanning the outliner a Spine armature and a
  // DragonBones one are the same sort of thing, and a second identical icon would
  // be a distinction the reader cannot use.
  if (types.has('SpineAnimation') || types.has('DragonBonesAnimation')) return 'skeletal';
  if (types.has('Canvas') || types.has('BitmapText')) return 'ui';
  if (types.has('Sprite') || types.has('ShapeRenderer') || types.has('TilemapLayer')) return 'sprite';
  if (types.has('ParticleEmitter')) return 'sprite';
  if (entity.children.length > 0) return 'group';
  return 'empty';
}

/** Display name for a source entity (its name, or a kind-derived fallback). */
export function modelNameOf(entity: SceneEntityLike, kind: NodeKind): string {
  return entity.name || `${cap(kind)} ${entity.id}`;
}

