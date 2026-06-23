// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { getAllRegisteredComponents, getUserComponents, getComponent, getComponentAssetFieldDescriptors, getComponentFieldMeta } from 'esengine';
import type { App, SceneData } from 'esengine';
import type { NodeKind, InspectorField, EnumOption } from '@/types';

type SceneEntityLike = SceneData['entities'][number];

// Shared engine-schema utilities. The set of components and their data shape are
// owned by the ENGINE: `getComponentRegistry()` enumerates every registered
// component, and each component's `_default` describes its (JS-side) fields.
// The editor only adds presentation policy (what to hide, labels, order) and
// infers an editable control per field from its live value shape.
//
// Note: PTR_LAYOUTS (the C++ heap layout) is intentionally NOT used for fields —
// it can diverge from the JS data shape that world.get/set operate on (e.g.
// Camera packs a vec4 `viewport` where the JS data exposes viewportX/Y/W/H).

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
  'valid' | 'has' | 'get' | 'getAllEntities' | 'getWorldVersion'
>;
export type AnyComp = Parameters<WorldT['has']>[1];

// — Presentation policy (editor-side, not engine schema) —

// Structural/relationship components that drive the tree, not the inspector.
const HIDDEN_COMPONENTS = new Set(['Parent', 'Children', 'Name']);
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
  Canvas: 'UI',
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

export const prettyLabel = (key: string) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

// 2D rotation lives in a quaternion's z/w; surface it as a Z angle in degrees.
const quatToAngleZ = (q: { z: number; w: number }) =>
  Math.round(Math.atan2(q.z, q.w) * 2 * RAD2DEG * 100) / 100;
export const angleZToQuat = (deg: number) => {
  const h = (deg * DEG2RAD) / 2;
  return { x: 0, y: 0, z: Math.sin(h), w: Math.cos(h) };
};

const chan = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n * 255)))
    .toString(16)
    .padStart(2, '0');
const rgbToHex = (c: { r: number; g: number; b: number }) =>
  `#${chan(c.r)}${chan(c.g)}${chan(c.b)}`;
export const hexToRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 1, g: 1, b: 1 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

/** Infer an editable field from a live component value + its key. */
export function inferField(key: string, v: unknown, isColor: boolean): InspectorField | null {
  const label = prettyLabel(key);
  if (isColor && v && typeof v === 'object') {
    return { key, label, type: 'color', value: rgbToHex(v as { r: number; g: number; b: number }) };
  }
  if (typeof v === 'number') return { key, label, type: 'number', value: v };
  if (typeof v === 'boolean') return { key, label, type: 'bool', value: v };
  if (typeof v === 'string') return { key, label, type: 'string', value: v };
  if (v && typeof v === 'object') {
    const o = v as Record<string, number>;
    if ('w' in o && 'z' in o && 'x' in o)
      return { key, label, type: 'angle', value: quatToAngleZ(o as { z: number; w: number }) };
    if ('z' in o && 'x' in o && 'y' in o) return { key, label, type: 'vec3', value: [o.x, o.y, o.z] };
    if ('x' in o && 'y' in o) return { key, label, type: 'vec2', value: [o.x, o.y] };
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
  /** Per-field editor metadata (enum + numeric range/unit), keyed by field name. */
  fields?: Record<string, UserFieldMeta>;
}

/** A serialized field's editor metadata, as carried in `schemas.json`. */
export interface UserFieldMeta {
  enum?: EnumOption[];
  min?: number;
  max?: number;
  step?: number;
  slider?: boolean;
  unit?: string;
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
      min: fromDef.min,
      max: fromDef.max,
      step: fromDef.step,
      slider: fromDef.slider,
      unit: fromDef.unit,
    };
  }
  return userSchema(compType)?.fields?.[key] ?? null;
}

/** The dropdown options for an enum field, or null if the field isn't an enum. */
export function enumFieldOptions(compType: string, key: string): EnumOption[] | null {
  const e = fieldMetaFor(compType, key)?.enum;
  return e && e.length ? e.map((o) => ({ ...o })) : null;
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
): InspectorField | null {
  const at = assetFieldType(compType, key);
  if (at) {
    return {
      key,
      label: prettyLabel(key),
      type: 'asset',
      value: typeof value === 'string' ? value : 0,
      assetType: at,
    };
  }
  const meta = fieldMetaFor(compType, key);
  if (meta?.enum && meta.enum.length) {
    return { key, label: prettyLabel(key), type: 'enum', value: Number(value) || 0, options: meta.enum.map((o) => ({ ...o })) };
  }
  const base = inferField(key, value, isColor);
  if (base && base.type === 'number' && meta) {
    if (meta.min != null) base.min = meta.min;
    if (meta.max != null) base.max = meta.max;
    if (meta.step != null) base.step = meta.step;
    if (meta.unit != null) base.unit = meta.unit;
    if (meta.slider && meta.min != null && meta.max != null) base.slider = true;
  }
  return base;
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
export function inspectorFields(
  compType: string,
  data: Record<string, unknown>,
  baseData?: Record<string, unknown>,
): InspectorField[] {
  const def = componentByName(compType);
  const schema = def ? undefined : userSchema(compType);
  const colorKeys = new Set<string>(def ? def.colorKeys : (schema?.colorKeys ?? []));
  const defaults = def ? componentDefaults(def) : schema?.default;
  // Field order: the registered / schema defaults; else the stored data's keys.
  const keys = defaults ? Object.keys(defaults) : Object.keys(data);
  const fields: InspectorField[] = [];
  for (const key of keys) {
    if (DERIVED_FIELDS.has(key)) continue;
    const value = key in data ? data[key] : defaults?.[key];
    const f = fieldFor(compType, key, value, colorKeys.has(key));
    if (!f) continue;
    // Reset target: the prefab base for this key, else the registered default.
    const baseRaw = baseData && key in baseData ? baseData[key] : defaults?.[key];
    if (baseRaw !== undefined) {
      const bf = fieldFor(compType, key, baseRaw, colorKeys.has(key));
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
  for (const [name] of getAllRegisteredComponents()) {
    if (HIDDEN_COMPONENTS.has(name) || name === 'Transform' || present.has(name)) continue;
    out.push({ name, label: prettyLabel(name), category: componentCategory(name, userNames.has(name)) });
  }
  for (const name of userSchemas.keys()) {
    if (present.has(name) || componentByName(name)) continue;
    out.push({ name, label: prettyLabel(name), category: 'Scripts' });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Outliner icon kind for a source entity (which components it carries). */
export function modelKindOf(entity: SceneEntityLike): NodeKind {
  const types = new Set(entity.components.map((c) => c.type));
  if (types.has('Camera')) return 'camera';
  if (types.has('SpineAnimation')) return 'spine';
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

/** A source entity reads as hidden if any component is explicitly disabled. */
export function modelIsVisible(entity: SceneEntityLike): boolean {
  for (const c of entity.components) {
    const d = c.data as Record<string, unknown>;
    if (d && typeof d === 'object' && 'enabled' in d && d.enabled === false) return false;
  }
  return true;
}
