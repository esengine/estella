// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    colliderConvert.ts
 * @brief   Convert a collider between the three authorable shapes (box / circle / polygon)
 *          without losing what matters: material (density/friction/restitution), sensor,
 *          collision filter (categoryBits/maskBits) and enable carry across unchanged, and
 *          the geometry is re-derived so the shape stays where it was drawn — a box/circle
 *          offset bakes into the polygon's vertices, and a polygon's AABB centre comes back
 *          out as an offset. Pure: `SceneCommands.convertCollider` wraps it in one undoable
 *          model swap. capsule / segment / chain aren't offered (rare) — this is the
 *          Box↔Circle↔Polygon triangle.
 */

export type ColliderShapeKind = 'box' | 'circle' | 'polygon';

/** The three convertible shapes ↔ their component names. */
export const COLLIDER_SHAPE_COMP: Record<ColliderShapeKind, string> = {
  box: 'BoxCollider',
  circle: 'CircleCollider',
  polygon: 'PolygonCollider',
};
/** Component name → shape kind, for the convertible three (undefined for the rest). */
export const COMP_COLLIDER_SHAPE: Record<string, ColliderShapeKind | undefined> = {
  BoxCollider: 'box',
  CircleCollider: 'circle',
  PolygonCollider: 'polygon',
};

// Material + sensor + filter + enable — carried across a conversion verbatim. Every
// convertible collider has all of these (chain lacks some, but chain isn't convertible).
const SHARED_KEYS = ['density', 'friction', 'restitution', 'isSensor', 'categoryBits', 'maskBits', 'enabled'] as const;

// Segments when sampling a circle into a polygon — smooth enough to read as round.
const CIRCLE_SEGMENTS = 16;

interface Vec2 { x: number; y: number }
const v = (x: number, y: number): Vec2 => ({ x, y });

function num(x: unknown, d: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : d;
}
function vec(x: unknown, d: Vec2 = v(0, 0)): Vec2 {
  return x && typeof x === 'object' && 'x' in x && 'y' in x
    ? v(num((x as Vec2).x, d.x), num((x as Vec2).y, d.y))
    : d;
}
function vecArray(x: unknown): Vec2[] {
  return Array.isArray(x) ? x.map((p) => vec(p)) : [];
}
function boxVerts(c: Vec2, h: Vec2): Vec2[] {
  return [v(c.x - h.x, c.y - h.y), v(c.x + h.x, c.y - h.y), v(c.x + h.x, c.y + h.y), v(c.x - h.x, c.y + h.y)];
}

/**
 * The source collider abstracted to a common form: a centre (its offset), an AABB
 * half-size, a representative radius, and its outline vertices RELATIVE TO THE ENTITY
 * ORIGIN (offset baked in). Every target shape is realized from this, so a conversion
 * keeps the shape where it sat.
 */
function abstractGeometry(fromComp: string, d: Record<string, unknown>): { center: Vec2; half: Vec2; radius: number; verts: Vec2[] } {
  if (fromComp === 'CircleCollider') {
    const r = num(d.radius, 0.5);
    const o = vec(d.offset);
    const verts: Vec2[] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      verts.push(v(o.x + r * Math.cos(a), o.y + r * Math.sin(a)));
    }
    return { center: o, half: v(r, r), radius: r, verts };
  }
  if (fromComp === 'PolygonCollider') {
    const verts = vecArray(d.vertices);
    if (verts.length === 0) return { center: v(0, 0), half: v(0.5, 0.5), radius: 0.5, verts: boxVerts(v(0, 0), v(0.5, 0.5)) };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of verts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const center = v((minX + maxX) / 2, (minY + maxY) / 2);
    const half = v((maxX - minX) / 2, (maxY - minY) / 2);
    let radius = 0;
    for (const p of verts) radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y));
    return { center, half, radius: radius || Math.max(half.x, half.y), verts };
  }
  // BoxCollider (or anything box-like): halfExtents + offset.
  const he = vec(d.halfExtents, v(0.5, 0.5));
  const o = vec(d.offset);
  return { center: o, half: he, radius: Math.max(he.x, he.y), verts: boxVerts(o, he) };
}

/** Realize the abstract geometry as the target collider's geometry fields. */
function realizeGeometry(toComp: string, g: { center: Vec2; half: Vec2; radius: number; verts: Vec2[] }): Record<string, unknown> {
  if (toComp === 'CircleCollider') return { radius: g.radius, offset: v(g.center.x, g.center.y) };
  if (toComp === 'PolygonCollider') return { vertices: g.verts.map((p) => v(p.x, p.y)) };
  return { halfExtents: v(g.half.x, g.half.y), offset: v(g.center.x, g.center.y) }; // Box
}

/**
 * The target collider's FULL data when converting `fromComp` → `toComp`: start from the
 * target's defaults (`toDefaults`), keep the shared material / sensor / filter / enable
 * fields the source set, then overwrite the geometry re-derived from the source. Pure —
 * no engine or model access; the caller supplies the target defaults.
 */
export function convertColliderData(
  fromComp: string,
  toComp: string,
  from: Record<string, unknown>,
  toDefaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...toDefaults };
  for (const k of SHARED_KEYS) if (k in from && k in out) out[k] = from[k];
  Object.assign(out, realizeGeometry(toComp, abstractGeometry(fromComp, from)));
  return out;
}
