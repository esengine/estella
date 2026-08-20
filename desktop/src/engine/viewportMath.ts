// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  viewportMath.ts
 * @brief Pure geometry for viewport picking, marquee, and gizmos — no engine
 *        state or DOM, so it unit-tests in isolation. The imperative shells
 *        (ViewportController picking, the gizmo tools) layer on top of these.
 *        Flat helpers stay flat because what they describe is (a tile cell, a
 *        laid-out UI box); a transform frame is not one of those, and its
 *        inverse is `worldToLocal3D`.
 *        The one import is the SDK's pure mirror of the renderer's layer rules,
 *        which picking has to rank by rather than restate.
 */
import type { ScreenAxis } from 'esengine';

/** A flat rect in the XY plane: center, half-extents, Z rotation (radians). What a
 *  2D authoring shape is — a particle emitter's spawn box, a tile cell. An entity's
 *  extent is not one of these; it is an `EntityBox`, which has a third dimension. */
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

/**
 * Z angle (radians) of a rotation quaternion — the turn a 2D transform is made of,
 * and the one a 2D gesture edits on a posed one. From the WHOLE quaternion:
 * `2·atan2(z, w)` is this angle only while x and y are zero. Absent components read
 * as the identity, so a partial rotation is no rotation rather than a NaN.
 */
export function quatAngleZ(q: { w?: number; x?: number; y?: number; z?: number } | undefined): number {
  const w = q?.w ?? 1;
  const x = q?.x ?? 0;
  const y = q?.y ?? 0;
  const z = q?.z ?? 0;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/** The four world-space corners of an OBB, CCW from the (−hw,−hh) local corner. */
export function obbCorners(b: OBB): Array<[number, number]> {
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  return ([[-b.hw, -b.hh], [b.hw, -b.hh], [b.hw, b.hh], [-b.hw, b.hh]] as const).map(
    ([lx, ly]) => [b.cx + lx * c - ly * s, b.cy + lx * s + ly * c] as [number, number],
  );
}

/**
 * The outline of a set of projected points: their convex hull, counter-clockwise
 * (Andrew's monotone chain). A box's eight corners are a quadrilateral on screen
 * while it is flat and a hexagon once it has depth, and an outline drawn through
 * them in any fixed order crosses itself.
 */
export function screenHull(points: ReadonlyArray<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  if (pts.length < 3) return pts;
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (source: typeof pts): typeof pts => {
    const out: typeof pts = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
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

/** A world frame: translation, rotation, per-axis scale — one entity's TRS. */
export interface Frame3D {
  pos: Vec3;
  rot: Quat;
  scale: Vec3;
}

/**
 * A world point re-expressed in `frame`'s local coordinates — the inverse of the
 * engine's TRS compose (world = T + R·(S·local)), so local = S⁻¹·R⁻¹·(world − T).
 * A parent turned about X or Y has no 2D inverse, which is why the editor writes
 * through this one. A zero scale axis passes through undivided (no inverse).
 */
export function worldToLocal3D(w: Vec3, frame: Frame3D): Vec3 {
  const d = { x: w.x - frame.pos.x, y: w.y - frame.pos.y, z: w.z - frame.pos.z };
  const q = frame.rot;
  const r = rotateVec3(d, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
  return {
    x: frame.scale.x ? r.x / frame.scale.x : r.x,
    y: frame.scale.y ? r.y / frame.scale.y : r.y,
    z: frame.scale.z ? r.z / frame.scale.z : r.z,
  };
}

/** A point in screen (CSS px) space. */
export interface Pt {
  x: number;
  y: number;
}

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
 * The projection of a direction is linear in that basis, so every arrow the editor
 * draws — a gizmo handle, a ring's spanning vectors, a light's aim — is this one
 * function applied to a unit vector, and none of them writes a direction down.
 */
export function screenDir(axes: ViewAxes, v: Vec3): Pt {
  return {
    x: v.x * axes.x.dx + v.y * axes.y.dx + v.z * axes.z.dx,
    y: v.x * axes.x.dy + v.y * axes.y.dy + v.z * axes.z.dy,
  };
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

export interface Quat { x: number; y: number; z: number; w: number }

/** A point or direction in world space. */
export interface Vec3 { x: number; y: number; z: number }

/**
 * A vector turned by a quaternion (q·v·q⁻¹, expanded).
 *
 * The editor's ONE copy of this: a gizmo's local axes, a group rotation's arm and
 * a parent frame's inverse are the same turn, and three transcriptions of it are
 * three chances for the handle, the motion and the stored value to disagree.
 */
export function rotateVec3(v: Vec3, q: Quat): Vec3 {
  const t = { x: 2 * (q.y * v.z - q.z * v.y), y: 2 * (q.z * v.x - q.x * v.z), z: 2 * (q.x * v.y - q.y * v.x) };
  return {
    x: v.x + q.w * t.x + q.y * t.z - q.z * t.y,
    y: v.y + q.w * t.y + q.z * t.x - q.x * t.z,
    z: v.z + q.w * t.z + q.x * t.y - q.y * t.x,
  };
}

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

/**
 * Where each of a frustum's four side edges crosses the plane z = `planeZ`, in
 * the corner order `cameraFrustumCorners` returns (near face, then far). An edge
 * that never reaches the plane yields null, so a caller with any null has no
 * quadrilateral to draw rather than a made-up one.
 */
export function frustumPlaneCrossings(
  corners: ArrayLike<number>,
  planeZ: number,
): ({ x: number; y: number } | null)[] {
  const out: ({ x: number; y: number } | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const n = i * 3;
    const f = 12 + i * 3;
    const span = corners[f + 2]! - corners[n + 2]!;
    const k = Math.abs(span) > 1e-6 ? (planeZ - corners[n + 2]!) / span : -1;
    out.push(k >= 0 && k <= 1
      ? {
          x: corners[n]! + (corners[f]! - corners[n]!) * k,
          y: corners[n + 1]! + (corners[f + 1]! - corners[n + 1]!) * k,
        }
      : null);
  }
  return out;
}
