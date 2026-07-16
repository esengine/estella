// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
  Camera, CameraView, EditorView, Light2D, Sprite, Transform, Canvas, BoxCollider, CircleCollider,
  ParticleEmitter, OneWayPlatform,
  RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint, MotorJoint,
  UINode, UICameraInfo, screenToUiWorld, uiWorldToScreen, uiPickAllWorld, type UICameraData,
} from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';
import { projectDesignSeed } from './entitySources';
import { SceneModel } from './SceneModel';
import {
  type OBB,
  type ClientRect,
  quatAngleZ,
  obbCorners,
  pointInOBB,
  rectsIntersect,
  screenAABB,
  clamp,
  worldToLocal2D,
} from './viewportMath';

// World half-size of the pick/outline box for entities without renderable bounds
// (cameras, lights, empties) — so they're click-selectable like any sprite.
const ICON_WORLD_HALF = 24;
// Pick priority for icon-only entities: above any real sprite layer, so a small
// foreground gizmo (camera/light) wins a tie against a big sprite beneath it.
const ICON_PICK_LAYER = 1e6;

// The scene-authored joint components, each drawn as an anchor-to-anchor link gizmo.
// (The mouse/drag joint is imperative runtime API only — no component, nothing to draw.)
const JOINT_GIZMO_DEFS = {
  RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint, MotorJoint,
} as const;
export type JointGizmoType = keyof typeof JOINT_GIZMO_DEFS;

// The joint fields the gizmo reads. Anchors are world PIXELS in each body's local
// frame (PhysicsSystem converts to meters with ×invPpu); MotorJoint has no anchors
// (it drives the relative body transform), so both default to the body origin.
interface JointGizmoData {
  connectedEntity: number;
  anchorA?: { x: number; y: number };
  anchorB?: { x: number; y: number };
  axis?: { x: number; y: number };
  linearVelocity?: { x: number; y: number };
  enabled?: boolean;
}

// Entity-reference fields in the projected World hold RUNTIME ids — the bulk load
// remaps them (remapEntityFields) and the Reconciler's projectData mirrors that on
// every re-projection. -1 (authored none) / 0 (loader INVALID sentinel) = unlinked.
function jointConnectedRuntime(j: JointGizmoData): EntityId | null {
  const cid = j.connectedEntity;
  return typeof cid === 'number' && cid > 0 ? (cid as EntityId) : null;
}

// Structural shape of the engine's CameraView resource (screen<->world).
interface CameraViewLike {
  screenToWorld(x: number, y: number): { x: number; y: number } | null;
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
}

function cameraView(): CameraViewLike | null {
  const cv = EngineHost.getResource(CameraView) as unknown as CameraViewLike | undefined;
  return cv ?? null;
}

// The dedicated editor viewport camera — an engine resource, NOT a scene entity.
// Navigation mutates this in place; the camera system renders + resolves
// screen<->world through it in edit mode (see sdk EditorView / CameraPlugin), so
// panning/zooming/framing never touches — or dirties — the scene's game Camera.
function editorView(): { active: boolean; x: number; y: number; orthoSize: number } | null {
  return EngineHost.getResource(EditorView) ?? null;
}

/** DOM pointer position → engine screen space (buffer px, y-up). */
function clientToScreen(clientX: number, clientY: number): { sx: number; sy: number } | null {
  const canvas = EngineHost.canvas;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    sx: (clientX - rect.left) * dpr,
    sy: canvas.height - (clientY - rect.top) * dpr, // GL is y-up; flip
  };
}

/** The "screen" the design/device preview draws against — a Canvas' presentation
 *  fields, or the project design resolution when no Canvas is in the scene. */
export interface EditorScreenInfo {
  cx: number;
  cy: number;
  designResolution: { x: number; y: number };
  pixelsPerUnit: number;
  scaleMode: number;
  matchWidthOrHeight: number;
  backgroundColor: { r: number; g: number; b: number; a: number };
}

// Picking and screen<->world conversions for the viewport, all routed through
// the engine's own camera matrices (no projection assumptions).
export const ViewportController = {
  /** DOM pointer position → world coordinates. */
  canvasToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const cv = cameraView();
    const s = clientToScreen(clientX, clientY);
    if (!cv || !s) return null;
    return cv.screenToWorld(s.sx, s.sy);
  },

  /** World coordinates → CSS pixels relative to the canvas top-left (gizmo placement). */
  worldToClient(wx: number, wy: number): { x: number; y: number } | null {
    const cv = cameraView();
    const canvas = EngineHost.canvas;
    if (!cv || !canvas) return null;
    const s = cv.worldToScreen(wx, wy);
    if (!s) return null;
    const dpr = window.devicePixelRatio || 1;
    return { x: s.x / dpr, y: (canvas.height - s.y) / dpr }; // un-flip, to CSS px
  },

  /**
   * World-space oriented bounding box of any entity (rotation-aware). Sprites use
   * `size × scale` about their pivot; entities without renderable bounds (cameras,
   * lights, empties) get a fixed icon box so they're still selectable. The center is
   * the geometric center, which for an off-center pivot orbits the rotation pivot
   * (= transform position). Reads the parent-composed world transform — the same
   * fields the renderer draws from — so parented entities pick where they render.
   */
  entityBounds(id: EntityId): OBB | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    // UI nodes are screen-space; they're picked via the UI hit-test, not a world OBB.
    if (world.has(id, UINode)) return null;
    const t = world.get(id, Transform);
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });

    let w = ICON_WORLD_HALF * 2;
    let h = ICON_WORLD_HALF * 2;
    let px = 0.5;
    let py = 0.5;
    if (world.has(id, Sprite)) {
      const sp = world.get(id, Sprite);
      w = sp.size.x * t.worldScale.x;
      h = sp.size.y * t.worldScale.y;
      px = sp.pivot?.x ?? 0.5;
      py = sp.pivot?.y ?? 0.5;
    }
    const ox = w * (0.5 - px);
    const oy = h * (0.5 - py);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return {
      cx: t.worldPosition.x + ox * c - oy * s,
      cy: t.worldPosition.y + ox * s + oy * c,
      hw: Math.abs(w) / 2,
      hh: Math.abs(h) / 2,
      rot,
    };
  },

  /** UI entities under the pointer, most specific first; locked/hidden dropped. */
  pickUIEntities(clientX: number, clientY: number): EntityId[] {
    const world = EngineHost.world;
    const module = EngineHost.module;
    const cam = EngineHost.getResource(UICameraInfo) as UICameraData | undefined;
    if (!world || !module || !cam?.valid) return [];
    type Registry = Parameters<typeof uiPickAllWorld>[1];
    const reg = (world as unknown as { getCppRegistry(): Registry | null }).getCppRegistry();
    const s = clientToScreen(clientX, clientY);
    if (!reg || !s) return [];
    const wp = screenToUiWorld(cam, s.sx, s.sy);
    return uiPickAllWorld(module, reg, wp.x, wp.y).filter((hit) => {
      const src = SceneModel.sourceFor(hit);
      return src == null || (!SceneModel.isLocked(src) && !SceneModel.isHidden(src));
    });
  },

  /** The topmost UI entity under the pointer, or null. */
  pickUIEntity(clientX: number, clientY: number): EntityId | null {
    return this.pickUIEntities(clientX, clientY)[0] ?? null;
  },

  /** Selectable entities under the pointer, topmost-first (UI, then world by
   *  descending layer, later-drawn winning ties). `pickEntity` is its head;
   *  click-through cycling walks the rest. */
  pickEntitiesAt(clientX: number, clientY: number): EntityId[] {
    const out: EntityId[] = [...this.pickUIEntities(clientX, clientY)];

    const world = EngineHost.world;
    const wp = this.canvasToWorld(clientX, clientY);
    if (world && wp) {
      const hits: { e: EntityId; layer: number; i: number }[] = [];
      for (const e of world.getAllEntities()) {
        if (!world.has(e, Transform)) continue;
        // Locked / editor-hidden entities aren't click-selectable in the viewport.
        const src = SceneModel.sourceFor(e);
        if (src != null && (SceneModel.isLocked(src) || SceneModel.isHidden(src))) continue;
        const b = this.entityBounds(e);
        if (!b || !pointInOBB(wp.x, wp.y, b)) continue;
        const layer = world.has(e, Sprite) ? world.get(e, Sprite).layer : ICON_PICK_LAYER;
        hits.push({ e, layer, i: hits.length });
      }
      hits.sort((a, b) => b.layer - a.layer || b.i - a.i);
      for (const h of hits) out.push(h.e);
    }
    return out;
  },

  /** Topmost entity under the pointer — UI (screen-space) first, then a world OBB. */
  pickEntity(clientX: number, clientY: number): EntityId | null {
    return this.pickEntitiesAt(clientX, clientY)[0] ?? null;
  },

  /** Entities whose screen bounds intersect a client-space rect (marquee box-select). */
  pickInRect(rect: ClientRect): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Transform)) continue;
      const src = SceneModel.sourceFor(e);
      if (src != null && (SceneModel.isLocked(src) || SceneModel.isHidden(src))) continue;
      const r = this.getEntityScreenRect(e);
      if (r && rectsIntersect(rect, r)) out.push(e);
    }
    return out;
  },

  /**
   * The entity's world-space position — parent-composed, the same value the
   * renderer places it at. For UI nodes this is the laid-out box center (the
   * Yoga pass writes local `position`; the transform pass composes it), so the
   * gizmo lands on the element, not on its parent-relative offset.
   */
  getEntityWorldXY(id: EntityId): { x: number; y: number } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    return { x: t.worldPosition.x, y: t.worldPosition.y };
  },

  /** The entity's world rotation about Z (radians) — drives the local-space gizmo frame. */
  getEntityWorldAngleRad(id: EntityId): number {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return 0;
    const t = world.get(id, Transform);
    return quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
  },

  /**
   * A world point re-expressed in `parentId`'s live world frame — the local
   * `Transform.position` a child at that world spot must hold. No/invalid
   * parent ⇒ the point is already root-local.
   */
  worldToParentLocalXY(parentId: EntityId | null | undefined, wx: number, wy: number): { x: number; y: number } {
    const world = EngineHost.world;
    if (parentId == null || !world || !world.valid(parentId) || !world.has(parentId, Transform)) {
      return { x: wx, y: wy };
    }
    const t = world.get(parentId, Transform);
    return worldToLocal2D(wx, wy, {
      x: t.worldPosition.x,
      y: t.worldPosition.y,
      rot: quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number }),
      sx: t.worldScale.x,
      sy: t.worldScale.y,
    });
  },

  /** A UI-camera world point → CSS px relative to the canvas (UI is screen-space). */
  uiWorldToClient(cam: UICameraData, wx: number, wy: number): { x: number; y: number } | null {
    const canvas = EngineHost.canvas;
    if (!canvas) return null;
    const s = uiWorldToScreen(cam, wx, wy);
    const dpr = window.devicePixelRatio || 1;
    return { x: s.x / dpr, y: (canvas.height - s.y) / dpr };
  },

  /** World OBB of a UI node's resolved layout box (Yoga size × worldScale,
   *  pivot-centered on the world transform). */
  uiEntityWorldOBB(id: EntityId): OBB | null {
    const world = EngineHost.world;
    const module = EngineHost.module;
    if (!world || !module || !world.has(id, UINode) || !world.has(id, Transform)) return null;
    type Registry = Parameters<typeof uiPickAllWorld>[1];
    const reg = (world as unknown as { getCppRegistry(): Registry | null }).getCppRegistry();
    if (!reg) return null;
    const t = world.get(id, Transform);
    const w = module.uiNode_computedWidth(reg, id) * t.worldScale.x;
    const h = module.uiNode_computedHeight(reg, id) * t.worldScale.y;
    if (!(w > 0) || !(h > 0)) return null;
    return {
      cx: t.worldPosition.x,
      cy: t.worldPosition.y,
      hw: Math.abs(w) / 2,
      hh: Math.abs(h) / 2,
      rot: quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number }),
    };
  },

  /**
   * Screen rect of a UI node's layout box — its world OBB projected through the
   * UI camera. Drives the selection outline for UI, which lives in screen space.
   */
  uiEntityScreenRect(id: EntityId): ClientRect | null {
    const cam = EngineHost.getResource(UICameraInfo) as UICameraData | undefined;
    const obb = this.uiEntityWorldOBB(id);
    if (!cam?.valid || !obb) return null;
    return screenAABB(obbCorners(obb).map(([wx, wy]) => this.uiWorldToClient(cam, wx, wy)));
  },

  /** Screen-space bounding rect (CSS px rel. canvas) of an entity, for the selection outline. */
  getEntityScreenRect(id: EntityId): ClientRect | null {
    if (EngineHost.world?.has(id, UINode)) return this.uiEntityScreenRect(id);
    const b = this.entityBounds(id);
    if (!b) return null;
    return screenAABB(obbCorners(b).map(([wx, wy]) => this.worldToClient(wx, wy)));
  },

  /** Pan the editor view by a CSS-pixel drag (prev→cur). Moves only the editor camera. */
  panByClient(prevX: number, prevY: number, curX: number, curY: number): void {
    const view = editorView();
    if (!view) return;
    const a = this.canvasToWorld(prevX, prevY);
    const b = this.canvasToWorld(curX, curY);
    if (!a || !b) return;
    view.x += a.x - b.x;
    view.y += a.y - b.y;
  },

  /** Zoom the editor view: factor > 1 zooms out, < 1 zooms in (editor orthoSize). */
  zoomBy(factor: number): void {
    const view = editorView();
    if (!view) return;
    view.orthoSize = Math.max(8, Math.min(40000, view.orthoSize * factor));
  },

  /**
   * Frame a set of entities: center the editor view on their union bounds and zoom
   * to fit (with padding). Empty / single-point selections keep the current zoom and
   * just re-center, so a one-entity Frame doesn't jarringly snap the zoom.
   */
  frameSelection(ids: readonly EntityId[]): void {
    const view = editorView();
    const canvas = EngineHost.canvas;
    if (!view || ids.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of ids) {
      const b = this.entityBounds(id) ?? this.uiEntityWorldOBB(id);
      if (!b) continue;
      for (const [wx, wy] of obbCorners(b)) {
        minX = Math.min(minX, wx);
        minY = Math.min(minY, wy);
        maxX = Math.max(maxX, wx);
        maxY = Math.max(maxY, wy);
      }
    }
    if (!Number.isFinite(minX)) return;
    view.x = (minX + maxX) / 2;
    view.y = (minY + maxY) / 2;

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const aspect = canvas && canvas.height > 0 ? canvas.width / canvas.height : 1;
    // orthoSize is the view half-height; fit whichever axis is the binding constraint.
    const halfH = Math.max(spanY / 2, aspect > 0 ? spanX / 2 / aspect : spanX / 2) * 1.2;
    if (halfH > 1) view.orthoSize = clamp(halfH, 8, 40000);
  },

  /**
   * Frame the editor view on the Canvas' authored design frame — center it and zoom
   * so the whole design rect fits (with padding). This is what makes a design-resolution
   * change *read*: the free editor camera never adopts the design aspect (it fills the
   * panel), so a portrait resolution is only visible as its framed rect. Fitting whichever
   * design axis is the binding constraint against the panel aspect makes a portrait design
   * dominate the viewport vertically instead of hiding as a thin outline. No-op with no Canvas.
   *
   * The design frame is in the UI world scale where 1 unit = 1 design px — the SAME
   * invariant CameraPlugin's uiLayoutRect / buildCameraInfo lay UI + scene cameras out in.
   * `pixelsPerUnit` is a physics (metres) concern and must NOT enter here: dividing by it
   * would frame a box 100× smaller than the UI, zooming the real UI off-screen.
   */
  frameCanvas(): void {
    const view = editorView();
    const ci = this.screenInfo(); // Canvas if present, else the project design rect at origin
    const panel = EngineHost.canvas;
    if (!view) return;
    const desHalfW = ci.designResolution.x / 2;
    const desHalfH = ci.designResolution.y / 2;
    if (desHalfW <= 0 || desHalfH <= 0) return;
    view.x = ci.cx;
    view.y = ci.cy;
    const aspect = panel && panel.height > 0 ? panel.width / panel.height : 1;
    const halfH = Math.max(desHalfH, aspect > 0 ? desHalfW / aspect : desHalfW) * 1.1;
    view.orthoSize = clamp(halfH, 8, 40000);
  },

  /** Ids of the scene's camera entities — the camera-gizmo set (structural). */
  cameraIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (world.has(e, Camera) && world.has(e, Transform)) out.push(e);
    }
    return out;
  },

  /**
   * Screen-space icon position + authored view rect (CSS px) of a scene camera,
   * for drawing its gizmo. The rect is the camera's authored framing (orthoSize
   * half-height × the viewport aspect) — what that game camera is set to see.
   */
  getCameraGizmo(
    id: EntityId,
  ): { cx: number; cy: number; rect: { x: number; y: number; w: number; h: number } } | null {
    const world = EngineHost.world;
    const canvas = EngineHost.canvas;
    if (!world || !canvas || !world.valid(id) || !world.has(id, Camera) || !world.has(id, Transform)) {
      return null;
    }
    const t = world.get(id, Transform);
    const c = world.get(id, Camera) as { orthoSize?: number };
    const halfH = c.orthoSize ?? 360;
    const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
    const halfW = halfH * aspect;
    const x = t.worldPosition.x;
    const y = t.worldPosition.y;
    const center = this.worldToClient(x, y);
    if (!center) return null;
    const corners = [
      [x - halfW, y - halfH],
      [x + halfW, y - halfH],
      [x + halfW, y + halfH],
      [x - halfW, y + halfH],
    ].map(([wx, wy]) => this.worldToClient(wx, wy));
    if (corners.some((p) => !p)) return null;
    const xs = corners.map((p) => p!.x);
    const ys = corners.map((p) => p!.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return { cx: center.x, cy: center.y, rect: { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY } };
  },

  /** Ids of the scene's Light2D entities — the light-gizmo set (structural). */
  light2DIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (world.has(e, Light2D) && world.has(e, Transform)) out.push(e);
    }
    return out;
  },

  /**
   * Screen-space gizmo geometry for a Light2D: its icon position, reach radius (Point/Spot,
   * CSS px), and screen-space direction unit vector (Directional/Spot). `kind` mirrors
   * Light2DType (0 Point / 1 Directional / 2 Ambient / 3 Spot); `color` is the light tint.
   * `on` is the light's EFFECTIVE state in the projected World (authored enable folded with
   * the editor eye), so the viewport can show extinguished lights extinguished.
   */
  getLightGizmo(
    id: EntityId,
  ): { cx: number; cy: number; kind: number; color: string; radiusPx: number; sdx: number; sdy: number; coneHalf: number; on: boolean; handle: { x: number; y: number } | null } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Light2D) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const l = world.get(id, Light2D) as {
      type: number; color: { r: number; g: number; b: number }; radius: number;
      direction: { x: number; y: number }; outerAngle: number; enabled: boolean; intensity: number;
    };
    const center = this.worldToClient(t.worldPosition.x, t.worldPosition.y);
    if (!center) return null;

    // Point (0) / Spot (3) have a falloff radius; project a world-radius offset to CSS px.
    let radiusPx = 0;
    if (l.type === 0 || l.type === 3) {
      const edge = this.worldToClient(t.worldPosition.x + l.radius, t.worldPosition.y);
      if (edge) radiusPx = Math.hypot(edge.x - center.x, edge.y - center.y);
    }
    // Directional (1) / Spot (3) point along `direction`; flip world-Y to screen space. A Spot
    // with no direction defaults to aiming down (matching the engine's collectLights fallback).
    let sdx = 0;
    let sdy = 0;
    if (l.type === 1 || l.type === 3) {
      const len = Math.hypot(l.direction.x, l.direction.y);
      if (len > 1e-4) {
        sdx = l.direction.x / len;
        sdy = -l.direction.y / len;
      } else if (l.type === 3) {
        sdy = 1; // world (0,-1) → screen down
      }
    }
    const coneHalf = l.type === 3 ? ((l.outerAngle ?? 45) * 0.5 * Math.PI) / 180 : 0;
    const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
    const color = `#${hex(l.color.r)}${hex(l.color.g)}${hex(l.color.b)}`;
    const on = l.enabled !== false && l.intensity > 0;
    // Radius handle at the top of the reach circle (Point/Spot only — drag = radius).
    const handle = (l.type === 0 || l.type === 3)
      ? this.worldToClient(t.worldPosition.x, t.worldPosition.y + l.radius)
      : null;
    return { cx: center.x, cy: center.y, kind: l.type, color, radiusPx, sdx, sdy, coneHalf, on, handle: handle ?? null };
  },

  /** Ids of entities carrying a box/circle collider — the collider-gizmo set. */
  colliderIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (world.has(e, Transform) && (world.has(e, BoxCollider) || world.has(e, CircleCollider))) out.push(e);
    }
    return out;
  },

  // Collider sizes are physics meters; the world is pixels. Mirror the runtime's
  // live read (the Canvas entity's pixelsPerUnit, else 100) so the gizmo matches.
  colliderPixelsPerUnit(): number {
    const world = EngineHost.world;
    if (world) {
      for (const e of world.getAllEntities()) {
        if (world.has(e, Canvas)) {
          const ppu = (world.get(e, Canvas) as { pixelsPerUnit?: number }).pixelsPerUnit;
          if (ppu) return ppu;
        }
      }
    }
    return 100;
  },

  /**
   * The scene's Canvas singleton — the design-resolution preview source — or null.
   * Reads the first entity carrying a Canvas (the same singleton-per-scene assumption
   * as the runtime's registry_getCanvasEntity), centered on its Transform.
   */
  canvasInfo(): EditorScreenInfo | null {
    const world = EngineHost.world;
    if (!world) return null;
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Canvas)) continue;
      const c = world.get(e, Canvas) as {
        designResolution: { x: number; y: number };
        pixelsPerUnit: number;
        scaleMode: number;
        matchWidthOrHeight: number;
        backgroundColor: { r: number; g: number; b: number; a: number };
      };
      const t = world.has(e, Transform) ? world.get(e, Transform) : null;
      return {
        cx: t?.worldPosition.x ?? 0,
        cy: t?.worldPosition.y ?? 0,
        designResolution: c.designResolution,
        pixelsPerUnit: c.pixelsPerUnit || 100,
        scaleMode: c.scaleMode,
        matchWidthOrHeight: c.matchWidthOrHeight,
        backgroundColor: c.backgroundColor,
      };
    }
    return null;
  },

  /**
   * The effective "screen" for the design/device preview: the scene's Canvas when
   * present (UI-authored), else the PROJECT design resolution centered at origin.
   * This is what decouples the device preview from the UI layer — a pure gameplay
   * scene (no Canvas) still previews on any device against the project reference
   * resolution, and the device dropdown works in any editor mode. Never null.
   *
   * Without a Canvas the fit uses FixedHeight (the engine's Canvas default) so the
   * device frame has a defined shape; once a project camera-fit is set it drives this.
   */
  screenInfo(): EditorScreenInfo {
    const canvas = this.canvasInfo();
    if (canvas) return canvas;
    const d = projectDesignSeed();
    return {
      cx: 0, cy: 0,
      designResolution: { x: d.width, y: d.height },
      pixelsPerUnit: 100,
      scaleMode: 1, // CanvasScaleMode.FixedHeight — the engine's Canvas default
      matchWidthOrHeight: 0.5,
      // No Canvas ⇒ no authored letterbox tint; the overlay falls back to a neutral scrim.
      backgroundColor: { r: 0, g: 0, b: 0, a: 0 },
    };
  },

  /**
   * Offset-aware world center of the entity's box/circle collider (world px) — the
   * point radius/size drags measure from, matching where the gizmo shape is drawn.
   * Falls back to the entity origin when there's no collider.
   */
  colliderWorldCenter(id: EntityId): { x: number; y: number } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const off = world.has(id, BoxCollider)
      ? (world.get(id, BoxCollider) as { offset: { x: number; y: number } }).offset
      : world.has(id, CircleCollider)
        ? (world.get(id, CircleCollider) as { offset: { x: number; y: number } }).offset
        : null;
    if (!off || (off.x === 0 && off.y === 0)) return { x: t.worldPosition.x, y: t.worldPosition.y };
    const ppu = this.colliderPixelsPerUnit();
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
    return {
      x: t.worldPosition.x + (off.x * ppu) * Math.cos(rot) - (off.y * ppu) * Math.sin(rot),
      y: t.worldPosition.y + (off.x * ppu) * Math.sin(rot) + (off.y * ppu) * Math.cos(rot),
    };
  },

  /**
   * Screen-space collider outline for the gizmo: a 4-corner polygon (box) or a
   * center + radius (circle), in CSS px. The collider lives at the entity's world
   * transform + its (meter) offset, scaled to pixels by pixelsPerUnit. `cx/cy` is
   * the shape's screen center for both kinds. `oneWay` is the OneWayPlatform solid-
   * side normal as a screen unit vector (world-space — contact normals don't rotate
   * with the entity), or null when the entity has none / it's disabled.
   */
  getColliderGizmo(
    id: EntityId,
    ppuHint?: number,
  ): { kind: 'box'; cx: number; cy: number; r: number; pts: Array<{ x: number; y: number }>; handle: { x: number; y: number } | null; sizeHandle: { x: number; y: number } | null; oneWay: { dx: number; dy: number } | null } | { kind: 'circle'; cx: number; cy: number; r: number; pts: Array<{ x: number; y: number }>; handle: { x: number; y: number } | null; sizeHandle: { x: number; y: number } | null; oneWay: { dx: number; dy: number } | null } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    // pixelsPerUnit is a scene-wide constant; callers looping many colliders pass
    // it in to avoid re-scanning all entities for the Canvas once per collider.
    const ppu = ppuHint ?? this.colliderPixelsPerUnit();
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const placeOffset = (off: { x: number; y: number }) => ({
      x: t.worldPosition.x + (off.x * ppu) * cos - (off.y * ppu) * sin,
      y: t.worldPosition.y + (off.x * ppu) * sin + (off.y * ppu) * cos,
    });
    // One-way platforms cancel contacts approaching from behind `normal` — show the
    // solid side. The normal is world-space (screen y flips), independent of rotation.
    let oneWay: { dx: number; dy: number } | null = null;
    if (world.has(id, OneWayPlatform)) {
      const ow = world.get(id, OneWayPlatform) as { normal: { x: number; y: number }; enabled: boolean };
      const len = Math.hypot(ow.normal.x, ow.normal.y);
      if (ow.enabled !== false && len > 1e-4) oneWay = { dx: ow.normal.x / len, dy: -ow.normal.y / len };
    }

    if (world.has(id, BoxCollider)) {
      const b = world.get(id, BoxCollider) as { halfExtents: { x: number; y: number }; offset: { x: number; y: number } };
      const c = placeOffset(b.offset);
      const hw = b.halfExtents.x * ppu;
      const hh = b.halfExtents.y * ppu;
      const centerS = this.worldToClient(c.x, c.y);
      const screen = obbCorners({ cx: c.x, cy: c.y, hw: Math.abs(hw), hh: Math.abs(hh), rot }).map(([wx, wy]) =>
        this.worldToClient(wx, wy),
      );
      if (!centerS || screen.some((p) => !p)) return null;
      const bs = screen.map((p) => ({ x: p!.x, y: p!.y }));
      // Size handle at the +hw,+hh corner (obbCorners index 2) — drag = halfExtents.
      return { kind: 'box', cx: centerS.x, cy: centerS.y, r: 0, pts: bs, handle: null, sizeHandle: bs[2], oneWay };
    }

    const cc = world.get(id, CircleCollider) as { radius: number; offset: { x: number; y: number } };
    const c = placeOffset(cc.offset);
    const center = this.worldToClient(c.x, c.y);
    const edge = this.worldToClient(c.x + cc.radius * ppu, c.y);
    if (!center || !edge) return null;
    // Radius handle at the top of the circle (drag = radius, in physics meters).
    const handle = this.worldToClient(c.x, c.y + cc.radius * ppu);
    return { kind: 'circle', cx: center.x, cy: center.y, r: Math.hypot(edge.x - center.x, edge.y - center.y), pts: [], handle: handle ?? null, sizeHandle: null, oneWay };
  },

  /** (entity, joint-type) pairs for every scene-authored joint — the joint-gizmo set. */
  jointGizmoKeys(): Array<{ id: EntityId; type: JointGizmoType }> {
    const world = EngineHost.world;
    if (!world) return [];
    const out: Array<{ id: EntityId; type: JointGizmoType }> = [];
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Transform)) continue;
      for (const type of Object.keys(JOINT_GIZMO_DEFS) as JointGizmoType[]) {
        if (world.has(e, JOINT_GIZMO_DEFS[type])) out.push({ id: e, type });
      }
    }
    return out;
  },

  /**
   * Screen-space link geometry for a scene-authored joint: the anchor on the joint's
   * own body (`b`), the anchor on the connected body (`a`, null while connectedEntity
   * is unset — the joint is inert until it links), plus the type-specific directions:
   * `axis` = prismatic/wheel slide axis (local to the CONNECTED body, Box2D
   * localFrameA — see PhysicsJoints.cpp), `vel` = motor target linear velocity.
   * Anchors are world px in each body's local frame (PhysicsSystem ×invPpu → meters);
   * MotorJoint has none, so both ends sit at the body origins.
   */
  getJointGizmo(
    id: EntityId,
    type: JointGizmoType,
  ): { b: { x: number; y: number }; a: { x: number; y: number } | null; axis: { dx: number; dy: number } | null; vel: { dx: number; dy: number } | null; on: boolean } | null {
    const world = EngineHost.world;
    const def = JOINT_GIZMO_DEFS[type];
    if (!world || !def || !world.valid(id) || !world.has(id, def) || !world.has(id, Transform)) return null;
    const j = world.get(id, def) as JointGizmoData;
    const anchorOn = (eid: EntityId, anchor: { x: number; y: number }) => {
      const tt = world.get(eid, Transform);
      const r = quatAngleZ(tt.worldRotation as { w: number; x: number; y: number; z: number });
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      return this.worldToClient(
        tt.worldPosition.x + anchor.x * cos - anchor.y * sin,
        tt.worldPosition.y + anchor.x * sin + anchor.y * cos,
      );
    };
    const b = anchorOn(id, j.anchorB ?? { x: 0, y: 0 });
    if (!b) return null;

    const cid = jointConnectedRuntime(j);
    let a: { x: number; y: number } | null = null;
    let axis: { dx: number; dy: number } | null = null;
    if (cid != null && world.valid(cid) && world.has(cid, Transform)) {
      a = anchorOn(cid, j.anchorA ?? { x: 0, y: 0 });
      if (j.axis) {
        const len = Math.hypot(j.axis.x, j.axis.y);
        if (len > 1e-4) {
          const tc = world.get(cid, Transform);
          const r = quatAngleZ(tc.worldRotation as { w: number; x: number; y: number; z: number });
          const wx = (j.axis.x * Math.cos(r) - j.axis.y * Math.sin(r)) / len;
          const wy = (j.axis.x * Math.sin(r) + j.axis.y * Math.cos(r)) / len;
          axis = { dx: wx, dy: -wy }; // world → screen y-flip
        }
      }
    }
    let vel: { dx: number; dy: number } | null = null;
    if (j.linearVelocity) {
      const len = Math.hypot(j.linearVelocity.x, j.linearVelocity.y);
      if (len > 1e-4) vel = { dx: j.linearVelocity.x / len, dy: -j.linearVelocity.y / len };
    }
    return { b, a, axis, vel, on: j.enabled !== false };
  },

  /**
   * The local frame a joint-anchor drag converts the cursor into: the world pose of
   * the body that OWNS the anchor — the joint's entity for `anchorB` ('b'), the
   * connected entity for `anchorA` ('a'). Null while the connected end is unset (an
   * inert joint's `a` anchor has no frame to edit in).
   */
  jointAnchorFrame(
    id: EntityId,
    type: JointGizmoType,
    end: 'a' | 'b',
  ): { x: number; y: number; rot: number } | null {
    const world = EngineHost.world;
    const def = JOINT_GIZMO_DEFS[type];
    if (!world || !def || !world.valid(id) || !world.has(id, def) || !world.has(id, Transform)) return null;
    let eid = id;
    if (end === 'a') {
      const cid = jointConnectedRuntime(world.get(id, def) as JointGizmoData);
      if (cid == null || !world.valid(cid) || !world.has(cid, Transform)) return null;
      eid = cid;
    }
    const t = world.get(eid, Transform);
    return {
      x: t.worldPosition.x,
      y: t.worldPosition.y,
      rot: quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number }),
    };
  },

  /**
   * The frame an axis drag (prismatic/wheel slide direction) works in: the world
   * point of anchorA plus the CONNECTED body's rotation (the axis lives in body A's
   * local frame — Box2D localFrameA). Null while unlinked.
   */
  jointAxisFrame(
    id: EntityId,
    type: JointGizmoType,
  ): { x: number; y: number; rot: number } | null {
    const world = EngineHost.world;
    const def = JOINT_GIZMO_DEFS[type];
    if (!world || !def || !world.valid(id) || !world.has(id, def)) return null;
    const j = world.get(id, def) as JointGizmoData;
    const cid = jointConnectedRuntime(j);
    if (cid == null || !world.valid(cid) || !world.has(cid, Transform)) return null;
    const t = world.get(cid, Transform);
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
    const a = j.anchorA ?? { x: 0, y: 0 };
    return {
      x: t.worldPosition.x + a.x * Math.cos(rot) - a.y * Math.sin(rot),
      y: t.worldPosition.y + a.x * Math.sin(rot) + a.y * Math.cos(rot),
      rot,
    };
  },

  /** Ids of entities carrying a ParticleEmitter — the emitter-gizmo set. */
  particleEmitterIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (world.has(e, ParticleEmitter) && world.has(e, Transform)) out.push(e);
    }
    return out;
  },

  /**
   * Screen-space gizmo geometry for a ParticleEmitter's SPAWN shape. Particles don't
   * simulate in edit mode, so the emitter is otherwise invisible on the canvas — this
   * outlines WHERE particles are born (and, for a Cone, which way they aim): a marker
   * (Point), a radius circle (Circle), an oriented box (Rectangle), or an aim wedge
   * (Cone, local up ±shapeAngle/2 out to shapeRadius). Sizes are world pixels
   * (shapeRadius/shapeSize match world position — NO pixelsPerUnit, unlike colliders),
   * projected through the camera like the collider gizmo. `on` folds the enable so a
   * disabled emitter dims.
   */
  getParticleEmitterGizmo(
    id: EntityId,
  ): { cx: number; cy: number; kind: 'point' | 'circle' | 'poly'; r: number; pts: Array<{ x: number; y: number }>; spread: Array<{ x: number; y: number }> | null; on: boolean; handle: { x: number; y: number } | null; sizeHandle: { x: number; y: number } | null; angleHandle: { x: number; y: number } | null } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, ParticleEmitter) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const p = world.get(id, ParticleEmitter) as {
      shape: number; shapeRadius: number; shapeSize: { x: number; y: number }; shapeAngle: number;
      angleSpreadMin: number; angleSpreadMax: number; enabled: boolean;
    };
    const center = this.worldToClient(t.worldPosition.x, t.worldPosition.y);
    if (!center) return null;
    const on = p.enabled !== false;
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Rotate an emitter-local offset (world px) into world space — mirrors the sim's
    // world-space direction rotation (ParticleSystem::emitParticles).
    const toWorld = (lx: number, ly: number) => ({
      x: t.worldPosition.x + lx * cos - ly * sin,
      y: t.worldPosition.y + lx * sin + ly * cos,
    });

    // Point/Rect aim by angleSpread (0° = local +X, CCW — randomDirection); Circle
    // aims radially and Cone by shapeAngle, so only the former two get the wedge.
    // The full-circle default (0..360) draws nothing — no aim to show.
    const spreadWedge = (reach: number): Array<{ x: number; y: number }> | null => {
      const span = p.angleSpreadMax - p.angleSpreadMin;
      if (span <= 0 || span >= 360) return null;
      const STEPS = Math.max(2, Math.ceil(span / 15));
      const pts: Array<{ x: number; y: number }> = [{ x: center.x, y: center.y }];
      for (let i = 0; i <= STEPS; i++) {
        const a = (p.angleSpreadMin + span * (i / STEPS)) * (Math.PI / 180);
        const w = toWorld(Math.cos(a) * reach, Math.sin(a) * reach);
        const s = this.worldToClient(w.x, w.y);
        if (!s) return null;
        pts.push({ x: s.x, y: s.y });
      }
      return pts;
    };

    switch (p.shape) {
      case 1: {  // Circle — spawn disk of shapeRadius
        const edge = this.worldToClient(t.worldPosition.x + p.shapeRadius, t.worldPosition.y);
        const r = edge ? Math.hypot(edge.x - center.x, edge.y - center.y) : 0;
        // Radius handle at the top of the ring (drag to resize shapeRadius).
        const handle = this.worldToClient(t.worldPosition.x, t.worldPosition.y + p.shapeRadius);
        return { cx: center.x, cy: center.y, kind: 'circle', r, pts: [], spread: null, on, handle: handle ?? null, sizeHandle: null, angleHandle: null };
      }
      case 2: {  // Rectangle — oriented spawn box of shapeSize
        const corners = obbCorners({
          cx: t.worldPosition.x, cy: t.worldPosition.y,
          hw: Math.abs(p.shapeSize.x) * 0.5, hh: Math.abs(p.shapeSize.y) * 0.5, rot,
        }).map(([wx, wy]) => this.worldToClient(wx, wy));
        if (corners.some((s) => !s)) return null;
        const cs = corners.map((s) => ({ x: s!.x, y: s!.y }));
        const reach = Math.max(48, Math.hypot(p.shapeSize.x, p.shapeSize.y) * 0.5 + 16);
        // Size handle at the +halfW,+halfH corner (obbCorners index 2) — drag = shapeSize.
        return { cx: center.x, cy: center.y, kind: 'poly', r: 0, pts: cs, spread: spreadWedge(reach), on, handle: null, sizeHandle: cs[2], angleHandle: null };
      }
      case 3: {  // Cone — aim wedge: local up (0,1) swept ±shapeAngle/2, out to shapeRadius
        const half = Math.max(0, p.shapeAngle) * 0.5 * (Math.PI / 180);
        const rad = p.shapeRadius > 0 ? p.shapeRadius : 60;
        const STEPS = 12;
        const pts: Array<{ x: number; y: number }> = [{ x: center.x, y: center.y }];  // apex
        for (let i = 0; i <= STEPS; i++) {
          const a = -half + (2 * half) * (i / STEPS);
          const w = toWorld(Math.sin(a) * rad, Math.cos(a) * rad);
          const s = this.worldToClient(w.x, w.y);
          if (!s) return null;
          pts.push({ x: s.x, y: s.y });
        }
        // Radius handle at the wedge's forward tip (drag to resize shapeRadius/reach);
        // angle handle at the +half-angle edge (drag to widen/narrow shapeAngle).
        const tip = toWorld(0, rad);
        const handleS = this.worldToClient(tip.x, tip.y);
        const edge = toWorld(Math.sin(half) * rad, Math.cos(half) * rad);
        const angleS = this.worldToClient(edge.x, edge.y);
        return { cx: center.x, cy: center.y, kind: 'poly', r: 0, pts, spread: null, on, handle: handleS ?? null, sizeHandle: null, angleHandle: angleS ?? null };
      }
      default:  // Point (0) — a marker at the emitter (the clickable icon) + its aim wedge
        return { cx: center.x, cy: center.y, kind: 'point', r: 0, pts: [], spread: spreadWedge(48), on, handle: null, sizeHandle: null, angleHandle: null };
    }
  },
};
