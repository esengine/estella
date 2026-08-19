// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    EditorView.ts
 * @brief   Editor viewport camera — a dedicated, editor-only eye on the scene.
 *
 * This is NOT a scene entity: it is never serialized, never on the undo stack,
 * and never part of the saved scene. When `active`, the camera system renders
 * the framebuffer through this view and drives all screen<->world queries from
 * it (CameraView / UICameraInfo) INSTEAD of the scene's game Camera entities —
 * so editor navigation (pan / zoom / frame / orbit) moves only this view and never
 * the scene's camera. In play mode it is deactivated, so the viewport shows the
 * real game camera (the true "Game" view). The editor mutates the focus, the zoom
 * and the angles the eye stands at; the head-on 2D view is all of them at zero.
 *
 * The view's view-projection is built from the SAME math primitives as scene
 * cameras (see CameraPlugin) — there is one source of view-projection math; only
 * the camera *configuration* (full-frame, raw orthoSize) differs.
 */
import { defineResource } from '../ecs/resource';
import { invertViewOrbit } from '../math/mat4';
import type { Vec3 } from '../types';

export interface EditorViewData {
  /** When true, the framebuffer + screen<->world use this view, not scene cameras. */
  active: boolean;
  /** World-space point the view looks at and turns around. */
  x: number;
  y: number;
  /** Depth of that point. Zero is the 2D plane, where a project that never
   *  leaves it stays. */
  z: number;
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
  active: false, x: 0, y: 0, z: 0, orthoSize: 360, uiPreviewAspect: 0,
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
 * World units per screen pixel at @p at — what a thing drawn at a fixed number of
 * pixels measures in the world where it stands. Orthographically the same
 * everywhere; in perspective it grows with the distance along the view axis, which
 * is the axis the projection divides by. Without @p at, the focus answers.
 */
export function editorViewWorldPerPixel(
  view: EditorViewData, heightPx: number, at?: Vec3,
): number {
  const base = heightPx > 0 ? (2 * editorViewHalfHeight(view)) / heightPx : 0;
  const standoff = editorViewStandoff(view);
  if (!view.perspective || !at || standoff <= 0) return base;
  const eye = editorViewEye(view);
  const f = editorViewBasis(view).forward;
  const along = (at.x - eye.x) * f.x + (at.y - eye.y) * f.y + (at.z - eye.z) * f.z;
  // Behind the eye there is no size to report; the focus's own scale is the
  // nearest honest answer and keeps a marker there clickable rather than infinite.
  return along > 0 ? base * (along / standoff) : base;
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

/** A world axis as it points on screen: a unit direction (y down, as screens are)
 *  plus how far it leans toward the eye — `1` straight at it, `-1` straight away. */
export interface ScreenAxis {
  dx: number;
  dy: number;
  depth: number;
}

/**
 * Where the world axes point on screen for this view. Read off the very basis the
 * camera is built from, so an indicator drawn from it cannot disagree with what is
 * rendered — a second copy of the rotation is exactly how those two drift apart.
 */
export function editorViewAxes(view: EditorViewData): { x: ScreenAxis; y: ScreenAxis; z: ScreenAxis } {
  const m = orbitMatrix(view);
  // Column c of the view matrix is a world axis expressed in view space.
  const axis = (c: number): ScreenAxis => ({ dx: m[c], dy: -m[c + 1], depth: m[c + 2] });
  return { x: axis(0), y: axis(4), z: axis(8) };
}

// The one place yaw/pitch become a basis; everything below reads its rows.
function orbitMatrix(view: EditorViewData): Float32Array {
  const rad = Math.PI / 180;
  return invertViewOrbit(0, 0, 0, (view.yaw ?? 0) * rad, (view.pitch ?? 0) * rad, 0);
}

/** The view's own axes as world directions — unit, and right-handed with forward. */
export interface EditorViewBasis {
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/**
 * Where the view's right / up / forward point in the world.
 *
 * A drag is a screen direction, and this is what it means in world terms. Read
 * off the very matrix the camera is built from, so navigation cannot move along
 * axes the picture was not drawn with.
 */
export function editorViewBasis(view: EditorViewData): EditorViewBasis {
  const m = orbitMatrix(view);
  return {
    right: { x: m[0], y: m[4], z: m[8] },
    up: { x: m[1], y: m[5], z: m[9] },
    forward: { x: -m[2], y: -m[6], z: -m[10] },
  };
}

/**
 * How far the eye stands off the focus. A perspective eye has to stand
 * somewhere, and so does an orbited orthographic one; head-on 2D does not.
 */
export function editorViewStandoff(view: EditorViewData): number {
  return view.perspective || editorViewIsOrbited(view) ? view.distance : 0;
}

/**
 * How far the view's volume reaches, from the EYE — which stands off what it is
 * looking at, and spends that stand-off before the scene begins. So the reach past
 * the focus is constant and the stand-off is added to it; a head-on orthographic
 * eye, which has none, is left with exactly the reach it always had.
 */
export function editorViewClipFar(view: EditorViewData): number {
  return editorViewStandoff(view) + EDITOR_VIEW_REACH;
}

/** How far past what the view is looking at its volume extends. */
const EDITOR_VIEW_REACH = 100000;

/** Where the eye stands in world space. */
export function editorViewEye(view: EditorViewData): Vec3 {
  const m = orbitMatrix(view);
  const d = editorViewStandoff(view);
  return {
    x: view.x + m[2] * d,
    y: view.y + m[6] * d,
    z: (view.z ?? 0) + m[10] * d,
  };
}

/**
 * Move the focus by an offset in the view's OWN axes, in world units.
 *
 * Every navigation that is not a turn is this: a drag, a zoom about the cursor,
 * a dolly. Expressing them here is what keeps them from each picking a world
 * plane of their own, which is only the same answer while the eye is head-on.
 */
export function moveEditorViewFocus(
  view: EditorViewData, right: number, up: number, forward = 0,
): void {
  const b = editorViewBasis(view);
  view.x += b.right.x * right + b.up.x * up + b.forward.x * forward;
  view.y += b.right.y * right + b.up.y * up + b.forward.y * forward;
  view.z = (view.z ?? 0) + b.right.z * right + b.up.z * up + b.forward.z * forward;
}

/**
 * How much of the screen's two axes an axis-aligned box of half-size @p half
 * covers, in world units — what "fit this in the frame" has to measure.
 */
export function editorViewBoxExtent(
  view: EditorViewData, half: Vec3,
): { right: number; up: number } {
  const b = editorViewBasis(view);
  const along = (a: Vec3): number =>
    Math.abs(a.x) * half.x + Math.abs(a.y) * half.y + Math.abs(a.z) * half.z;
  return { right: along(b.right), up: along(b.up) };
}

/** A world axis, as an index into (x, y, z). */
export type WorldAxis = 0 | 1 | 2;

/** The world plane a view works on, through the origin: the two axes that run in
 *  it, and the one it is normal to. */
export interface EditorWorkPlane {
  u: WorldAxis;
  v: WorldAxis;
  normal: WorldAxis;
}

/**
 * Which plane that is.
 *
 * The perspective toggle is the editor's word for "this view is looking at a 3D
 * scene", and a 3D scene stands on the ground (y = 0); orthographic is the 2D
 * editor, whose plane is the one 2D content lives on. A plane the eye looks ALONG
 * offers nothing to work on, so there the plane the eye most faces answers instead
 * — which is how a perspective view held head-on is the 2D one again.
 */
export function editorViewWorkPlane(view: EditorViewData): EditorWorkPlane {
  const nominal: EditorWorkPlane = view.perspective
    ? { u: 0, v: 2, normal: 1 }
    : { u: 0, v: 1, normal: 2 };
  const screen = editorViewAxes(view);
  const depth = (a: WorldAxis): number =>
    Math.abs((a === 0 ? screen.x : a === 1 ? screen.y : screen.z).depth);
  if (depth(nominal.normal) >= PLANE_SEEN_MIN) return nominal;
  const normal = ([0, 1, 2] as WorldAxis[]).reduce((best, a) => (depth(a) > depth(best) ? a : best), 0);
  const [u, v] = ([0, 1, 2] as WorldAxis[]).filter((a) => a !== normal);
  return { u: u!, v: v!, normal };
}

/** How square-on a plane must be to be the one worked on — about 6° off edge-on. */
const PLANE_SEEN_MIN = 0.1;

/**
 * The work-plane axis a screen direction names, with the sign pointing that way —
 * what "right" and "up" mean for a gesture on that plane. `right` resolves first
 * and `up` takes the plane's other axis, so the pair is never one axis twice.
 * Head-on: +X right, +Y up.
 */
export function screenWorkAxes(
  view: EditorViewData,
): { right: { axis: WorldAxis; sign: number }; up: { axis: WorldAxis; sign: number } } {
  const plane = editorViewWorkPlane(view);
  const screen = editorViewAxes(view);
  const of = (a: WorldAxis): ScreenAxis => (a === 0 ? screen.x : a === 1 ? screen.y : screen.z);
  const candidates: WorldAxis[] = [plane.u, plane.v];
  // Screen y runs down, so pointing up the screen is a negative dy.
  const score = (a: WorldAxis, sign: number, dir: 'right' | 'up'): number =>
    sign * (dir === 'right' ? of(a).dx : -of(a).dy);
  const best = (axes: WorldAxis[], dir: 'right' | 'up'): { axis: WorldAxis; sign: number } => {
    let out = { axis: axes[0]!, sign: 1 };
    let top = -Infinity;
    for (const a of axes) {
      for (const sign of [1, -1]) {
        const v = score(a, sign, dir);
        if (v > top) { top = v; out = { axis: a, sign }; }
      }
    }
    return out;
  };
  const right = best(candidates, 'right');
  const up = best(candidates.filter((a) => a !== right.axis), 'up');
  return { right, up };
}

/** A world axis as a unit vector. */
export function worldAxisVector(axis: WorldAxis): Vec3 {
  return { x: axis === 0 ? 1 : 0, y: axis === 1 ? 1 : 0, z: axis === 2 ? 1 : 0 };
}

/**
 * Yaw/pitch that put the eye on a world axis, looking back down it — the standard
 * views (front, side, top) every DCC offers. `sign` picks which end of the axis the
 * eye stands on.
 */
export function editorViewAxisAngles(axis: 'x' | 'y' | 'z', sign: 1 | -1): { yaw: number; pitch: number } {
  if (axis === 'y') return { yaw: 0, pitch: 90 * sign };
  if (axis === 'x') return { yaw: 90 * sign, pitch: 0 };
  return { yaw: sign > 0 ? 0 : 180, pitch: 0 };
}
