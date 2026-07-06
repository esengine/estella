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

/** Editor pick: topmost UI entity under the point, regardless of Interactable;
 *  `uiHitTestWorld` is the runtime raycast. */
export function uiPickWorld(
  module: ESEngineModule,
  registry: CppRegistry,
  worldX: number,
  worldY: number,
): Entity | null {
  if (!module.uiHitTest_pick) return null;
  const hit = module.uiHitTest_pick(registry, worldX, worldY);
  return hit === NO_HIT ? null : hit;
}

/** All editor-pickable UI entities under the point, most specific first. */
export function uiPickAllWorld(
  module: ESEngineModule,
  registry: CppRegistry,
  worldX: number,
  worldY: number,
): Entity[] {
  if (!module.uiHitTest_pickAll || !module.uiHitTest_pickResult) return [];
  const count = module.uiHitTest_pickAll(registry, worldX, worldY);
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const e = module.uiHitTest_pickResult(i);
    if (e !== NO_HIT) out.push(e);
  }
  return out;
}
