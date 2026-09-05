// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import type { UICameraData } from '../core/ui-camera-info';
import type { ScreenOverlayData } from '../core/screen-overlay';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { screenToWorld, worldToScreen, createInvVPCache, screenRay, type WorldRay } from './math';

const NO_HIT = 0xffffffff;
const vpCache = createInvVPCache();
const overlayCache = createInvVPCache();

export function screenToUiWorld(camera: UICameraData, screenGLX: number, screenGLY: number): { x: number; y: number } {
  vpCache.update(camera.viewProjection);
  const invVP = vpCache.getInverse(camera.viewProjection);
  return screenToWorld(screenGLX, screenGLY, invVP, camera.vpX, camera.vpY, camera.vpW, camera.vpH);
}

/**
 * The world ray a screen point names, through the UI camera.
 *
 * @details {@link screenToUiWorld} answers with this ray meeting ONE plane, which
 *          picking cannot use: a mesh is a solid and a sprite stands at any depth.
 */
export function uiPointerRay(camera: UICameraData, screenGLX: number, screenGLY: number): WorldRay {
  vpCache.update(camera.viewProjection);
  const invVP = vpCache.getInverse(camera.viewProjection);
  return screenRay(screenGLX, screenGLY, invVP, camera.vpX, camera.vpY, camera.vpW, camera.vpH);
}

/**
 * The LAYOUT point a screen pixel names, through the same matrix the overlay
 * draws with — the same one, not an equivalent one. Two derivations agree until
 * either gains a case, and the symptom then is a HUD that looks right and clicks
 * somewhere else.
 */
export function screenToUiLayout(
  overlay: ScreenOverlayData, screenGLX: number, screenGLY: number,
): { x: number; y: number } {
  overlayCache.update(overlay.projection);
  const invVP = overlayCache.getInverse(overlay.projection);
  return screenToWorld(screenGLX, screenGLY, invVP,
                       overlay.vpX, overlay.vpY, overlay.vpW, overlay.vpH);
}

/** The layout-domain ray a screen point names — {@link screenToUiLayout}'s
 *  answer as the ray a pick needs, since a UI node stands at its own z. */
export function uiLayoutRay(
  overlay: ScreenOverlayData, screenGLX: number, screenGLY: number,
): WorldRay {
  overlayCache.update(overlay.projection);
  const invVP = overlayCache.getInverse(overlay.projection);
  return screenRay(screenGLX, screenGLY, invVP,
                   overlay.vpX, overlay.vpY, overlay.vpW, overlay.vpH);
}

/**
 * The pointer, in the coordinates @p entity's own transform lives in.
 *
 * A UI system that subtracts a pointer from a transform — a drag, a slider's
 * fraction, a caret — needs the two in one domain, and which domain that is
 * depends on the entity.
 */
export function uiPointerFor(
  world: PickableWorld,
  entity: Entity,
  camera: UICameraData,
  overlay: ScreenOverlayData,
): { x: number; y: number } {
  return isScreenEntity(world, entity)
    ? { x: overlay.pointerX, y: overlay.pointerY }
    : { x: camera.worldMouseX, y: camera.worldMouseY };
}

/** Whether @p entity is laid out on the screen rather than in the world — the
 *  engine's own answer (UISystem::screenDomain), never a second derivation. */
export function isScreenEntity(world: PickableWorld, entity: Entity): boolean {
  const c = core(world);
  return c?.engine.ui_isScreenDomain?.(c.registry, entity as number) ?? false;
}

/** A layout point's pixel on the surface, through the overlay's own projection —
 *  the forward of {@link screenToUiLayout}, for anchoring something the OS draws
 *  (an IME candidate window) under something the engine drew. */
export function uiLayoutToScreen(
  overlay: ScreenOverlayData, x: number, y: number,
): { x: number; y: number } {
  const [sx, sy] = worldToScreen(x, y, overlay.projection,
                                 overlay.vpX, overlay.vpY, overlay.vpW, overlay.vpH);
  return { x: sx, y: sy };
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
 * The topmost **interactable** entity along a pointer ray — the same raycast the
 * interaction system runs, so a custom cursor agrees with the built-in one.
 * A query: what a press or a hover MEANS is the interaction system's business.
 */
export function uiHitTestWorld(
  world: PickableWorld, ray: WorldRay, screenRay?: WorldRay,
): Entity | null {
  const c = core(world);
  if (!c?.engine.uiHitTest_getHitEntity) return null;
  // Two rays when the caller has a screen: each entity is tested through the
  // projection it was drawn with. One ray is the older core's only question, and
  // the right answer to it while the two domains coincide.
  if (screenRay && c.engine.uiHitTest_updateDomains) {
    c.engine.uiHitTest_updateDomains(c.registry,
                                     ray.origin.x, ray.origin.y, ray.origin.z,
                                     ray.dir.x, ray.dir.y, ray.dir.z,
                                     screenRay.origin.x, screenRay.origin.y, screenRay.origin.z,
                                     screenRay.dir.x, screenRay.dir.y, screenRay.dir.z);
  } else if (c.engine.uiHitTest_update) {
    c.engine.uiHitTest_update(c.registry,
                              ray.origin.x, ray.origin.y, ray.origin.z,
                              ray.dir.x, ray.dir.y, ray.dir.z);
  } else {
    return null;
  }
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
