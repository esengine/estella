// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { ESEngineModule, CppRegistry } from '../../wasm';
import type { UICameraData } from '../core/ui-camera-info';
import { screenToWorld, worldToScreen, createInvVPCache } from './math';

const NO_HIT = 0xffffffff;
const vpCache = createInvVPCache();

export function screenToUiWorld(camera: UICameraData, screenGLX: number, screenGLY: number): { x: number; y: number } {
  vpCache.update(camera.viewProjection);
  const invVP = vpCache.getInverse(camera.viewProjection);
  return screenToWorld(screenGLX, screenGLY, invVP, camera.vpX, camera.vpY, camera.vpW, camera.vpH);
}

export function uiWorldToScreen(camera: UICameraData, worldX: number, worldY: number): { x: number; y: number } {
  const [x, y] = worldToScreen(worldX, worldY, camera.viewProjection, camera.vpX, camera.vpY, camera.vpW, camera.vpH);
  return { x, y };
}

export function uiHitTestWorld(
  module: ESEngineModule,
  registry: CppRegistry,
  worldX: number,
  worldY: number,
  mouseDown = false,
  mousePressed = false,
  mouseReleased = false,
): Entity | null {
  module.uiHitTest_update(registry, worldX, worldY, mouseDown, mousePressed, mouseReleased);
  const hit = module.uiHitTest_getHitEntity();
  return hit === NO_HIT ? null : hit;
}
