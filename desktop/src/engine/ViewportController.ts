// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
  Camera, CameraView, EditorView, Light2D, Sprite, Transform, Canvas, BoxCollider, CircleCollider,
  CapsuleCollider, SegmentCollider, PolygonCollider, ChainCollider,
  ParticleEmitter, OneWayPlatform, RigidBody,
  RevoluteJoint, DistanceJoint, PrismaticJoint, WeldJoint, WheelJoint, MotorJoint,
  UINode, UICameraInfo, screenToUiWorld, uiWorldToScreen, uiPickAllWorld, type UICameraData,
  type EditorViewData,
  Marker,
  TilemapLayer, TilemapAPI, decodeTilemapChunks, CHUNK_SIZE, tileCollisionOutlines,
  tileCellCenter, tileCellOutline, isNonOrthogonal,
  readColliderShapes, colliderShapeOutline, shapeCenter,
  type TilesetModel, type TileCollisionPiece, type TileGridParams,
} from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';
import { projectDesignSeed, projectCameraFit } from './projectSeams';
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
  screenToWorld(x: number, y: number, planeZ?: number): { x: number; y: number } | null;
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
function editorView(): EditorViewData | null {
  return EngineHost.getResource(EditorView) ?? null;
}

/**
 * The quantity zoom scales, which differs by projection but behaves the same.
 *
 * Orthographically it is the half-height of the view box. In perspective it is
 * the camera's distance — and on the z = 0 plane, where 2D content lives, the
 * visible extent is proportional to distance exactly as it is to orthoSize. That
 * is what lets one zoom formula serve both instead of two that drift.
 */
const ZOOM_MIN = 8;
const ZOOM_MAX = 40000;
function zoomAmount(view: EditorViewData): number {
  return view.perspective ? view.distance : view.orthoSize;
}
function setZoomAmount(view: EditorViewData, value: number): void {
  const v = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value));
  if (view.perspective) view.distance = v;
  else view.orthoSize = v;
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

/** A draggable collider point handle (CSS px) + the field it writes. `index` null = a
 *  Vec2 field (box/circle/capsule offset, segment endpoint); ≥ 0 = one element of a
 *  Vec2[] (polygon vertex, chain point). One drag channel edits every collider point. */
export interface ColliderPointHandle {
  x: number;
  y: number;
  comp: string;
  key: string;
  index: number | null;
}

/** Screen-space gizmo for EVERY collider on an entity: the merged outline as SVG path
 *  data (solid + dashed-sensor, CSS px), the one-way arrow, the box-size / circle-radius
 *  scalar handles, and every draggable point (vertices / endpoints / offsets). All six
 *  shapes project through the shared `colliderShapeOutline` seam — the same geometry
 *  PhysicsDebugDraw and the tile-collision overlay use. */
export interface ColliderGizmo {
  outline: string;
  outlineSensor: string;
  oneWay: { cx: number; cy: number; dx: number; dy: number } | null;
  sizeHandle: { x: number; y: number } | null;
  radiusHandle: { x: number; y: number } | null;
  points: ColliderPointHandle[];
}

/** World AABB union of the scene's content — the extent the minimap fits into. */
export interface MinimapBounds { minX: number; minY: number; maxX: number; maxY: number; }
/** One schematic box in the minimap: an entity's world AABB + a coarse kind for colour. */
export interface MinimapBox { x0: number; y0: number; x1: number; y1: number; kind: 'sprite' | 'tile' | 'icon'; }

// Above this many boxes the minimap stops collecting (bounds still cover everything
// collected) — a schematic overview needs the layout, not thousands of rects/rebuild.
const MINIMAP_BOX_CAP = 800;

// Picking and screen<->world conversions for the viewport, all routed through
// the engine's own camera matrices (no projection assumptions).
export const ViewportController = {
  /**
   * DOM pointer position → world coordinates on the plane at @p planeZ.
   *
   * The default plane is the 2D one, which is the whole answer under an
   * orthographic view — a screen point's world x/y do not change with depth
   * there. In a perspective view they do, so anything that hits or drags a
   * specific entity should pass that entity's z; navigation (pan, zoom, framing)
   * keeps the 2D plane, which is the plane it is navigating over.
   */
  canvasToWorld(clientX: number, clientY: number, planeZ = 0): { x: number; y: number } | null {
    const cv = cameraView();
    const s = clientToScreen(clientX, clientY);
    if (!cv || !s) return null;
    return cv.screenToWorld(s.sx, s.sy, planeZ);
  },

  /** The world z an entity sits on — the plane its picking and dragging happen on. */
  entityPlaneZ(e: EntityId): number {
    const world = EngineHost.world;
    if (!world || !world.has(e, Transform)) return 0;
    return (world.get(e, Transform) as { position?: { z?: number } }).position?.z ?? 0;
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

  /** UI entities under the pointer, most specific first; unpickable ones dropped. */
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
      return src == null || SceneModel.isPickable(src);
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
    if (world) {
      const hits: { e: EntityId; layer: number; i: number }[] = [];
      // The cursor is tested against each candidate ON ITS OWN PLANE. One shared
      // world point would be the 2D projection of the cursor, which under a
      // perspective view is where a sprite's shadow falls rather than where the
      // sprite is — so anything off the z = 0 plane would be unclickable at the
      // place it is drawn. Orthographically every plane gives the same point, so
      // this costs an unproject per candidate and changes no answer.
      for (const e of world.getAllEntities()) {
        if (!world.has(e, Transform)) continue;
        // Locked / editor-hidden / environment entities aren't click-selectable.
        const src = SceneModel.sourceFor(e);
        if (src != null && !SceneModel.isPickable(src)) continue;
        const wp = this.canvasToWorld(clientX, clientY, this.entityPlaneZ(e));
        const b = this.entityBounds(e);
        if (!wp || !b || !pointInOBB(wp.x, wp.y, b)) continue;
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
      if (src != null && !SceneModel.isPickable(src)) continue;
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
    setZoomAmount(view, zoomAmount(view) * factor);
  },

  /** Zoom about the cursor: the world point under (clientX, clientY) stays put, so
   *  you zoom INTO what you're looking at (Figma/Blender/Godot). Analytic — no
   *  post-zoom re-project (the engine camera only updates next frame): for an ortho
   *  camera the world offset from center scales with orthoSize, so the new center is
   *  `view + (W − view)·(1 − factor)`. */
  zoomAtClient(clientX: number, clientY: number, factor: number): void {
    const view = editorView();
    if (!view) return;
    const w = this.canvasToWorld(clientX, clientY); // current matrices — read BEFORE zoom
    const before = zoomAmount(view);
    setZoomAmount(view, before * factor);
    const applied = zoomAmount(view) / before; // clamped factor
    if (w) {
      view.x += (w.x - view.x) * (1 - applied);
      view.y += (w.y - view.y) * (1 - applied);
    }
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

  /** World center + half-extents of the editor camera's visible rect — the minimap's
   *  camera indicator. Half-height = orthoSize; half-width = orthoSize × panel aspect. */
  editorViewRect(): { cx: number; cy: number; halfW: number; halfH: number } | null {
    const view = editorView();
    const canvas = EngineHost.canvas;
    if (!view) return null;
    const aspect = canvas && canvas.height > 0 ? canvas.width / canvas.height : 1;
    return { cx: view.x, cy: view.y, halfW: view.orthoSize * aspect, halfH: view.orthoSize };
  },

  /** Recenter the editor view on a world point (minimap click / drag navigation). Leaves
   *  zoom untouched — the minimap moves the camera, it doesn't reframe. */
  centerViewOn(wx: number, wy: number): void {
    const view = editorView();
    if (!view) return;
    view.x = wx;
    view.y = wy;
  },

  /** World AABB of a painted tilemap layer from its chunk-grid bounds (cheap — chunk
   *  granularity, no per-tile scan). Tiles extend +x / −y from the layer origin, matching
   *  tileCollisionOutlines. Null for an empty / unsized layer. */
  tilemapWorldAABB(rt: EntityId): { x0: number; y0: number; x1: number; y1: number } | null {
    const world = EngineHost.world;
    if (!world || !world.has(rt, TilemapLayer) || !world.has(rt, Transform)) return null;
    const layer = world.get(rt, TilemapLayer) as { cellSize: { x: number; y: number } };
    const tw = layer.cellSize.x, th = layer.cellSize.y;
    if (!(tw > 0) || !(th > 0)) return null;
    const chunks = decodeTilemapChunks(TilemapAPI.exportChunks(rt) || '');
    if (chunks.length === 0) return null;
    let cMinX = Infinity, cMinY = Infinity, cMaxX = -Infinity, cMaxY = -Infinity;
    for (const c of chunks) {
      cMinX = Math.min(cMinX, c.x); cMinY = Math.min(cMinY, c.y);
      cMaxX = Math.max(cMaxX, c.x); cMaxY = Math.max(cMaxY, c.y);
    }
    const t = world.get(rt, Transform);
    const ox = t.worldPosition.x, oy = t.worldPosition.y;
    return {
      x0: ox + cMinX * CHUNK_SIZE * tw,
      x1: ox + (cMaxX + 1) * CHUNK_SIZE * tw,
      y0: oy - (cMaxY + 1) * CHUNK_SIZE * th, // bottom (larger cellY = lower world y)
      y1: oy - cMinY * CHUNK_SIZE * th,       // top
    };
  },

  /** Schematic overview of the scene for the viewport minimap: every entity's world AABB
   *  (a coarse kind for colour) and their union bounds. Sprites use their rendered box,
   *  tilemaps their painted extent, everything else an icon box — the same bounds Frame
   *  reads. Cheap enough to recompute on structural / data change; the minimap projects
   *  these into its panel and the rAF overlays the live camera rect. UI nodes are
   *  screen-space, so they're excluded. */
  minimapBoxes(): { bounds: MinimapBounds | null; boxes: MinimapBox[] } {
    const world = EngineHost.world;
    const boxes: MinimapBox[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x0: number, y0: number, x1: number, y1: number, kind: MinimapBox['kind']) => {
      if (boxes.length < MINIMAP_BOX_CAP) boxes.push({ x0, y0, x1, y1, kind });
      minX = Math.min(minX, x0); minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    };
    if (world) {
      for (const e of world.getAllEntities()) {
        if (!world.valid(e) || !world.has(e, Transform) || world.has(e, UINode)) continue;
        if (world.has(e, TilemapLayer)) {
          const tb = this.tilemapWorldAABB(e);
          if (tb) { add(tb.x0, tb.y0, tb.x1, tb.y1, 'tile'); continue; }
        }
        const b = this.entityBounds(e);
        if (!b) continue;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [wx, wy] of obbCorners(b)) {
          x0 = Math.min(x0, wx); y0 = Math.min(y0, wy);
          x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
        }
        add(x0, y0, x1, y1, world.has(e, Sprite) ? 'sprite' : 'icon');
      }
    }
    const bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    return { bounds, boxes };
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

  /** Ids of the scene's Marker (point-object) entities — the marker-pin gizmo set. A
   *  Marker renders nothing, so it's drawn as an always-on pin at its position. */
  markerIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      // A pin is for POINT markers only — a Marker + Transform with no body of its own.
      // A Trigger Area also carries a Marker but has a RigidBody + sensor collider (shown
      // by the collider gizmo), so a pin on top of its outline would just be clutter.
      if (world.has(e, Marker) && world.has(e, Transform) && !world.has(e, RigidBody)) out.push(e);
    }
    return out;
  },

  /** Screen-space position of a Marker's pin (its Transform world position → canvas px),
   *  and its `type` label, or null when off-camera/removed. */
  getMarkerGizmo(id: EntityId): { cx: number; cy: number; type: string; properties: Record<string, string> } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Marker) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const m = world.get(id, Marker) as { type?: string; properties?: Record<string, string> };
    const p = this.worldToClient(t.worldPosition.x, t.worldPosition.y);
    return p ? {
      cx: p.x, cy: p.y,
      type: typeof m.type === 'string' ? m.type : '',
      properties: m.properties && typeof m.properties === 'object' ? m.properties : {},
    } : null;
  },

  /** Ids of entities carrying ANY collider (box/circle/capsule/segment/polygon/chain) —
   *  the collider-gizmo set. All six render through the shared shape-outline projection. */
  colliderIds(): EntityId[] {
    const world = EngineHost.world;
    if (!world) return [];
    const out: EntityId[] = [];
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Transform)) continue;
      if (world.has(e, BoxCollider) || world.has(e, CircleCollider) || world.has(e, CapsuleCollider)
        || world.has(e, SegmentCollider) || world.has(e, PolygonCollider) || world.has(e, ChainCollider)) {
        out.push(e);
      }
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
    const fit = projectCameraFit(); // { scaleMode, matchWidthOrHeight }; scaleMode -1 ⇒ off
    // Project camera fit is on ⇒ it is authoritative for the camera (overrides the Canvas),
    // so the device frame must preview THAT: the project design resolution + fit mode.
    if (fit.scaleMode >= 0) {
      const d = projectDesignSeed();
      return {
        cx: canvas?.cx ?? 0,
        cy: canvas?.cy ?? 0,
        designResolution: { x: d.width, y: d.height },
        pixelsPerUnit: canvas?.pixelsPerUnit ?? 100,
        scaleMode: fit.scaleMode,
        matchWidthOrHeight: fit.matchWidthOrHeight,
        backgroundColor: canvas?.backgroundColor ?? { r: 0, g: 0, b: 0, a: 0 },
      };
    }
    // No project fit: the Canvas (its own scaleMode) when present, else the project
    // design resolution with FixedHeight (the engine's Canvas default) so the frame
    // has a defined shape.
    if (canvas) return canvas;
    const d = projectDesignSeed();
    return {
      cx: 0, cy: 0,
      designResolution: { x: d.width, y: d.height },
      pixelsPerUnit: 100,
      scaleMode: 1, // CanvasScaleMode.FixedHeight
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
   * Screen-space gizmo for EVERY collider on `id`, projected through the shared
   * `readColliderShapes` + `colliderShapeOutline` seam so all six shapes (box / circle /
   * capsule / segment / polygon / chain) render one way — identical geometry to
   * PhysicsDebugDraw and the tile-collision overlay. Merged outline path data (solid +
   * dashed-sensor), the one-way arrow, box-size / circle-radius scalar handles, and the
   * draggable point handles (vertices / endpoints / offsets). `ppuHint` avoids re-scanning
   * for the Canvas once per collider. Null when the entity has no collider / no transform.
   */
  getColliderGizmo(id: EntityId, ppuHint?: number): ColliderGizmo | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const ppu = ppuHint ?? this.colliderPixelsPerUnit();
    const rot = quatAngleZ(t.worldRotation as { w: number; x: number; y: number; z: number });
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const wp = { x: t.worldPosition.x, y: t.worldPosition.y };

    // readColliderShapes only reads (has/get); the editor world is the readonly view.
    const instances = readColliderShapes(world as unknown as Parameters<typeof readColliderShapes>[0], id);
    if (instances.length === 0) return null;

    // A world-px outline → SVG path data in CSS px (polylines as move/line runs, a circle
    // as two half-arcs). A run drops out if any of its points is off-camera.
    const outlinePath = (o: { polylines: Array<Array<{ x: number; y: number }>>; circles: Array<{ c: { x: number; y: number }; r: number }> }): string => {
      let d = '';
      for (const line of o.polylines) {
        let seg = '';
        for (let i = 0; i < line.length; i++) {
          const s = this.worldToClient(line[i].x, line[i].y);
          if (!s) { seg = ''; break; }
          seg += `${i ? 'L' : 'M'}${s.x},${s.y}`;
        }
        if (seg) d += `${seg} `;
      }
      for (const c of o.circles) {
        const ctr = this.worldToClient(c.c.x, c.c.y);
        const edge = this.worldToClient(c.c.x + c.r, c.c.y);
        if (!ctr || !edge) continue;
        const r = Math.hypot(edge.x - ctr.x, edge.y - ctr.y);
        d += `M${ctr.x - r},${ctr.y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0 `;
      }
      return d;
    };
    // Entity-local (metre) point → CSS px, rotated by the entity angle about its origin.
    const localToClient = (lx: number, ly: number) =>
      this.worldToClient(wp.x + lx * ppu * cos - ly * ppu * sin, wp.y + lx * ppu * sin + ly * ppu * cos);

    let solid = '';
    let sensor = '';
    let sizeHandle: { x: number; y: number } | null = null;
    let radiusHandle: { x: number; y: number } | null = null;
    let oneWayCenter: { x: number; y: number } | null = null;
    const points: ColliderPointHandle[] = [];
    const pushPoint = (lx: number, ly: number, comp: string, key: string, index: number | null) => {
      const s = localToClient(lx, ly);
      if (s) points.push({ x: s.x, y: s.y, comp, key, index });
    };

    for (const inst of instances) {
      const shape = inst.shape;
      const center = shapeCenter(shape, wp, rot, ppu); // world px (offset applied)
      const outline = colliderShapeOutline(shape, center, rot, ppu);
      const d = outlinePath(outline);
      if (inst.isSensor) sensor += d; else solid += d;
      if (!oneWayCenter) oneWayCenter = this.worldToClient(center.x, center.y);

      switch (shape.kind) {
        case 'box': {
          // Size handle at the +hx,+hy corner (drag = halfExtents), rotated with the entity.
          const hx = shape.halfExtents.x * ppu;
          const hy = shape.halfExtents.y * ppu;
          const hs = this.worldToClient(center.x + hx * cos - hy * sin, center.y + hx * sin + hy * cos);
          if (hs) sizeHandle = hs;
          const os = this.worldToClient(center.x, center.y); // offset handle at the shape center
          if (os) points.push({ x: os.x, y: os.y, comp: 'BoxCollider', key: 'offset', index: null });
          break;
        }
        case 'circle': {
          // Radius handle at the shape's local top (drag = radius, in physics metres).
          const r = shape.radius * ppu;
          const rs = this.worldToClient(center.x - r * sin, center.y + r * cos);
          if (rs) radiusHandle = rs;
          const os = this.worldToClient(center.x, center.y);
          if (os) points.push({ x: os.x, y: os.y, comp: 'CircleCollider', key: 'offset', index: null });
          break;
        }
        case 'capsule': {
          // radius / halfHeight stay Inspector-edited (rare shape); the offset is draggable.
          const os = this.worldToClient(center.x, center.y);
          if (os) points.push({ x: os.x, y: os.y, comp: 'CapsuleCollider', key: 'offset', index: null });
          break;
        }
        case 'segment':
          pushPoint(shape.point1.x, shape.point1.y, 'SegmentCollider', 'point1', null);
          pushPoint(shape.point2.x, shape.point2.y, 'SegmentCollider', 'point2', null);
          break;
        case 'polygon':
          shape.vertices.forEach((v, i) => pushPoint(v.x, v.y, 'PolygonCollider', 'vertices', i));
          break;
        case 'chain':
          shape.points.forEach((v, i) => pushPoint(v.x, v.y, 'ChainCollider', 'points', i));
          break;
      }
    }

    // One-way solid-side arrow: the world-space normal (screen y flips), out of the first
    // collider's center — the side a body can land on; it passes through from behind.
    let oneWay: ColliderGizmo['oneWay'] = null;
    if (oneWayCenter && world.has(id, OneWayPlatform)) {
      const ow = world.get(id, OneWayPlatform) as { normal: { x: number; y: number }; enabled: boolean };
      const len = Math.hypot(ow.normal.x, ow.normal.y);
      if (ow.enabled !== false && len > 1e-4) {
        oneWay = { cx: oneWayCenter.x, cy: oneWayCenter.y, dx: ow.normal.x / len, dy: -ow.normal.y / len };
      }
    }
    return { outline: solid, outlineSensor: sensor, oneWay, sizeHandle, radiusHandle, points };
  },

  /**
   * World-space collision outlines for a selected TilemapLayer's placed tiles — the
   * SAME merged boxes + flip-aware rich shapes (slopes / circles / one-way / sensors)
   * the runtime spawns at Play, but as a picture (nothing is spawned). `model` is the
   * layer's resolved {@link TilesetModel} (re-resolved by the editor, not read from the
   * plugin's private map). Empty when the entity isn't a live infinite tilemap layer.
   * The per-frame projection is {@link projectTileCollision}; this is the cacheable half.
   */
  tilemapColliderOutlines(sourceId: EntityId, model: TilesetModel): TileCollisionPiece[] {
    const world = EngineHost.world;
    const rt = SceneModel.runtimeFor(sourceId);
    if (!world || rt == null || !world.valid(rt) || !world.has(rt, TilemapLayer) || !world.has(rt, Transform)) return [];
    const layer = world.get(rt, TilemapLayer) as { cellSize: { x: number; y: number } };
    const tw = layer.cellSize.x;
    const th = layer.cellSize.y;
    if (!(tw > 0) || !(th > 0)) return [];
    const t = world.get(rt, Transform);
    const chunks = decodeTilemapChunks(TilemapAPI.exportChunks(rt) || '');
    return tileCollisionOutlines(chunks, model, tw, th, t.worldPosition.x, t.worldPosition.y);
  },

  /**
   * Project world-space tile-collision {@link TileCollisionPiece}s to screen SVG path
   * data (CSS px), culling pieces whose centre falls outside the visible world rect so a
   * large map only pays for what's on-screen. Returns four `d` strings: solid outlines,
   * sensor outlines (styled dashed), and the one-way arrows split into shafts + heads.
   * Null when there's no camera view.
   */
  projectTileCollision(
    pieces: TileCollisionPiece[],
  ): { solid: string; sensor: string; onewayLine: string; onewayHead: string } | null {
    const canvas = EngineHost.canvas;
    if (!canvas || !cameraView()) return null;
    // Visible world AABB from the canvas corners (page coords → world), padded a couple
    // of tiles so a piece straddling the edge still draws. If the projection is degenerate
    // (no bounds), fall back to drawing everything.
    const rect = canvas.getBoundingClientRect();
    const corners = [
      this.canvasToWorld(rect.left, rect.top),
      this.canvasToWorld(rect.right, rect.top),
      this.canvasToWorld(rect.left, rect.bottom),
      this.canvasToWorld(rect.right, rect.bottom),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      if (!c) continue;
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    const cull = Number.isFinite(minX);
    const PAD = 128;
    minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;

    let solid = '';
    let sensor = '';
    let onewayLine = '';
    let onewayHead = '';
    for (const piece of pieces) {
      if (cull && (piece.center.x < minX || piece.center.x > maxX || piece.center.y < minY || piece.center.y > maxY)) continue;

      for (const line of piece.polylines) {
        let d = '';
        for (let i = 0; i < line.length; i++) {
          const s = this.worldToClient(line[i].x, line[i].y);
          if (!s) { d = ''; break; }
          d += `${i ? 'L' : 'M'}${s.x},${s.y}`;
        }
        if (d) { if (piece.sensor) sensor += `${d} `; else solid += `${d} `; }
      }
      for (const c of piece.circles) {
        const ctr = this.worldToClient(c.c.x, c.c.y);
        const edge = this.worldToClient(c.c.x + c.r, c.c.y);
        if (!ctr || !edge) continue;
        const r = Math.hypot(edge.x - ctr.x, edge.y - ctr.y);
        // A full circle as two half-arcs (SVG has no closed-circle path primitive).
        const arc = `M${ctr.x - r},${ctr.y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0 `;
        if (piece.sensor) sensor += arc; else solid += arc;
      }
      // One-way: a short arrow out of the centre along the solid-side normal (world y-up
      // → screen y-down). Screen-fixed length so it reads at any zoom, like the collider
      // gizmo's one-way arrow. The side a body can land on; it passes through from behind.
      if (piece.oneWay) {
        const c = this.worldToClient(piece.center.x, piece.center.y);
        if (c) {
          const dx = piece.oneWay.nx;
          const dy = -piece.oneWay.ny;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const L = 14;
          const bx = c.x + ux * L;
          const by = c.y + uy * L;
          onewayLine += `M${c.x},${c.y}L${bx},${by} `;
          const px = -uy;
          const py = ux;
          onewayHead += `M${bx + ux * 6},${by + uy * 6}L${bx + px * 3.2},${by + py * 3.2}L${bx - px * 3.2},${by - py * 3.2}Z `;
        }
      }
    }
    return { solid, sensor, onewayLine, onewayHead };
  },

  // ── Orientation-aware tile-grid overlay ─────────────────────────────────────
  // Non-orthogonal maps (iso / staggered / hex) can't be drawn by the engine's square
  // grid or the axis-aligned div ghost, so the editor draws their cells as shaped SVG
  // polygons. All three read the SAME cell geometry the runtime places tiles with
  // ({@link tileCellCenter}/{@link tileCellOutline}), so overlay and rendered tiles line up.

  /** The selected layer's grid layout + world origin, or null (not a tilemap / no runtime). */
  tileGridParams(id: EntityId): { params: TileGridParams; origin: { x: number; y: number } } | null {
    const comp = SceneModel.entityBySource(id)?.components.find((c) => c.type === 'TilemapLayer');
    const d = comp?.data as {
      cellSize?: { x: number; y: number }; orientation?: number; hexSideLength?: number;
      staggerAxis?: number; staggerIndex?: number;
    } | undefined;
    if (!d?.cellSize) return null;
    const rt = SceneModel.runtimeFor(id);
    const origin = rt != null ? this.getEntityWorldXY(rt) : null;
    if (!origin) return null;
    return {
      params: {
        orientation: d.orientation ?? 0,
        tileWidth: d.cellSize.x, tileHeight: d.cellSize.y,
        hexSideLength: d.hexSideLength ?? 0,
        staggerAxisX: (d.staggerAxis ?? 0) === 1,
        staggerIndexEven: (d.staggerIndex ?? 0) === 1,
      },
      origin,
    };
  },

  /** True when the selected layer uses a non-orthogonal grid (drives the SVG overlay). */
  tileLayerIsNonOrthogonal(id: EntityId): boolean {
    const gp = this.tileGridParams(id);
    return !!gp && isNonOrthogonal(gp.params.orientation);
  },

  /**
   * SVG path `d` for the outlines of the given tile cells (each a closed polygon in the
   * layer's orientation). `cullPad` (client px) drops cells whose center projects well
   * off-canvas so the grid path stays small when zoomed in.
   */
  projectTileCellPaths(
    params: TileGridParams, origin: { x: number; y: number },
    cells: Iterable<{ x: number; y: number }>, cullPad = Infinity,
  ): string {
    const outline = tileCellOutline(params);
    const canvas = EngineHost.canvas;
    // The cull box is in the SAME frame worldToClient reports — canvas-relative CSS px,
    // origin at the canvas top-left — so it's [0..w, 0..h], NOT the page-relative
    // getBoundingClientRect() (whose left/top carry the canvas's page offset; comparing
    // against those over-culls the whole left/top band once the viewport is inset).
    const rect = cullPad === Infinity || !canvas ? null : canvas.getBoundingClientRect();
    let d = '';
    for (const cell of cells) {
      const c = tileCellCenter(params, cell.x, cell.y);
      const cx = origin.x + c.x;
      const cy = origin.y + c.y;
      if (rect) {
        const sc = this.worldToClient(cx, cy);
        if (!sc || sc.x < -cullPad || sc.x > rect.width + cullPad
          || sc.y < -cullPad || sc.y > rect.height + cullPad) continue;
      }
      let sub = '';
      for (let i = 0; i < outline.length; i++) {
        const s = this.worldToClient(cx + outline[i].x, cy + outline[i].y);
        if (!s) { sub = ''; break; }
        sub += `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      }
      if (sub) d += `${sub}Z`;
    }
    return d;
  },

  /**
   * The visible tile-index bbox for the grid overlay (the on-screen corners mapped back
   * to tile coords, padded for iso/hex diamonds that reach past the corner samples), or
   * null when it would exceed `cap` cells (too zoomed out to draw a useful grid).
   */
  visibleTileRange(
    id: EntityId, origin: { x: number; y: number }, cap: number,
  ): { x0: number; y0: number; x1: number; y1: number } | null {
    const rt = SceneModel.runtimeFor(id);
    const canvas = EngineHost.canvas;
    if (rt == null || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const corners = [
      this.canvasToWorld(rect.left, rect.top),
      this.canvasToWorld(rect.right, rect.top),
      this.canvasToWorld(rect.left, rect.bottom),
      this.canvasToWorld(rect.right, rect.bottom),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of corners) {
      if (!c) continue;
      const t = TilemapAPI.worldToTile(rt, c.x, c.y, origin.x, origin.y);
      x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x);
      y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y);
    }
    if (!Number.isFinite(x0)) return null;
    const PAD = 3; // partial cells + iso/hex extremes past the corner samples
    x0 = Math.floor(x0) - PAD; y0 = Math.floor(y0) - PAD;
    x1 = Math.ceil(x1) + PAD; y1 = Math.ceil(y1) + PAD;
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > cap) return null;
    return { x0, y0, x1, y1 };
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
