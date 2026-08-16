// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  importSettings.ts
 * @brief Single source of truth for per-type asset import settings (the `.meta`
 *        `importer` block). One registry produces both the import-time defaults
 *        and the fields an editor offers, so the two can't drift.
 *
 *        The specs carry their own presentation vocabulary rather than the
 *        editor's `InspectorField`: what a setting IS belongs to the project, and
 *        a build that never opens a window still has to read it. An editor maps
 *        a spec onto whatever control it renders.
 */

/** What an import setting can hold. Anything richer belongs in the asset, not here. */
export type ImporterValue = number | boolean | string;

/** The control kinds import settings need — a subset of what an inspector can render. */
export type ImporterFieldType = 'number' | 'bool' | 'string' | 'enum' | 'select';

/** A named choice for an `enum` field: the label shown, the value stored. A
 *  choice is never a flag — a two-state setting is a `bool`. */
export interface ImporterEnumOption {
  label: string;
  value: string | number;
}

/** One import setting: where it lives in the `importer` block, and how to offer it. */
export interface ImporterFieldSpec {
  /** Dotted path within the `importer` block (`sliceBorder.left`). */
  key: string;
  label: string;
  type: ImporterFieldType;
  /** Written into a fresh `.meta`, and the reset target of an editor's field. */
  default: ImporterValue;
  category?: string;
  tooltip?: string;
  /** Rarely edited — an editor may fold it away. */
  advanced?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** For `type: 'enum'`. */
  options?: ImporterEnumOption[];
  /** For `type: 'select'`. */
  selectOptions?: string[];
}

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
];

// Which armature and animation an entity gets are DragonBonesAnimation fields
// (empty = the file's first / its setup pose), so import carries only the scale.
const DRAGONBONES: ImporterFieldSpec[] = [
  { key: 'scale', label: 'Scale', type: 'number', default: 1, min: 0, step: 0.01, category: 'DragonBones' },
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

// Playback (loop / autoplay / muted) belongs to the Video COMPONENT, which
// carries all three: an import-time copy of them was read by nothing.
const VIDEO: ImporterFieldSpec[] = [
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

const MODEL: ImporterFieldSpec[] = [
  {
    key: 'scale', label: 'Scale', type: 'number', default: 1, min: 0.0001, step: 0.1,
    category: 'Import',
    tooltip: 'Uniform scale on the imported prefab\u0027s root. A glTF is authored in metres '
      + 'and a world unit is a design pixel, so a real-world model arrives a few pixels across.',
  },
];

/** type → its import-setting field specs. Types absent here have no import
 *  settings (only metadata) and get an empty defaults object. */
export const IMPORTER_SCHEMAS: Record<string, ImporterFieldSpec[]> = {
  model: MODEL,
  texture: TEXTURE,
  sprite: TEXTURE,
  spine: SPINE,
  dragonbones: DRAGONBONES,
  audio: AUDIO,
  video: VIDEO,
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

export const getImporterValueByPath = (obj: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);

export function setImporterValueByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
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
 *  the same specs an editor offers, so the two never drift. */
export function importerDefaults(type: string): Record<string, unknown> {
  const specs = IMPORTER_SCHEMAS[type];
  if (!specs) return {};
  const out: Record<string, unknown> = {};
  for (const s of specs) setImporterValueByPath(out, s.key, s.default);
  return out;
}

/** True when a type exposes editable import settings. */
export const hasImporterSettings = (type: string): boolean => (IMPORTER_SCHEMAS[type]?.length ?? 0) > 0;

/** The texture cook settings a platform may override: size cap + whether/how to
 *  compress. sRGB is intrinsic to the asset's color rather than the target, so it
 *  is not overridable. `enabled` is the per-platform switch — an override applies
 *  only when it is on. */
export interface TexturePlatformOverride {
  enabled?: boolean;
  maxSize?: number;
  compress?: boolean;
  compressFormat?: 'uastc' | 'etc1s';
}

/** Cook-facing texture settings, tolerant of hand-edited `.meta` blocks: each
 *  texture decides its own KTX2 format, opt-out and size cap. An ENABLED
 *  `importer.overrides[platform]` wins per field; an unset field inherits the
 *  default. Defaults match a fresh `.meta`. */
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

// Load-time settings (sampler + 9-slice border) are parsed by the SDK's
// `textureImportSettingsFrom`, not here: one reader for the editor and the
// shipped build, or the two disagree.
