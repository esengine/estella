// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gizmo.ts
 * @brief Pure geometry for the interactive transform gizmo — handle hit-testing,
 *        axis constraint, group pivot. No engine / DOM coupling, so it unit-tests
 *        in isolation; transformTools.ts is the imperative shell that drives it.
 *
 * Coordinate model: the gizmo lives at a screen-space (CSS px) pivot, and every
 * handle is built from ONE input — where the world axes point on screen for the
 * current view ({@link ViewAxes}, read off the camera's own basis). A second copy
 * of that basis is exactly how a gizmo comes to disagree with what is rendered,
 * so no direction here is written down: {@link screenDir} projects a world
 * direction, and the arrows and the rings are both made of it.
 */

import { axisQuat, quatMul, type Quat } from '@/engine/viewportMath';

export { axisQuat, quatMul, type Quat };

export type GizmoMode = 'move' | 'rotate' | 'scale';
/** What a handle constrains motion to: one world axis, or the plane of two. */
export type GizmoAxis = 'x' | 'y' | 'z' | 'xy' | 'yz' | 'zx';

/** A direction in world space. */
export interface Vec3 { x: number; y: number; z: number }

/** Where each world axis points on screen — see `editorViewAxes`. */
export interface ViewAxes {
  x: { dx: number; dy: number };
  y: { dx: number; dy: number };
  z: { dx: number; dy: number };
}

/** The head-on 2D view: +X right, +Y up, Z straight at the eye. */
export const HEAD_ON: ViewAxes = { x: { dx: 1, dy: 0 }, y: { dx: 0, dy: -1 }, z: { dx: 0, dy: 0 } };

/**
 * Where a world direction points on screen, in the view's own basis.
 *
 * The projection of a direction is linear in that basis, so every handle — an
 * arrow, a ring's two spanning vectors, a local axis turned by the entity's own
 * rotation — is this one function applied to a unit vector.
 */
export function screenDir(axes: ViewAxes, v: Vec3): Pt {
  return {
    x: v.x * axes.x.dx + v.y * axes.y.dx + v.z * axes.z.dx,
    y: v.x * axes.x.dy + v.y * axes.y.dy + v.z * axes.z.dy,
  };
}

/** The world axis a single-axis handle constrains to. */
export const AXIS_VECTOR: Record<'x' | 'y' | 'z', Vec3> = {
  x: { x: 1, y: 0, z: 0 },
  y: { x: 0, y: 1, z: 0 },
  z: { x: 0, y: 0, z: 1 },
};

/** The two world axes a plane handle spans, in right-handed order. */
export const PLANE_AXES: Record<'xy' | 'yz' | 'zx', ['x' | 'y' | 'z', 'x' | 'y' | 'z']> = {
  xy: ['x', 'y'],
  yz: ['y', 'z'],
  zx: ['z', 'x'],
};

/** Whether a handle names a plane rather than a single axis. */
export function isPlaneAxis(axis: GizmoAxis): axis is 'xy' | 'yz' | 'zx' {
  return axis.length === 2;
}

export interface GizmoHandle {
  id: string;
  mode: GizmoMode;
  axis: GizmoAxis;
}

export interface Pt {
  x: number;
  y: number;
}

/** Screen-space layout of the gizmo (CSS px). Rendering (Viewport.tsx) mirrors these. */
export const GIZMO = {
  axisLen: 58, // axis arrow length from the pivot
  planeSize: 20, // side of the center move-plane square (a square ±planeSize/2 around pivot)
  ringRadius: 42, // rotate ring radius
  boxSize: 11, // scale end-box side
  hitTol: 7, // px tolerance for line / ring proximity
} as const;

/**
 * How short an axis may project and still be worth drawing or aiming at. Below it
 * the arrow points at the eye — a dot, where a drag names no distance. It is also
 * what leaves a head-on gizmo the two arrows it always had, world Z projecting to
 * nothing there, the way {@link RING_MIN_DET} leaves it the single Z ring.
 */
const AXIS_MIN_PROJ = 0.12;

/** One axis arrow, as it projects: the axis it constrains to, and where it points. */
export interface AxisHandle {
  axis: 'x' | 'y' | 'z';
  dir: Pt;
}

/**
 * The move/scale gizmo's arrows, from the same basis the rotate rings are built
 * from. `rotation`, when given, turns the axes into the entity's own frame — local
 * space is a rotation of the world axes, not an angle applied to the screen.
 */
export function axisHandles(axes: ViewAxes, rotation?: Quat): AxisHandle[] {
  return (['x', 'y', 'z'] as const)
    .map((axis) => ({
      axis,
      dir: screenDir(axes, rotation ? rotateVec(AXIS_VECTOR[axis], rotation) : AXIS_VECTOR[axis]),
    }))
    .filter((h) => Math.hypot(h.dir.x, h.dir.y) >= AXIS_MIN_PROJ);
}

/** A world direction turned by a quaternion — how a local axis reaches world space. */
export function rotateVec(v: Vec3, q: Quat): Vec3 {
  const t = { x: 2 * (q.y * v.z - q.z * v.y), y: 2 * (q.z * v.x - q.x * v.z), z: 2 * (q.x * v.y - q.y * v.x) };
  return {
    x: v.x + q.w * t.x + q.y * t.z - q.z * t.y,
    y: v.y + q.w * t.y + q.z * t.x - q.x * t.z,
    z: v.z + q.w * t.z + q.x * t.y - q.y * t.x,
  };
}

/** Distance from point `p` to the segment a→b (used for axis-arrow hit zones). */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

const within = (p: Pt, c: Pt, half: number): boolean => Math.abs(p.x - c.x) <= half && Math.abs(p.y - c.y) <= half;
const along = (pivot: Pt, dir: Pt, d: number): Pt => ({ x: pivot.x + dir.x * d, y: pivot.y + dir.y * d });

/**
 * The handle under `cursor` for the active gizmo at `pivot` (all CSS px), or null.
 * The centre handle is tested before the axes so the smaller, foreground target
 * wins. `rotation` puts the arrows in the entity's own frame (local space).
 */
export function hitTestGizmo(
  mode: 'move' | 'scale', axes: ViewAxes, pivot: Pt, cursor: Pt, rotation?: Quat,
): GizmoHandle | null {
  if (within(cursor, pivot, GIZMO.planeSize / 2)) {
    const axis = faceOnPlane(axes);
    return { id: `${mode}.${axis}`, mode, axis };
  }
  for (const h of axisHandles(axes, rotation)) {
    const end = along(pivot, h.dir, GIZMO.axisLen);
    const onEnd = mode === 'scale' && within(cursor, end, GIZMO.boxSize);
    if (onEnd || distToSegment(cursor, pivot, end) <= GIZMO.hitTol) {
      return { id: `${mode}.${h.axis}`, mode, axis: h.axis };
    }
  }
  return null;
}

/**
 * The world plane most facing the eye — what the centre square means. Head-on that
 * is XY, which is the free-move handle a 2D gizmo has always had; turned, it is
 * whichever plane the cursor can actually slide along without racing off to the
 * horizon.
 */
export function faceOnPlane(axes: ViewAxes): 'xy' | 'yz' | 'zx' {
  let best: 'xy' | 'yz' | 'zx' = 'xy';
  let bestArea = -1;
  for (const plane of ['xy', 'yz', 'zx'] as const) {
    const [a, b] = PLANE_AXES[plane];
    const u = axes[a];
    const v = axes[b];
    const area = Math.abs(u.dx * v.dy - u.dy * v.dx);
    if (area > bestArea) { bestArea = area; best = plane; }
  }
  return best;
}

/**
 * The world plane a handle's drag is measured on. A plane handle IS one; an axis
 * handle takes whichever of the two planes containing it the eye sees most of,
 * because a plane seen edge-on turns a pixel of cursor travel into an unbounded
 * world distance.
 */
export function dragPlane(axis: GizmoAxis, axes: ViewAxes): 'xy' | 'yz' | 'zx' {
  if (isPlaneAxis(axis)) return axis;
  const candidates = (['xy', 'yz', 'zx'] as const).filter((p) => PLANE_AXES[p].includes(axis));
  let best = candidates[0]!;
  let bestArea = -1;
  for (const p of candidates) {
    const [a, b] = PLANE_AXES[p];
    const area = Math.abs(axes[a].dx * axes[b].dy - axes[a].dy * axes[b].dx);
    if (area > bestArea) { bestArea = area; best = p; }
  }
  return best;
}

/** The world normal of a plane the gizmo names — the axis it does not span. */
export function planeNormal(plane: 'xy' | 'yz' | 'zx'): Vec3 {
  const spans = PLANE_AXES[plane];
  const axis = (['x', 'y', 'z'] as const).find((a) => !spans.includes(a))!;
  return AXIS_VECTOR[axis];
}

/**
 * Constrain a world-space delta to what a handle allows: a plane handle keeps the
 * delta (it was measured ON that plane), an axis handle projects onto that axis.
 * `rotation` puts the axis in the entity's own frame — a local-space drag.
 */
export function constrainDelta(axis: GizmoAxis, delta: Vec3, rotation?: Quat): Vec3 {
  if (isPlaneAxis(axis)) return delta;
  const a = rotation ? rotateVec(AXIS_VECTOR[axis], rotation) : AXIS_VECTOR[axis];
  const k = delta.x * a.x + delta.y * a.y + delta.z * a.z;
  return { x: a.x * k, y: a.y * k, z: a.z * k };
}

/** What a pivot drag is measured against, snapshotted when the handle is grabbed.
 *  `w`/`h` are the sprite's world size with scale already folded in, so the fraction
 *  divides by the rect that is actually drawn. */
export interface PivotFrame {
  origin: Pt;
  rot: number;
  w: number;
  h: number;
  pivot: Pt;
}

/**
 * Where a pivot drag lands: the fraction to store, and the world position that keeps
 * the artwork still. A sprite is drawn at `position − R·(size·pivot)`, so moving the
 * pivot alone slides the body off the cursor — instead the transform follows the
 * cursor and the pivot absorbs the same offset, leaving that expression unchanged.
 */
export function pivotDrag(f: PivotFrame, cursor: Pt): { pivot: Pt; pos: Pt } {
  const cos = Math.cos(f.rot);
  const sin = Math.sin(f.rot);
  const dx = cursor.x - f.origin.x;
  const dy = cursor.y - f.origin.y;
  return {
    pivot: {
      x: f.pivot.x + (dx * cos + dy * sin) / f.w,
      y: f.pivot.y + (-dx * sin + dy * cos) / f.h,
    },
    pos: { x: cursor.x, y: cursor.y },
  };
}

/** Centroid of a set of world points — the group transform pivot for multi-select. */
export function groupPivot(points: readonly Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** Rotate a point `p` around pivot `c` by `angle` radians (group rotate). */
export function rotateAround(p: Pt, c: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Scale a point `p` away from pivot `c` by per-axis factors (group scale). */
export function scaleAround(p: Pt, c: Pt, fx: number, fy: number): Pt {
  return { x: c.x + (p.x - c.x) * fx, y: c.y + (p.y - c.y) * fy };
}

/**
 * Which collider-overlay handles may take the pointer.
 *
 * The overlay is drawn for EVERY collider in the scene, and the offset handle
 * sits where Move and Scale keep their centre grab. So handles answer only for
 * the selected entity, and the offset yields to any transform gizmo.
 */
export function colliderHandleClass(selected: boolean, mode: GizmoMode | 'select'): string {
  return (selected ? ' is-live' : '') + (mode === 'select' ? '' : ' gizmo-owns-centre');
}

/** One rotation ring, as it projects: the two screen vectors its plane spans (each
 *  a unit world axis, so each already carries its own foreshortening). */
export interface RotateRing {
  axis: 'x' | 'y' | 'z';
  u: Pt;
  v: Pt;
}

/**
 * How flat a ring may be projected and still be worth drawing or aiming at. Below
 * it the circle is edge-on — a line, where a cursor names no angle. It is also
 * what leaves the head-on 2D gizmo with the single Z ring it always had.
 */
const RING_MIN_DET = 0.12;

/**
 * The rotate gizmo's three rings, from where the world axes point on screen.
 *
 * Each ring spans the plane its axis is normal to, in that axis's own right-handed
 * order (Y×Z = X, Z×X = Y, X×Y = Z) — so a drag from `u` toward `v` is a POSITIVE
 * turn about the axis, and the sign needs no separate table.
 */
export function rotateRings(axes: ViewAxes, rotation?: Quat): RotateRing[] {
  const dir = (a: 'x' | 'y' | 'z'): Pt =>
    screenDir(axes, rotation ? rotateVec(AXIS_VECTOR[a], rotation) : AXIS_VECTOR[a]);
  return (['yz', 'zx', 'xy'] as const)
    .map((plane) => {
      const [a, b] = PLANE_AXES[plane];
      const normal = (['x', 'y', 'z'] as const).find((n) => !PLANE_AXES[plane].includes(n))!;
      return { axis: normal, u: dir(a), v: dir(b) };
    })
    .filter((r) => Math.abs(r.u.x * r.v.y - r.u.y * r.v.x) >= RING_MIN_DET);
}

/** A point on `ring` at parameter `t`, in screen offsets from the pivot. */
export function ringPoint(ring: RotateRing, t: number, radius: number): Pt {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: radius * (ring.u.x * c + ring.v.x * s), y: radius * (ring.u.y * c + ring.v.y * s) };
}

/**
 * Where on `ring` a cursor points, as the ring's own parameter — solved from the
 * two spanning vectors rather than from the screen angle, which an ellipse and a
 * circle only agree on when the ring faces the eye.
 */
export function ringAngleAt(ring: RotateRing, offset: Pt, radius: number): number | null {
  const det = ring.u.x * ring.v.y - ring.u.y * ring.v.x;
  if (Math.abs(det) < RING_MIN_DET || radius <= 0) return null;
  const a = (offset.x * ring.v.y - offset.y * ring.v.x) / (radius * det);
  const b = (ring.u.x * offset.y - ring.u.y * offset.x) / (radius * det);
  return Math.atan2(b, a);
}

/** The ring under `cursor`, or null — the nearest one within the hit tolerance. */
export function hitTestRings(rings: readonly RotateRing[], pivot: Pt, cursor: Pt,
                             radius = GIZMO.ringRadius): RotateRing | null {
  const offset = { x: cursor.x - pivot.x, y: cursor.y - pivot.y };
  let best: RotateRing | null = null;
  let bestDist: number = GIZMO.hitTol;
  for (const ring of rings) {
    const t = ringAngleAt(ring, offset, radius);
    if (t === null) continue;
    const on = ringPoint(ring, t, radius);
    const d = Math.hypot(offset.x - on.x, offset.y - on.y);
    if (d < bestDist) { bestDist = d; best = ring; }
  }
  return best;
}
