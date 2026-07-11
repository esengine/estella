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

export type DevicePresetId = 'design' | 'iphone' | 'ipad' | '1080p' | '720p';

export interface DeviceInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DevicePreset {
  id: DevicePresetId;
  label: string;
  /** Portrait pixel dimensions. The `design` sentinel (0×0) means "use the Canvas' own aspect" (no letterbox). */
  w: number;
  h: number;
  /** Safe-area insets in device pixels (notch / home indicator), if any. */
  safe?: DeviceInsets;
}

export const RESOLUTION_PRESETS: DevicePreset[] = [
  { id: 'design', label: 'Design', w: 0, h: 0 },
  { id: 'iphone', label: 'iPhone', w: 1170, h: 2532, safe: { top: 141, bottom: 102, left: 0, right: 0 } },
  { id: 'ipad', label: 'iPad', w: 1640, h: 2360, safe: { top: 48, bottom: 48, left: 0, right: 0 } },
  { id: '1080p', label: '1080p', w: 1080, h: 1920 },
  { id: '720p', label: '720p', w: 720, h: 1280 },
];

export const RESOLUTION_PRESET_BY_ID: Record<DevicePresetId, DevicePreset> = Object.fromEntries(
  RESOLUTION_PRESETS.map((p) => [p.id, p]),
) as Record<DevicePresetId, DevicePreset>;

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
