// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetImporter.ts
 * @brief Single source of truth for per-type asset import settings (the `.meta`
 *        `importer` block). One registry produces both the import-time defaults and
 *        the inspector's editable fields, so the two can't drift. DOM/engine-free
 *        (importable from the Electron main process; the type import is erased).
 */
import type { InspectorField, InspectorComponent, InspectorFieldValue } from '@/types';

/** A field spec: an InspectorField minus the live `value` (filled per asset) plus
 *  its import-time default (which also becomes the inspector's reset target). */
export type ImporterFieldSpec = Omit<InspectorField, 'value' | 'defaultValue'> & {
  default: InspectorFieldValue;
};

const powerOfTwo = [256, 512, 1024, 2048, 4096, 8192];

const TEXTURE: ImporterFieldSpec[] = [
  {
    key: 'maxSize', label: 'Max Size', type: 'enum', default: 2048, category: 'Texture',
    options: powerOfTwo.map((n) => ({ label: String(n), value: n })),
    tooltip: 'Downscale cap applied when the asset is imported/cooked (power of two).',
  },
  {
    key: 'filterMode', label: 'Filter', type: 'select', default: 'linear', category: 'Texture',
    selectOptions: ['nearest', 'linear'],
    tooltip: 'Texture sampling filter. Nearest keeps pixels crisp; Linear smooths.',
  },
  {
    key: 'wrapMode', label: 'Wrap', type: 'select', default: 'repeat', category: 'Texture',
    selectOptions: ['repeat', 'clamp', 'mirror'],
    tooltip: 'How UVs outside [0,1] are addressed.',
  },
  {
    key: 'premultiplyAlpha', label: 'Premultiply Alpha', type: 'bool', default: false,
    category: 'Texture', advanced: true,
  },
  {
    key: 'sRGB', label: 'sRGB Color', type: 'bool', default: true, category: 'Texture', advanced: true,
    tooltip: 'The image stores sRGB-encoded color (albedo/UI). Disable for authored-linear '
      + 'data like normal maps and masks — only meaningful when the project renders in linear color.',
  },
  { key: 'sliceBorder.left', label: 'Border Left', type: 'number', default: 0, min: 0, category: '9-Slice', advanced: true },
  { key: 'sliceBorder.right', label: 'Border Right', type: 'number', default: 0, min: 0, category: '9-Slice', advanced: true },
  { key: 'sliceBorder.top', label: 'Border Top', type: 'number', default: 0, min: 0, category: '9-Slice', advanced: true },
  { key: 'sliceBorder.bottom', label: 'Border Bottom', type: 'number', default: 0, min: 0, category: '9-Slice', advanced: true },
];

const SPINE: ImporterFieldSpec[] = [
  { key: 'scale', label: 'Scale', type: 'number', default: 1, min: 0, step: 0.01, category: 'Spine' },
  { key: 'defaultSkin', label: 'Default Skin', type: 'string', default: 'default', category: 'Spine' },
  { key: 'premultiplyAlpha', label: 'Premultiply Alpha', type: 'bool', default: false, category: 'Spine', advanced: true },
];

const AUDIO: ImporterFieldSpec[] = [
  {
    key: 'compress', label: 'Compress', type: 'bool', default: true, category: 'Audio',
    tooltip: 'Re-encode WAV to MP3 at cook (already-compressed formats pass through). '
      + 'MP3 has a small encoder delay — disable for seamless-loop clips.',
  },
  {
    key: 'bitrateKbps', label: 'Bitrate', type: 'enum', default: 128, category: 'Audio',
    options: [96, 128, 192].map((n) => ({ label: `${n} kbps`, value: n })),
    tooltip: 'MP3 bitrate for cooked WAV sources.',
  },
];

const VIDEO: ImporterFieldSpec[] = [
  {
    key: 'loop', label: 'Loop', type: 'bool', default: true, category: 'Video',
    tooltip: 'Suggested loop state when this clip is assigned to a Video component.',
  },
  { key: 'autoplay', label: 'Autoplay', type: 'bool', default: true, category: 'Video' },
  {
    key: 'muted', label: 'Muted', type: 'bool', default: true, category: 'Video',
    tooltip: 'Muted clips can autoplay; unmuted autoplay is blocked until a user gesture.',
  },
];

const SCENELIKE: ImporterFieldSpec[] = [
  {
    key: 'autoMigrate', label: 'Auto Migrate', type: 'bool', default: true, category: 'Import',
    tooltip: 'Upgrade this asset to the current schema version when it loads.',
  },
];

/** type → its import-setting field specs. Types absent here have no import
 *  settings (only metadata) and get an empty defaults object. */
export const IMPORTER_SCHEMAS: Record<string, ImporterFieldSpec[]> = {
  texture: TEXTURE,
  sprite: TEXTURE,
  spine: SPINE,
  audio: AUDIO,
  video: VIDEO,
  scene: SCENELIKE,
  prefab: SCENELIKE,
};

/** Cook-facing audio import settings, tolerant of hand-edited `.meta` blocks. */
export function readAudioImportSettings(importer: Record<string, unknown> | undefined): {
  compress: boolean; bitrateKbps: number;
} {
  const compress = importer?.compress;
  const bitrate = importer?.bitrateKbps;
  return {
    compress: typeof compress === 'boolean' ? compress : true,
    bitrateKbps: bitrate === 96 || bitrate === 128 || bitrate === 192 ? bitrate : 128,
  };
}

const getByPath = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** The `importer` block written into a fresh `.meta` at import time — derived from
 *  the same specs the inspector edits, so the two never drift. */
export function importerDefaults(type: string): Record<string, unknown> {
  const specs = IMPORTER_SCHEMAS[type];
  if (!specs) return {};
  const out: Record<string, unknown> = {};
  for (const s of specs) setByPath(out, s.key, s.default);
  return out;
}

/** True when a type exposes editable import settings (drives whether the inspector
 *  renders an Import Settings section). */
export const hasImporterSettings = (type: string): boolean => (IMPORTER_SCHEMAS[type]?.length ?? 0) > 0;

/** Build the inspector's "Import Settings" component from a type's specs and the
 *  asset's current `importer` block — filling each field's live value (falling
 *  back to the default) and its reset target. */
export function buildImporterComponent(type: string, importer: Record<string, unknown>): InspectorComponent | null {
  const specs = IMPORTER_SCHEMAS[type];
  if (!specs?.length) return null;
  const fields: InspectorField[] = specs.map(({ default: def, ...rest }) => {
    const cur = getByPath(importer, rest.key);
    return { ...rest, value: (cur ?? def) as InspectorFieldValue, defaultValue: def };
  });
  return { name: 'Import Settings', label: 'Import Settings', fields };
}

/** A texture's sampler settings, in the string shape the engine's TextureLoader
 *  and the runtime importer-resolver consume (filterMode/wrapMode → filter/wrap).
 *  Undefined when the `.meta` carries neither ⇒ loader defaults. */
export function readTextureImportSettings(
  importer: Record<string, unknown> | undefined,
): { filter?: 'linear' | 'nearest'; wrap?: 'repeat' | 'clamp' | 'mirror'; srgb?: boolean } | undefined {
  if (!importer) return undefined;
  const filter = importer.filterMode as 'linear' | 'nearest' | undefined;
  const wrap = importer.wrapMode as 'repeat' | 'clamp' | 'mirror' | undefined;
  const srgb = typeof importer.sRGB === 'boolean' ? importer.sRGB : undefined;
  return filter || wrap || srgb !== undefined ? { filter, wrap, srgb } : undefined;
}

/** Apply one inspector edit to a copy of the `importer` block (dotted keys →
 *  nested), returning the new block. Pure — the caller owns dirty/save. */
export function applyImporterEdit(
  importer: Record<string, unknown>,
  key: string,
  value: InspectorFieldValue,
): Record<string, unknown> {
  const next = structuredClone(importer);
  setByPath(next, key, value);
  return next;
}
