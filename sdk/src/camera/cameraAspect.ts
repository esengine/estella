// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cameraAspect.ts
 * @brief   The shape of what a camera draws, as every stage of the camera pipeline (CameraRig.ts) measures it.
 */
import type { CameraData } from '../ecs/component';

/**
 * The width over the height of what `camera` draws: its share of a screen `screenAspect` wide. The renderer projects by
 * this and nothing else (Camera.aspectRatio is not read by it), so every stage that frames a shot measures by it too.
 * 0 while the screen is not known.
 */
export function cameraAspect(camera: Pick<CameraData, 'viewport'>, screenAspect: number): number {
  const vp = camera.viewport;
  return screenAspect > 0 && vp.w > 0 ? (screenAspect * vp.z) / vp.w : 0;
}
