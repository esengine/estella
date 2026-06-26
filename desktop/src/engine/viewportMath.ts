// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  viewportMath.ts
 * @brief Pure 2D geometry for viewport picking, marquee, and gizmos — no engine /
 *        DOM coupling, so it unit-tests in isolation. The imperative shells
 *        (ViewportController picking, the gizmo tools) layer on top of these.
 */

/** Oriented bounding box in world space: center, half-extents, Z rotation (radians). */
export interface OBB {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  rot: number;
}

/** An axis-aligned rect in CSS-pixel (client) space. */
export interface ClientRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Z angle (radians) of a rotation quaternion — the only DOF a 2D transform uses. */
export function quatAngleZ(q: { w: number; x: number; y: number; z: number }): number {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

/** The four world-space corners of an OBB, CCW from the (−hw,−hh) local corner. */
export function obbCorners(b: OBB): Array<[number, number]> {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return ([[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]] as const).map(
    ([lx, ly]) => [b.cx + lx * c - ly * s, b.cy + lx * s + ly * c] as [number, number],
  );
}

/** Whether a world point lies inside an OBB (transform the point into the box's local frame). */
export function pointInOBB(px: number, py: number, b: OBB): boolean {
  const dx = px - b.cx;
  const dy = py - b.cy;
  const c = Math.cos(-b.rot);
  const s = Math.sin(-b.rot);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  return Math.abs(lx) <= b.hw && Math.abs(ly) <= b.hh;
}

/** Whether two client rects overlap (touching edges count as overlap). */
export function rectsIntersect(a: ClientRect, b: ClientRect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Screen-space (CSS-px) AABB of a set of projected points, or null if any failed to project. */
export function screenAABB(points: Array<{ x: number; y: number } | null>): ClientRect | null {
  if (points.some((p) => !p)) return null;
  const xs = points.map((p) => p!.x);
  const ys = points.map((p) => p!.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Round to the nearest multiple of `step` (snap). `step <= 0` returns `v` unchanged. */
export const snapTo = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);
