// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import type { UICameraData } from '../core/ui-camera-info';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
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

/**
 * What picking asks of a world: the two accessors that reach the engine core.
 * Named as a subset so a host holding a narrowed view of the world can still
 * pick, without the helpers claiming to need the rest of it.
 */
export type PickableWorld = Pick<World, 'getCppRegistry' | 'getWasmModule'>;

/** The engine and the registry behind a world, or null when either is absent. */
function core(world: PickableWorld) {
  const engine = worldEngineApi(world);
  const registry = world.getCppRegistry();
  return engine && registry ? { engine, registry } : null;
}

/**
 * The topmost **interactable** entity at a world point — the same raycast the
 * interaction system runs, so a custom cursor agrees with the built-in one.
 * A query: what a press or a hover MEANS is the interaction system's business.
 */
export function uiHitTestWorld(world: PickableWorld, worldX: number, worldY: number): Entity | null {
  const c = core(world);
  if (!c?.engine.uiHitTest_update || !c.engine.uiHitTest_getHitEntity) return null;
  c.engine.uiHitTest_update(c.registry, worldX, worldY);
  const hit = c.engine.uiHitTest_getHitEntity();
  return hit === NO_HIT ? null : hit;
}

/** Editor pick: topmost UI entity under the point, regardless of Interactable;
 *  {@link uiHitTestWorld} is the runtime raycast. */
export function uiPickWorld(world: PickableWorld, worldX: number, worldY: number): Entity | null {
  const c = core(world);
  if (!c?.engine.uiHitTest_pick) return null;
  const hit = c.engine.uiHitTest_pick(c.registry, worldX, worldY);
  return hit === NO_HIT ? null : hit;
}

/** All editor-pickable UI entities under the point, most specific first. */
export function uiPickAllWorld(world: PickableWorld, worldX: number, worldY: number): Entity[] {
  const c = core(world);
  if (!c?.engine.uiHitTest_pickAll || !c.engine.uiHitTest_pickResult) return [];
  const count = c.engine.uiHitTest_pickAll(c.registry, worldX, worldY);
  const out: Entity[] = [];
  for (let i = 0; i < count; i++) {
    const e = c.engine.uiHitTest_pickResult(i);
    if (e !== NO_HIT) out.push(e);
  }
  return out;
}
