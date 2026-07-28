// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ScreenScaling.ts
 * @brief   Project-level camera fit — the design (reference) resolution the MAIN
 *          scene camera scales against, independent of any UI Canvas.
 *
 * The design resolution used to live only on the `Canvas` (UI) component, so a
 * scene without UI got no design-resolution fit (the camera kept its raw
 * orthoSize). This resource makes the fit a project/screen concern: when
 * `scaleMode` is a real {@link CanvasScaleMode} (0..4) the camera letterboxes the
 * design resolution into the actual aspect exactly as a Canvas would — no UI layer
 * required. `scaleMode = SCREEN_FIT_OFF` (the default) keeps the legacy behavior
 * (Canvas fit when present, else raw orthoSize), so an unconfigured project is
 * unchanged. UI layout still reads the Canvas (see uiLayoutRect); only the camera
 * fit reads this, so gameplay and UI can fit differently.
 *
 * Installed by every runtime; the shipped game / play realm / editor set it from
 * the project config (design resolution + fit). Read by CameraPlugin.resolveCameras.
 */
import { defineResource } from '../ecs/resource';

/** `scaleMode` sentinel: no camera fit — the camera uses its own orthoSize (default). */
export const SCREEN_FIT_OFF = -1;

export interface ScreenScalingData {
  /** Design (reference) resolution width in px — the horizontal reference the fit uses. */
  designWidth: number;
  /** Design (reference) resolution height in px. */
  designHeight: number;
  /** A {@link CanvasScaleMode} (FixedWidth=0 … Match=4), or {@link SCREEN_FIT_OFF} (-1). */
  scaleMode: number;
  /** Match-mode blend 0..1 (0 = fit width, 1 = fit height); ignored for other modes. */
  matchWidthOrHeight: number;
}

/** Off by default (scaleMode = -1) ⇒ zero behavior change for a project that never
 *  opts into a camera fit. Dimensions default to the engine's Canvas default. */
export const DEFAULT_SCREEN_SCALING: ScreenScalingData = {
  designWidth: 1920,
  designHeight: 1080,
  scaleMode: SCREEN_FIT_OFF,
  matchWidthOrHeight: 0.5,
};

export const ScreenScaling = defineResource<ScreenScalingData>({ ...DEFAULT_SCREEN_SCALING }, 'ScreenScaling');
