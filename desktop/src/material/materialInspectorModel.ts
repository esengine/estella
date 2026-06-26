// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    materialInspectorModel.ts
 * @brief   View-model that drives material editing through the *unified* inspector.
 * @details A `.esmaterial` is edited in the Details panel by the same reflection-driven
 *          `ComponentSection`/`FieldRow` machinery as an entity's components — not a bespoke
 *          panel. This module is the pure bridge: it turns a material asset + its shader
 *          reflection into `InspectorComponent[]` (Parameters + Render State), converts a
 *          field edit back into the asset's stored shape (writing the live `MaterialDocument`
 *          with diff/override semantics), and projects the document onto the running material
 *          handle for the live viewport preview. The engine stays the single source of the
 *          std140 layout; this is the editor view of the declarations.
 */
import { BlendMode, CullMode, Material, type MaterialAssetData, type UniformValue } from 'esengine';
import type { InspectorComponent, InspectorField, InspectorFieldType, EnumOption, GradientValue, CurveValue } from '@/types';
import { MaterialDocument } from './MaterialDocument';
import { reflectEsshader, type ShaderParam, type ShaderReflection } from './shaderReflect';

const BLEND_OPTIONS: EnumOption[] = [
  { label: 'Normal', value: BlendMode.Normal },
  { label: 'Additive', value: BlendMode.Additive },
  { label: 'Multiply', value: BlendMode.Multiply },
  { label: 'Screen', value: BlendMode.Screen },
  { label: 'Premultiplied', value: BlendMode.PremultipliedAlpha },
];
const CULL_OPTIONS: EnumOption[] = [
  { label: 'None', value: CullMode.None },
  { label: 'Back', value: CullMode.Back },
  { label: 'Front', value: CullMode.Front },
];

const ARITY: Record<string, number> = { float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4, color: 4 };
const VEC_KEYS = ['x', 'y', 'z', 'w'] as const;
const RENDER_STATE_KEYS = new Set(['blendMode', 'depthTest', 'depthWrite', 'cull']);

const hch = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255))).toString(16).padStart(2, '0');

function colorToHex(c: Record<string, number> | undefined): string {
  const o = c ?? {};
  return `#${hch(o.r ?? 0)}${hch(o.g ?? 0)}${hch(o.b ?? 0)}${hch(o.a ?? 1)}`;
}
function hexToColor(hex: string): { r: number; g: number; b: number; a: number } {
  const s = hex.replace('#', '');
  const n = (i: number) => parseInt(s.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), a: s.length >= 8 ? n(6) : 1 };
}
function vecToArray(v: unknown, arity: number): number[] {
  const o = (v ?? {}) as Record<string, number>;
  return VEC_KEYS.slice(0, arity).map((k) => o[k] ?? 0);
}
function arrayToVec(arr: number[], arity: number): Record<string, number> {
  const o: Record<string, number> = {};
  for (let i = 0; i < arity; i++) o[VEC_KEYS[i]] = arr[i] ?? 0;
  return o;
}

/** A param's declared shader default, in the asset's stored shape (color/vec object, or scalar). */
function shaderDefaultAsset(param: ShaderParam): unknown {
  if (param.type === 'texture') return param.defaultTexture ?? 0;
  if (param.type === 'color') {
    const d = param.default;
    return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] ?? 1 };
  }
  if (param.type === 'float' || param.type === 'int') return param.default[0] ?? 0;
  return arrayToVec(param.default, ARITY[param.type] ?? 1);
}

/** Deep value equality for the asset's stored shapes (scalar / color obj / vec obj / ref). */
function assetEquals(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => assetEquals((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

/** Whether a path names a material asset (the unified inspector edits it inline). */
export function isMaterialAsset(path: string): boolean {
  return /\.(esmaterial|esmat)$/i.test(path);
}

export interface MaterialContext {
  reflection: ShaderReflection;
  /** Resolved parameter values inherited from the parent chain (empty for a base material). */
  inherited: Record<string, unknown>;
}

function dirOf(p: string): string {
  return p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
}
function resolveRef(ref: string, dir: string): string {
  return ref.startsWith('/') ? ref : dir + ref;
}

/**
 * Walk a material's `instanceOf` chain to its root, returning the root shader's source (for
 * reflection) and the parameters inherited from the parent chain (a base contributes none).
 * The inherited map is the reset/override baseline: an instance param reverts to it.
 */
export async function resolveMaterialContext(
  asset: MaterialAssetData,
  filePath: string,
): Promise<MaterialContext> {
  const chain: { asset: MaterialAssetData; path: string }[] = [];
  const visited = new Set<string>();
  let cur: MaterialAssetData | null = asset;
  let curPath = filePath;
  try {
    while (cur && !visited.has(curPath)) {
      visited.add(curPath);
      chain.push({ asset: cur, path: curPath });
      if (!cur.instanceOf) break;
      const parentPath = resolveRef(cur.instanceOf, dirOf(curPath));
      cur = JSON.parse(await window.estella.fs.read(parentPath)) as MaterialAssetData;
      curPath = parentPath;
    }
  } catch {
    /* a broken parent ref just truncates the chain */
  }

  const root = chain[chain.length - 1];
  let shaderSource: string | null = null;
  if (root?.asset.shader) {
    try {
      shaderSource = await window.estella.fs.read(resolveRef(root.asset.shader, dirOf(root.path)));
    } catch {
      shaderSource = null;
    }
  }

  // Inherited = parent chain merged parent-first (closer ancestors override farther ones),
  // excluding this asset itself (chain[0]).
  const inherited: Record<string, unknown> = {};
  for (let i = chain.length - 1; i >= 1; i--) Object.assign(inherited, chain[i].asset.properties ?? {});

  return { reflection: shaderSource ? reflectEsshader(shaderSource) : { domain: 'Unlit2D', params: [] }, inherited };
}

/** Build one reflected parameter field; null for unsupported types (vec4 has no inspector control). */
function paramField(param: ShaderParam, asset: MaterialAssetData, inherited: Record<string, unknown>): InspectorField | null {
  const def = inherited[param.name] !== undefined ? inherited[param.name] : shaderDefaultAsset(param);
  const stored = asset.properties[param.name];
  const cur = stored !== undefined ? stored : def;
  const base = { key: param.name, label: param.displayName };

  switch (param.type) {
    case 'color':
      return { ...base, type: 'color', value: colorToHex(cur as Record<string, number>), defaultValue: colorToHex(def as Record<string, number>) };
    case 'texture':
      return { ...base, type: 'asset', assetType: 'texture', value: (cur as string | number) ?? 0, defaultValue: (def as string | number) ?? 0 };
    case 'float':
    case 'int': {
      const f: InspectorField = { ...base, type: 'number', value: typeof cur === 'number' ? cur : 0, defaultValue: typeof def === 'number' ? def : 0 };
      if (param.range) {
        f.min = param.range.min;
        f.max = param.range.max;
        f.slider = true;
      }
      return f;
    }
    case 'vec2':
      return { ...base, type: 'vec2', value: vecToArray(cur, 2) as [number, number], defaultValue: vecToArray(def, 2) as [number, number] };
    case 'vec3':
      return { ...base, type: 'vec3', value: vecToArray(cur, 3) as [number, number, number], defaultValue: vecToArray(def, 3) as [number, number, number] };
    default:
      return null; // vec4: no FieldRow control yet (no material shader uses it) — Material Graph (P5) era.
  }
}

/**
 * The material as inspector components: a Parameters section (reflected `#pragma param`s) and a
 * Render State section (blend / depth / cull). Rendered by the same ComponentSection as entity
 * components — that is the whole point: one inspector, no bespoke panel.
 */
export function buildMaterialComponents(asset: MaterialAssetData, ctx: MaterialContext): InspectorComponent[] {
  const out: InspectorComponent[] = [];

  const paramFields = ctx.reflection.params.map((p) => paramField(p, asset, ctx.inherited)).filter((f): f is InspectorField => f != null);
  if (paramFields.length) out.push({ name: 'Parameters', label: 'Parameters', fields: paramFields });

  out.push({
    name: 'Render State',
    label: 'Render State',
    fields: [
      { key: 'blendMode', label: 'Blend Mode', type: 'enum', options: BLEND_OPTIONS, value: asset.blendMode ?? BlendMode.Normal, defaultValue: BlendMode.Normal },
      { key: 'depthTest', label: 'Depth Test', type: 'bool', value: asset.depthTest ?? false, defaultValue: false },
      { key: 'depthWrite', label: 'Depth Write', type: 'bool', value: asset.depthWrite ?? true, defaultValue: true },
      { key: 'cull', label: 'Cull', type: 'enum', options: CULL_OPTIONS, value: asset.cull ?? CullMode.None, defaultValue: CullMode.None },
    ],
  });

  return out;
}

/** Convert a FieldRow value (hex / number[] / scalar / ref) back into the param's stored shape. */
function fieldValueToAsset(param: ShaderParam, value: number | boolean | string | number[]): unknown {
  if (param.type === 'color') return hexToColor(value as string);
  if (param.type === 'texture') return value as string | number;
  if (param.type === 'float' || param.type === 'int') return value as number;
  return arrayToVec(value as number[], ARITY[param.type] ?? 1);
}

/**
 * A FieldWrite that routes an inspector edit to the live MaterialDocument. Render state is set
 * directly; a parameter is stored as an override unless it equals the inherited/default value,
 * in which case the override is dropped (diff serialization — the standard Reset reverts an
 * instance param to its inherited value with no extra UI).
 */
export function makeMaterialWrite(ctx: MaterialContext) {
  // The value union matches FieldRow's edit callback; materials only ever emit
  // number / boolean / string / number[] (no gradient/curve), so the cast below is safe.
  return (key: string, _type: InspectorFieldType, value: number | boolean | string | number[] | GradientValue | CurveValue): void => {
    if (RENDER_STATE_KEYS.has(key)) {
      MaterialDocument.edit(`Set ${key}`, (d) => {
        (d as unknown as Record<string, unknown>)[key] = value;
      });
      return;
    }
    const param = ctx.reflection.params.find((p) => p.name === key);
    if (!param) return;
    const def = ctx.inherited[key] !== undefined ? ctx.inherited[key] : shaderDefaultAsset(param);
    const assetVal = fieldValueToAsset(param, value as number | boolean | string | number[]);
    MaterialDocument.edit(`Set ${key}`, (d) => {
      if (assetEquals(assetVal, def)) delete d.properties[key];
      else d.properties[key] = assetVal as never;
    });
  };
}

// Convert a param's stored value (or its declared default) into the runtime UniformValue the SDK
// expects: color {r,g,b,a} -> Vec4, vec {x,y,..} -> array, scalar -> number, texture -> skip.
function toRuntimeValue(param: ShaderParam, stored: unknown): UniformValue | undefined {
  if (param.type === 'texture') return undefined;
  if (param.type === 'color') {
    const c = (stored ?? {}) as Record<string, number>;
    const d = param.default;
    return stored
      ? { x: c.r ?? 0, y: c.g ?? 0, z: c.b ?? 0, w: c.a ?? 1 }
      : { x: d[0] ?? 0, y: d[1] ?? 0, z: d[2] ?? 0, w: d[3] ?? 1 };
  }
  if (param.type === 'float' || param.type === 'int') return typeof stored === 'number' ? stored : param.default[0] ?? 0;
  const arity = ARITY[param.type] ?? 1;
  return stored ? vecToArray(stored, arity) : param.default.slice(0, arity);
}

/**
 * Project the document onto the running material handle so the viewport reflects edits next frame.
 * A base pushes every param (declared defaults included); an instance pushes only its overrides,
 * leaving inherited params alone. The document stays the source of truth — this is its runtime view.
 */
export function projectMaterialToHandle(asset: MaterialAssetData, ctx: MaterialContext, handle: number): void {
  if (!handle) return;
  const isInstance = asset.instanceOf != null;
  for (const param of ctx.reflection.params) {
    const overridden = Object.prototype.hasOwnProperty.call(asset.properties, param.name);
    if (isInstance && !overridden) continue;
    const rv = toRuntimeValue(param, overridden ? asset.properties[param.name] : undefined);
    if (rv !== undefined) Material.setUniform(handle, param.name, rv);
  }
  if (!isInstance || asset.blendMode !== undefined) Material.setBlendMode(handle, (asset.blendMode ?? BlendMode.Normal) as BlendMode);
  if (!isInstance || asset.depthTest !== undefined) Material.setDepthTest(handle, asset.depthTest ?? false);
  if (!isInstance || asset.depthWrite !== undefined) Material.setDepthWrite(handle, asset.depthWrite ?? true);
  if (!isInstance || asset.cull !== undefined) Material.setCull(handle, (asset.cull ?? CullMode.None) as CullMode);
}

/**
 * Draw a live "material ball" thumbnail of the material at @p handle into @p canvas (a square),
 * via the engine's offscreen render-to-texture preview. No-op without a handle/canvas; call it
 * after pushing edits to the handle so the thumbnail reflects them.
 */
export function renderMaterialThumbnail(handle: number, canvas: HTMLCanvasElement | null): void {
  if (!handle || !canvas) return;
  const img = Material.renderPreview(handle, canvas.width, canvas.height);
  if (img) canvas.getContext('2d')?.putImageData(img, 0, 0);
}
