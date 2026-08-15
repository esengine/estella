// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorView.ts
 * @brief   Editor viewport camera — a dedicated, editor-only 2D view.
 *
 * This is NOT a scene entity: it is never serialized, never on the undo stack,
 * and never part of the saved scene. When `active`, the camera system renders
 * the framebuffer through this view and drives all screen<->world queries from
 * it (CameraView / UICameraInfo) INSTEAD of the scene's game Camera entities —
 * so editor navigation (pan / zoom / frame) moves only this view and never the
 * scene's camera. In play mode it is deactivated, so the viewport shows the real
 * game camera (the true "Game" view). The editor mutates x / y / orthoSize.
 *
 * The view's view-projection is built from the SAME math primitives as scene
 * cameras (see CameraPlugin) — there is one source of view-projection math; only
 * the camera *configuration* (full-frame, raw orthoSize) differs.
 */
import { defineResource } from '../ecs/resource';

export interface EditorViewData {
  /** When true, the framebuffer + screen<->world use this view, not scene cameras. */
  active: boolean;
  /** World-space camera center. */
  x: number;
  y: number;
  /** Half-height of the view in world units (zoom; smaller = more zoomed in). */
  orthoSize: number;
  /**
   * `false` (default) is the 2D view: an orthographic projection where zoom is
   * `orthoSize` and depth cannot be seen. `true` previews the scene the way a
   * perspective game camera would — the only way to look at 2.5D content while
   * authoring it.
   *
   * The view keeps its OWN projection rather than following the scene's camera,
   * which is the same choice UE and Unity make: an orthographic view of a
   * perspective scene is a working mode (a top-down or side elevation), not a
   * mismatch to be corrected. What the game will look like is the Game view's
   * job; this is the editor's own eye.
   */
  perspective: boolean;
  /** Vertical field of view in degrees, used only when `perspective`. */
  fov: number;
  /**
   * Camera distance along +z, used only when `perspective`. This is what zoom
   * moves in that mode — a perspective view cannot zoom by widening a box, and
   * changing the fov instead would alter the projection the user is previewing.
   */
  distance: number;
  /**
   * Where the eye stands relative to the focus (x, y): yaw about world +Y, pitch
   * above the xz plane, in DEGREES like `fov`. Both zero is the head-on 2D view,
   * and every 2D projection stays exactly what it was there — orbiting is what a
   * 3D scene needs to be looked at, not a different camera.
   */
  yaw: number;
  pitch: number;
  /**
   * Aspect ratio the editor lays UI out against, so the editor previews how UI adapts
   * on a simulated device: `> 0` fits the design resolution into this aspect (the device
   * simulator), `0` uses the authored design aspect — WYSIWYG at the design resolution.
   * Editor-only; scene cameras (shipped games) ignore it. See uiLayoutRect.
   */
  uiPreviewAspect: number;
}

export const DEFAULT_EDITOR_VIEW: EditorViewData = {
  active: false, x: 0, y: 0, orthoSize: 360, uiPreviewAspect: 0,
  // Off by default: an existing project opens on exactly the view it always had.
  perspective: false, fov: 60, distance: 1000, yaw: 0, pitch: 0,
};

/**
 * Half-height, in world units, of what the view sees on the z = 0 plane — where
 * 2D content lives and where the grid, the framing and the minimap all measure.
 *
 * Orthographically this IS `orthoSize`. In perspective the visible extent is the
 * frustum's cross-section at the focus plane, `tan(fov/2) · distance` — merely
 * proportional to the zoom value, not equal to it. Everything that needs "how
 * much world is on screen" asks here rather than reading `orthoSize`, which
 * answers for one of the two projections and silently mis-scales the other.
 */
export function editorViewHalfHeight(view: EditorViewData): number {
  return view.perspective
    ? Math.tan((view.fov * Math.PI) / 180 / 2) * view.distance
    : view.orthoSize;
}

/** {@link editorViewHalfHeight} with the panel aspect applied — the visible world rect. */
export function editorViewHalfExtent(
  view: EditorViewData, aspect: number,
): { halfW: number; halfH: number } {
  const halfH = editorViewHalfHeight(view);
  return { halfW: halfH * (aspect > 0 ? aspect : 1), halfH };
}

/**
 * Zoom the view until it sees @p halfH world units of height, writing whichever
 * field this projection zooms with. The inverse of {@link editorViewHalfHeight},
 * so "frame this" and "how big is what I see" cannot disagree.
 */
export function setEditorViewHalfHeight(view: EditorViewData, halfH: number): void {
  if (view.perspective) {
    const t = Math.tan((view.fov * Math.PI) / 180 / 2);
    view.distance = t > 0 ? halfH / t : halfH;
  } else {
    view.orthoSize = halfH;
  }
}

export const EditorView = defineResource<EditorViewData>({ ...DEFAULT_EDITOR_VIEW }, 'EditorView');

/**
 * True when the view is turned away from the head-on 2D one. Absent angles read
 * as zero: a workspace saved before this existed, or a partial view an embedder
 * hands in, is the 2D view — not an orbit by NaN.
 */
export function editorViewIsOrbited(view: EditorViewData): boolean {
  return (view.yaw ?? 0) !== 0 || (view.pitch ?? 0) !== 0;
}
