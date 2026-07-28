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
    tooltip: 'Downscale cap applied at cook (power of two). A source larger than this on '
      + 'its longest side is box-filtered down; smaller sources are untouched.',
  },
  {
    key: 'compress', label: 'Compress', type: 'bool', default: true, category: 'Texture',
    tooltip: 'GPU-compress this texture to KTX2 (Basis Universal) at cook — it stays '
      + 'compressed in VRAM and transcodes per device. Turn OFF to ship the raw image '
      + '(crisp UI, smooth gradients). Only applies when the build compresses assets.',
  },
  {
    key: 'compressFormat', label: 'Compress Format', type: 'select', default: 'uastc',
    category: 'Texture', advanced: true, selectOptions: ['uastc', 'etc1s'],
    tooltip: 'UASTC — high quality, larger. ETC1S — much smaller, lower quality '
      + '(good for photographic / low-frequency art). Only used when Compress is on.',
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

// A DragonBones file is a project: it can hold several armatures, so which one an
// entity gets is an import-time default rather than something derived from the
// file. Spine needs no equivalent — its file IS one skeleton.
const DRAGONBONES: ImporterFieldSpec[] = [
  { key: 'scale', label: 'Scale', type: 'number', default: 1, min: 0, step: 0.01, category: 'DragonBones' },
  {
    key: 'defaultArmature', label: 'Default Armature', type: 'string', default: '', category: 'DragonBones',
    tooltip: 'Armature used when an entity does not name one. Empty picks the first in the file.',
  },
  {
    key: 'defaultAnimation', label: 'Default Animation', type: 'string', default: '', category: 'DragonBones',
    tooltip: 'Played on spawn. Empty leaves the armature in its setup pose.',
  },
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
  {
    key: 'quality', label: 'Cook Quality', type: 'number', default: 4, min: 2, max: 31, step: 1,
    category: 'Video', advanced: true,
    tooltip: 'MPEG-1 quantizer for targets on the wasm decode path (WeChat): '
      + '2 = near-lossless (largest file), 31 = smallest. Web targets ship the source untouched.',
  },
  {
    key: 'audioBitrateKbps', label: 'Cook Audio Bitrate', type: 'enum', default: 128,
    category: 'Video', advanced: true,
    options: [96, 128, 192].map((n) => ({ label: `${n} kbps`, value: n })),
    tooltip: 'AAC bitrate for the audio track demuxed at cook (wasm decode path).',
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
  dragonbones: DRAGONBONES,
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

/** The subset of texture cook settings a platform may override — the axes that
 *  actually vary per target for a Basis "encode once, transcode per GPU" pipeline:
 *  size cap + whether/how to compress. (sRGB is intrinsic to the asset's color, not
 *  the platform, so it is NOT overridable.) `enabled` is the inspector's per-platform
 *  "Override for <platform>" switch — an override is only applied when it is on. */
export interface TexturePlatformOverride {
  enabled?: boolean;
  maxSize?: number;
  compress?: boolean;
  compressFormat?: 'uastc' | 'etc1s';
}

/** Cook-facing texture settings (compression + downscale), tolerant of hand-edited
 *  `.meta` blocks. Mirrors {@link readAudioImportSettings} — the cook reads this
 *  per asset so each texture decides its own KTX2 format / opt-out / size cap,
 *  the way audio clips already do. When `platform` is given and that platform has
 *  an ENABLED override in `importer.overrides`, its present fields win over the
 *  defaults per-field (an unset field inherits the default). Defaults match a
 *  fresh `.meta`. */
export function readTextureCookSettings(importer: Record<string, unknown> | undefined, platform?: string): {
  compress: boolean; format: 'uastc' | 'etc1s'; maxSize: number; srgb: boolean;
} {
  const compress = importer?.compress;
  const format = importer?.compressFormat;
  const maxSize = importer?.maxSize;
  const srgb = importer?.sRGB;
  const resolved = {
    compress: typeof compress === 'boolean' ? compress : true,
    format: (format === 'etc1s' ? 'etc1s' : 'uastc') as 'uastc' | 'etc1s',
    maxSize: typeof maxSize === 'number' && maxSize > 0 ? maxSize : 2048,
    srgb: typeof srgb === 'boolean' ? srgb : true,
  };
  const overrides = importer?.overrides as Record<string, TexturePlatformOverride> | undefined;
  const ov = platform ? overrides?.[platform] : undefined;
  if (ov?.enabled) {
    if (typeof ov.compress === 'boolean') resolved.compress = ov.compress;
    if (ov.compressFormat === 'etc1s' || ov.compressFormat === 'uastc') resolved.format = ov.compressFormat;
    if (typeof ov.maxSize === 'number' && ov.maxSize > 0) resolved.maxSize = ov.maxSize;
  }
  return resolved;
}

// A texture's LOAD-time settings (sampler + 9-slice border) are parsed by the
// SDK's `textureImportSettingsFrom`, not here: the editor and a shipped build
// read the same `.meta` importer block, and a second reader is how "works in
// the editor, not in the build" gets born. This module stays engine-free (the
// Electron main process imports it for the cook), which is why the parser lives
// on the SDK side rather than the other way round.

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
