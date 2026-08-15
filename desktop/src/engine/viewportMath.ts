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
import { compareDrawRank, type DrawRank, type ScreenAxis } from 'esengine';

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

export interface Quat { x: number; y: number; z: number; w: number }

/** Quaternion for a turn of `rad` about a world axis. */
export function axisQuat(axis: 'x' | 'y' | 'z', rad: number): Quat {
  const s = Math.sin(rad / 2);
  return {
    x: axis === 'x' ? s : 0,
    y: axis === 'y' ? s : 0,
    z: axis === 'z' ? s : 0,
    w: Math.cos(rad / 2),
  };
}

/** `a` applied after `b` (a·b) — a WORLD-space turn composes on the left. */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * A rotation turned by `radians` about Z. Composed as an increment rather than
 * rebuilt from a Z angle, so whatever the other two axes say survives it — a
 * model imported with a 3D pose keeps that pose through a nudge.
 */
export function turnQuat2D(q: { x?: number; y?: number; z?: number; w?: number } | undefined, radians: number): Quat {
  const cur: Quat = { x: q?.x ?? 0, y: q?.y ?? 0, z: q?.z ?? 0, w: q?.w ?? 1 };
  return quatMul(axisQuat('z', radians), cur);
}

/** The Z angle of a 2D rotation quaternion; 0 for one that isn't there. */
export function quatAngleZ2D(q: { z?: number; w?: number } | undefined): number {
  return 2 * Math.atan2(q?.z ?? 0, q?.w ?? 1);
}

/** A scale vector multiplied by a per-axis factor, keeping z. */
export function scaleVecBy(
  s: { x?: number; y?: number; z?: number } | undefined,
  factor: { x: number; y: number },
): { x: number; y: number; z: number } {
  return { x: (s?.x ?? 1) * factor.x, y: (s?.y ?? 1) * factor.y, z: s?.z ?? 1 };
}

/** One end of the view-axis indicator, placed in its SVG's local pixels. */
export interface AxisIndicatorEnd {
  key: string;
  x: number;
  y: number;
  depth: number;
}

/** The identity of one indicator end — the key its DOM node carries. */
export function axisEndKey(axis: 'x' | 'y' | 'z', sign: 1 | -1): string {
  return `${axis}${sign > 0 ? '+' : '-'}`;
}

/**
 * The six ends of the view-axis indicator, in painter order (far first, so a near
 * knob covers a far one). Offsets are the axis direction UNNORMALIZED: an axis
 * leaning at the eye draws short, and that foreshortening is what tells a user
 * how far the view has turned.
 */
export function axisIndicatorEnds(
  axes: { x: ScreenAxis; y: ScreenAxis; z: ScreenAxis },
  length: number,
): AxisIndicatorEnd[] {
  const ends: AxisIndicatorEnd[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const sign of [1, -1] as const) {
      const a = axes[axis];
      ends.push({
        key: axisEndKey(axis, sign),
        x: a.dx * sign * length,
        y: a.dy * sign * length,
        depth: a.depth * sign,
      });
    }
  }
  return ends.sort((a, b) => a.depth - b.depth);
}
