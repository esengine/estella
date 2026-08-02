// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  uiZoom.ts
 * @brief THE editor's UI zoom: one value, one way down to the shell. The settings
 *        store owns it (persisted per user); the View menu commands, the settings
 *        slider and the status-bar chip are all just writers of that one value.
 *
 * Chromium applies the zoom, not CSS — and that is the whole point. Chromium raises
 * devicePixelRatio along with it, so every dpr-aware canvas (viewport, profiler
 * graphs, waveforms, node graphs) keeps its backing store at native resolution and
 * pointer→canvas math stays in ONE coordinate space. A CSS `zoom` raises neither:
 * it upscales those canvases and splits `getBoundingClientRect` away from
 * `clientWidth`, which desynchronises viewport picking by exactly the zoom factor.
 */
import { useSettings } from '@/store/settingsStore';

export const UI_SCALE_SETTING = 'appearance.uiScale';

/** The stops the zoom commands walk. The slider stays free to land between them. */
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150, 175, 200];

export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const ZOOM_DEFAULT = 100;

const clamp = (percent: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(percent)));

export function uiZoom(): number {
  return useSettings.getState().getValue<number>(UI_SCALE_SETTING);
}

export function setUiZoom(percent: number): void {
  useSettings.getState().setValue(UI_SCALE_SETTING, clamp(percent));
}

/** Walk to the neighbouring stop — from wherever the slider left the value. */
export function stepUiZoom(dir: 1 | -1): void {
  const cur = uiZoom();
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > cur) : ZOOM_STEPS.filter((s) => s < cur).pop();
  if (next !== undefined) setUiZoom(next);
}

export const canZoomIn = (): boolean => uiZoom() < ZOOM_MAX;
export const canZoomOut = (): boolean => uiZoom() > ZOOM_MIN;

/** The setting's `effect` — the single point where the value reaches the shell. */
export function applyUiZoom(percent: number): void {
  if (typeof window === 'undefined') return;
  void window.estella?.win?.setZoom?.(clamp(percent) / 100);
}
