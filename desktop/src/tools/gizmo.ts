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
export function hitTestGizmo(mode: GizmoMode, pivot: Pt, cursor: Pt, axisAngleRad = 0): GizmoHandle | null {
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
  // rotate: a ring of radius ringRadius around the pivot.
  const d = Math.hypot(cursor.x - pivot.x, cursor.y - pivot.y);
  if (Math.abs(d - GIZMO.ringRadius) <= GIZMO.hitTol) return { id: 'rotate.ring', mode, axis: 'xy' };
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
