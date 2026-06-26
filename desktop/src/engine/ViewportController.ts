// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { Camera, CameraView, EditorView, Light2D, Sprite, Transform } from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';
import { SceneModel } from './SceneModel';

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

  /** Topmost sprite under a pointer (AABB test in world space), or null. */
  pickEntity(clientX: number, clientY: number): EntityId | null {
    const world = EngineHost.world;
    const wp = this.canvasToWorld(clientX, clientY);
    if (!world || !wp) return null;

    let best: EntityId | null = null;
    let bestLayer = -Infinity;
    for (const e of world.getAllEntities()) {
      if (!world.has(e, Sprite) || !world.has(e, Transform)) continue;
      // Locked / editor-hidden entities aren't click-selectable in the viewport.
      const src = SceneModel.sourceFor(e);
      if (src != null && (SceneModel.isLocked(src) || SceneModel.isHidden(src))) continue;
      const t = world.get(e, Transform);
      const sp = world.get(e, Sprite);
      const w = sp.size.x * t.scale.x;
      const h = sp.size.y * t.scale.y;
      const px = sp.pivot?.x ?? 0.5;
      const py = sp.pivot?.y ?? 0.5;
      const left = t.position.x - w * px;
      const right = t.position.x + w * (1 - px);
      const bottom = t.position.y - h * py;
      const top = t.position.y + h * (1 - py);
      if (wp.x >= left && wp.x <= right && wp.y >= bottom && wp.y <= top) {
        if (sp.layer >= bestLayer) {
          bestLayer = sp.layer;
          best = e;
        }
      }
    }
    return best;
  },

  getEntityXY(id: EntityId): { x: number; y: number } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    return { x: t.position.x, y: t.position.y };
  },

  /** Screen-space bounding rect (CSS px rel. canvas) of an entity, for the selection outline. */
  getEntityScreenRect(id: EntityId): { x: number; y: number; w: number; h: number } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);

    let w = 40;
    let h = 40;
    let px = 0.5;
    let py = 0.5;
    if (world.has(id, Sprite)) {
      const sp = world.get(id, Sprite);
      w = sp.size.x * t.scale.x;
      h = sp.size.y * t.scale.y;
      px = sp.pivot?.x ?? 0.5;
      py = sp.pivot?.y ?? 0.5;
    }

    const cx = t.position.x;
    const cy = t.position.y;
    const worldCorners: Array<[number, number]> = [
      [cx - w * px, cy - h * py],
      [cx + w * (1 - px), cy - h * py],
      [cx + w * (1 - px), cy + h * (1 - py)],
      [cx - w * px, cy + h * (1 - py)],
    ];

    const screen = worldCorners.map(([wx, wy]) => this.worldToClient(wx, wy));
    if (screen.some((p) => !p)) return null;
    const xs = screen.map((p) => p!.x);
    const ys = screen.map((p) => p!.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

  /** Center the editor view on an entity (frame-selected). */
  frameEntity(id: EntityId): void {
    const view = editorView();
    const pos = this.getEntityXY(id);
    if (!view || !pos) return;
    view.x = pos.x;
    view.y = pos.y;
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
    const x = t.position.x;
    const y = t.position.y;
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
   */
  getLightGizmo(
    id: EntityId,
  ): { cx: number; cy: number; kind: number; color: string; radiusPx: number; sdx: number; sdy: number; coneHalf: number } | null {
    const world = EngineHost.world;
    if (!world || !world.valid(id) || !world.has(id, Light2D) || !world.has(id, Transform)) return null;
    const t = world.get(id, Transform);
    const l = world.get(id, Light2D) as {
      type: number; color: { r: number; g: number; b: number }; radius: number;
      direction: { x: number; y: number }; outerAngle: number;
    };
    const center = this.worldToClient(t.position.x, t.position.y);
    if (!center) return null;

    // Point (0) / Spot (3) have a falloff radius; project a world-radius offset to CSS px.
    let radiusPx = 0;
    if (l.type === 0 || l.type === 3) {
      const edge = this.worldToClient(t.position.x + l.radius, t.position.y);
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
    return { cx: center.x, cy: center.y, kind: l.type, color, radiusPx, sdx, sdy, coneHalf };
  },
};
