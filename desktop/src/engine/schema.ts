import {
  getAllRegisteredComponents,
  getComponent,
  Sprite,
  Camera,
  Name,
  Children,
  ShapeRenderer,
  Canvas,
  BitmapText,
  SpineAnimation,
  TilemapLayer,
  ParticleEmitter,
} from 'esengine';
import type { App } from 'esengine';
import type { NodeKind, EntityId, InspectorField } from '@/types';

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

/** Every editable component the entity currently carries, in display order. */
export function inspectableComponents(
  world: WorldT,
  entity: EntityId,
): Array<{ name: string; def: AnyComp; label: string }> {
  const out: Array<{ name: string; def: AnyComp; label: string }> = [];
  for (const [name, rawDef] of getAllRegisteredComponents()) {
    if (HIDDEN_COMPONENTS.has(name)) continue;
    const def = rawDef as unknown as AnyComp;
    if (!world.has(entity, def)) continue;
    out.push({ name, def, label: prettyLabel(name) });
  }
  out.sort((a, b) => {
    const ai = ORDER.indexOf(a.name);
    const bi = ORDER.indexOf(b.name);
    return (ai === -1 ? ORDER.length : ai) - (bi === -1 ? ORDER.length : bi);
  });
  return out;
}

/** The editable fields of one component (its live data introspected by shape). */
export function componentFields(def: AnyComp, data: Record<string, unknown>): InspectorField[] {
  const colorKeys = new Set<string>(def.colorKeys);
  const fields: InspectorField[] = [];
  for (const key of Object.keys(def._default as Record<string, unknown>)) {
    if (DERIVED_FIELDS.has(key)) continue;
    const f = inferField(key, data[key], colorKeys.has(key));
    if (f) fields.push(f);
  }
  return fields;
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

// — Outliner kind/name (presentation; uses specific defs for icon mapping) —

export function kindOf(world: WorldT, e: EntityId): NodeKind {
  if (world.has(e, Camera)) return 'camera';
  if (world.has(e, SpineAnimation)) return 'spine';
  if (world.has(e, Canvas) || world.has(e, BitmapText)) return 'ui';
  if (world.has(e, Sprite) || world.has(e, ShapeRenderer) || world.has(e, TilemapLayer))
    return 'sprite';
  if (world.has(e, ParticleEmitter)) return 'sprite';
  if (world.has(e, Children)) return 'group';
  return 'empty';
}

export function nameOf(world: WorldT, e: EntityId, kind: NodeKind): string {
  if (world.has(e, Name)) {
    const v = world.get(e, Name).value;
    if (v) return v;
  }
  return `${cap(kind)} ${e}`;
}
