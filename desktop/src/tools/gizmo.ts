// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gizmo.ts
 * @brief Pure geometry for the interactive transform gizmo — handle hit-testing,
 *        axis constraint, group pivot. No engine / DOM coupling, so it unit-tests
 *        in isolation; transformTools.ts is the imperative shell that drives it.
 *
 * Coordinate model: the gizmo lives at a screen-space (CSS px) pivot. Its axes map
 * to world axes through the editor's ortho 2D camera, where world +X = screen +X
 * and world +Y = screen −Y (screen y is down). So hit-testing is done in client
 * space against fixed screen directions, while the actual transform (in the tool)
 * applies the world-space delta the cursor traveled, constrained to the axis.
 */

import { axisQuat, quatMul, type Quat } from '@/engine/viewportMath';

export { axisQuat, quatMul, type Quat };

export type GizmoMode = 'move' | 'rotate' | 'scale';
/** Which world axes a handle drag affects. */
export type GizmoAxis = 'x' | 'y' | 'xy';

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

// Screen-space unit directions of the world axes (ortho 2D camera): +X right, +Y up.
const X_DIR: Pt = { x: 1, y: 0 };
const Y_DIR: Pt = { x: 0, y: -1 };

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

/** Rotate a screen-space direction by `a` radians (screen frame). */
function rotDir(dir: Pt, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
}

/**
 * The handle under `cursor` for the active gizmo at `pivot` (all CSS px), or null.
 * Central handles (plane / uniform box / nothing) are tested before the axes so the
 * smaller, foreground targets win. `axisAngleRad` rotates the axis arrows to the
 * gizmo's on-screen orientation (0 = world-aligned; non-zero in local space, and it
 * must match the gizmo's render rotation so the handle you aim at is the one hit).
 */
export function hitTestGizmo(mode: 'move' | 'scale', pivot: Pt, cursor: Pt, axisAngleRad = 0): GizmoHandle | null {
  const xEnd = along(pivot, rotDir(X_DIR, axisAngleRad), GIZMO.axisLen);
  const yEnd = along(pivot, rotDir(Y_DIR, axisAngleRad), GIZMO.axisLen);

  if (mode === 'move') {
    if (within(cursor, pivot, GIZMO.planeSize / 2)) return { id: 'move.xy', mode, axis: 'xy' };
    if (distToSegment(cursor, pivot, xEnd) <= GIZMO.hitTol) return { id: 'move.x', mode, axis: 'x' };
    if (distToSegment(cursor, pivot, yEnd) <= GIZMO.hitTol) return { id: 'move.y', mode, axis: 'y' };
    return null;
  }
  if (mode === 'scale') {
    if (within(cursor, pivot, GIZMO.planeSize / 2)) return { id: 'scale.xy', mode, axis: 'xy' };
    if (within(cursor, xEnd, GIZMO.boxSize) || distToSegment(cursor, pivot, xEnd) <= GIZMO.hitTol)
      return { id: 'scale.x', mode, axis: 'x' };
    if (within(cursor, yEnd, GIZMO.boxSize) || distToSegment(cursor, pivot, yEnd) <= GIZMO.hitTol)
      return { id: 'scale.y', mode, axis: 'y' };
    return null;
  }
  // rotate aims at rings, which need the view's axes — see hitTestRings.
  return null;
}

/** Constrain a world-space delta to a handle's axis (world-aligned axes). */
export function constrainWorldDelta(axis: GizmoAxis, dx: number, dy: number): [number, number] {
  if (axis === 'x') return [dx, 0];
  if (axis === 'y') return [0, dy];
  return [dx, dy];
}

/**
 * Constrain a world-space delta to a handle's axis rotated into the object's local
 * frame by `angleRad` (the entity's world rotation, +Y up). The delta is projected
 * onto the local axis so a single-axis drag slides along the object's own X/Y.
 * `xy` is unconstrained. With `angleRad === 0` this equals {@link constrainWorldDelta}.
 */
export function constrainLocalDelta(axis: GizmoAxis, dx: number, dy: number, angleRad: number): [number, number] {
  if (axis === 'xy') return [dx, dy];
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  // Local X = (cosθ, sinθ); local Y = (−sinθ, cosθ) in world space (+Y up).
  const ax = axis === 'x' ? c : -s;
  const ay = axis === 'x' ? s : c;
  const k = dx * ax + dy * ay; // project the delta onto the chosen local axis
  return [k * ax, k * ay];
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
export function rotateRings(axes: {
  x: { dx: number; dy: number }; y: { dx: number; dy: number }; z: { dx: number; dy: number };
}): RotateRing[] {
  const pt = (a: { dx: number; dy: number }): Pt => ({ x: a.dx, y: a.dy });
  return ([
    { axis: 'x', u: pt(axes.y), v: pt(axes.z) },
    { axis: 'y', u: pt(axes.z), v: pt(axes.x) },
    { axis: 'z', u: pt(axes.x), v: pt(axes.y) },
  ] as const).filter((r) => Math.abs(r.u.x * r.v.y - r.u.y * r.v.x) >= RING_MIN_DET);
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
