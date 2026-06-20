import { Camera, CameraView, Sprite, Transform } from 'esengine';
import type { EntityId } from '@/types';
import { EngineHost } from './EngineHost';

// Structural shape of the engine's CameraView resource (screen<->world).
interface CameraViewLike {
  screenToWorld(x: number, y: number): { x: number; y: number } | null;
  worldToScreen(x: number, y: number): { x: number; y: number } | null;
}

function cameraView(): CameraViewLike | null {
  const cv = EngineHost.getResource(CameraView) as unknown as CameraViewLike | undefined;
  return cv ?? null;
}

// The active scene camera entity (or the first camera). Editor navigation writes
// it directly on the live World — NOT through SceneCommands/SceneModel — so it
// moves the rendered view without going on the undo stack or dirtying the saved
// scene (an editor camera, reset to the scene's camera on reload).
function activeCameraId(): EntityId | null {
  const world = EngineHost.world;
  if (!world) return null;
  let first: EntityId | null = null;
  for (const e of world.getAllEntities()) {
    if (!world.has(e, Camera) || !world.has(e, Transform)) continue;
    if (first == null) first = e;
    if ((world.get(e, Camera) as { isActive?: boolean }).isActive) return e;
  }
  return first;
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

  /** Pan the editor view by a CSS-pixel drag (prev→cur); moves the live camera. */
  panByClient(prevX: number, prevY: number, curX: number, curY: number): void {
    const world = EngineHost.mutableWorld();
    const cam = activeCameraId();
    if (!world || cam == null) return;
    const a = this.canvasToWorld(prevX, prevY);
    const b = this.canvasToWorld(curX, curY);
    if (!a || !b) return;
    const t = world.get(cam, Transform) as unknown as { position: { x: number; y: number; z: number } };
    const next = { ...t, position: { ...t.position, x: t.position.x + (a.x - b.x), y: t.position.y + (a.y - b.y) } };
    world.set(cam, Transform, next as never);
  },

  /** Zoom the editor view: factor > 1 zooms out, < 1 zooms in (camera orthoSize). */
  zoomBy(factor: number): void {
    const world = EngineHost.mutableWorld();
    const cam = activeCameraId();
    if (!world || cam == null) return;
    const c = world.get(cam, Camera) as unknown as { orthoSize: number };
    const next = { ...c, orthoSize: Math.max(8, Math.min(40000, c.orthoSize * factor)) };
    world.set(cam, Camera, next as never);
  },

  /** Center the editor view on an entity (frame-selected). */
  frameEntity(id: EntityId): void {
    const world = EngineHost.mutableWorld();
    const cam = activeCameraId();
    const pos = this.getEntityXY(id);
    if (!world || cam == null || !pos) return;
    const t = world.get(cam, Transform) as unknown as { position: { x: number; y: number; z: number } };
    world.set(cam, Transform, { ...t, position: { ...t.position, x: pos.x, y: pos.y } } as never);
  },
};
