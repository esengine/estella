// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  viewportMath.ts
 * @brief Pure 2D geometry for viewport picking, marquee, and gizmos — no engine
 *        state or DOM, so it unit-tests in isolation. The imperative shells
 *        (ViewportController picking, the gizmo tools) layer on top of these.
 *        The one import is the SDK's pure mirror of the renderer's layer rules,
 *        which picking has to rank by rather than restate.
 */
import { compareDrawRank, type DrawRank } from 'esengine';

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

/** A 2D world frame: translation, Z rotation (radians), per-axis scale. */
export interface Frame2D {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
}

/**
 * A world-space point re-expressed in `frame`'s local coordinates — the inverse
 * of the engine's TRS compose (world = T + R(rot)·(S·local)), so
 * local = S⁻¹·R(−rot)·(world − T). A zero scale axis passes through undivided
 * (a degenerate frame has no inverse; don't explode to Infinity).
 */
export function worldToLocal2D(wx: number, wy: number, frame: Frame2D): { x: number; y: number } {
  const dx = wx - frame.x;
  const dy = wy - frame.y;
  const c = Math.cos(-frame.rot);
  const s = Math.sin(-frame.rot);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return { x: frame.sx ? rx / frame.sx : rx, y: frame.sy ? ry / frame.sy : ry };
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

/** One entity under the pointer, with everything its rank depends on. */
export interface PickCandidate<T> {
  entity: T;
  /** Where the frame put it: layer, that layer's rule, and the world coords it uses. */
  rank: DrawRank;
  /** Position in the World's iteration order: the paint order for equal depth. */
  index: number;
}

/**
 * Candidates ranked topmost-first, the way the RENDERER stacked them — the layer
 * rules via {@link compareDrawRank}, then later-drawn winning ties.
 *
 * Split out as a pure function because it is the part that can be wrong while
 * every hit test is right — and it ranks what a person SEES, so getting it
 * backwards means the click selects the thing hidden behind the thing they
 * aimed at.
 */
export function rankPickCandidates<T>(candidates: ReadonlyArray<PickCandidate<T>>): T[] {
  return [...candidates]
    .sort((a, b) => compareDrawRank(b.rank, a.rank) || b.index - a.index)
    .map((c) => c.entity);
}
