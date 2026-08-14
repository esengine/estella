// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  resolutionPresets.ts — target-device presets for the UI-mode viewport
 *        preview (the sibling of the Snap step table). These do NOT change a
 *        Canvas' authored design resolution; they set a simulated screen the
 *        viewport fits the design into, so the letterbox/safe-area preview shows
 *        how the UI adapts on that device. Dimensions are portrait (w ≤ h); the
 *        orientation toggle swaps them at render time.
 */
import { t } from '@/i18n';
import type { ScreenPreset as ProjectScreenPreset } from '../../../pipeline/src/project/format';

/** The built-in ids. Not a closed set: a project may declare its own screens, so
 *  anything holding a selection types it as `string`. */
export type DevicePresetId = 'design' | 'iphone' | 'ipad' | '1080p' | '720p';

export interface DeviceInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DevicePreset {
  id: string;
  label: string;
  /** Portrait pixel dimensions. The `design` sentinel (0×0) means "use the Canvas' own aspect" (no letterbox). */
  w: number;
  h: number;
  /** Safe-area insets in device pixels (notch / home indicator), if any. */
  safe?: DeviceInsets;
}

export const RESOLUTION_PRESETS: DevicePreset[] = [
  { id: 'design', label: t('vp.devDesign'), w: 0, h: 0 },
  { id: 'iphone', label: 'iPhone', w: 1170, h: 2532, safe: { top: 141, bottom: 102, left: 0, right: 0 } },
  { id: 'ipad', label: 'iPad', w: 1640, h: 2360, safe: { top: 48, bottom: 48, left: 0, right: 0 } },
  { id: '1080p', label: '1080p', w: 1080, h: 1920 },
  { id: '720p', label: '720p', w: 720, h: 1280 },
];

export const RESOLUTION_PRESET_BY_ID: Record<DevicePresetId, DevicePreset> = Object.fromEntries(
  RESOLUTION_PRESETS.map((p) => [p.id, p]),
) as Record<DevicePresetId, DevicePreset>;

/**
 * Built-ins plus whatever the open project declares (`screenPresets` in the
 * manifest). Which handsets a team ships to is the project's business — a
 * built-in list is a guess, and one that cannot be corrected means everyone
 * tests on approximately the wrong screen.
 *
 * A project preset may take a built-in's id to REPLACE it (a studio that means
 * something specific by "iPhone"), so ids stay unique and a saved selection
 * still resolves. Everything downstream reads through here, so the dropdown, the
 * design-frame overlay and the play-host letterbox cannot disagree about what a
 * given id means.
 */
export function screenPresets(project?: readonly ProjectScreenPreset[]): DevicePreset[] {
  if (!project || project.length === 0) return RESOLUTION_PRESETS;
  const byId = new Map(RESOLUTION_PRESETS.map((p) => [p.id, p]));
  for (const p of project) {
    byId.set(p.id, { id: p.id, label: p.label, w: p.width, h: p.height, safe: p.safe });
  }
  return [...byId.values()];
}

/** Resolve one id against the built-ins + the project's. Unknown ⇒ the `design` sentinel. */
export function screenPresetById(
  id: string,
  project?: readonly ProjectScreenPreset[],
): DevicePreset {
  return screenPresets(project).find((p) => p.id === id) ?? RESOLUTION_PRESET_BY_ID.design;
}

export type Orientation = 'portrait' | 'landscape';

/**
 * A device preset's pixel dimensions with the orientation applied (portrait dims are
 * swapped for landscape). Null for the `design` sentinel (no simulated device). The one
 * source of the device's oriented size — the design-frame overlay and the UI-layout-aspect
 * sync both read it, so the previewed frame and the actual UI layout can't drift apart.
 */
export function deviceDims(
  device: string,
  orientation: Orientation,
  presets?: readonly ProjectScreenPreset[],
): { w: number; h: number } | null {
  const p = screenPresetById(device, presets);
  if (p.w <= 0 || p.h <= 0) return null;
  return orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
}

/**
 * The aspect the editor lays UI out against for the current device selection: the device's
 * aspect (previewing adaptation), or 0 for the `design` sentinel (WYSIWYG at the authored
 * resolution). Fed to EditorView.uiPreviewAspect → uiLayoutRect.
 */
export function uiPreviewAspect(
  device: string,
  orientation: Orientation,
  presets?: readonly ProjectScreenPreset[],
): number {
  const d = deviceDims(device, orientation, presets);
  return d ? d.w / d.h : 0;
}

/**
 * Common authored design resolutions for the viewport Design control. Unlike the
 * device presets above (a transient preview simulation), picking one WRITES the
 * Canvas' `designResolution` — the authoritative value the scene is designed against.
 * Exact/custom numbers are edited on the Canvas component in the Inspector.
 */
export interface DesignResolutionPreset {
  label: string;
  x: number;
  y: number;
}

export const DESIGN_RESOLUTION_PRESETS: DesignResolutionPreset[] = [
  { label: '1920 × 1080', x: 1920, y: 1080 },
  { label: '1280 × 720', x: 1280, y: 720 },
  { label: '1080 × 1920', x: 1080, y: 1920 },
  { label: '750 × 1334', x: 750, y: 1334 },
  { label: '1170 × 2532', x: 1170, y: 2532 },
  { label: '2048 × 1536', x: 2048, y: 1536 },
];
