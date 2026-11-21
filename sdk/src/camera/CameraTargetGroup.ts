// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraTargetGroup.ts
 * @brief   Several targets framed as one: a target group and its framing.
 *
 * @details A `CameraTargetGroup` stands where its members are: each frame its entity is put at their centre, so any
 *          stage that takes one target (FollowTarget, LookAtTarget, PositionComposer, CameraDolly) frames the group by
 *          being given the group's entity. Members count by their weight; one of weight 0 is left out.
 *
 *          `GroupFraming` on a camera then sizes the shot to the group: the box that holds every member (each a sphere
 *          of the group's `radius`), seen from the camera, is made to fill `framingSize` of the screen. A camera zooms to
 *          do it (its orthoSize, or its field of view) or dollies, moving along where it looks; a dolly that reaches its
 *          range zooms for the rest. A finalize stage (CameraRig.ts): it runs after the camera is placed and aimed.
 */
import { defineComponent, Transform, Camera } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { cameraAspect } from './cameraAspect';
import { placeCamera } from './cameraPlace';
import { FollowTarget } from './FollowTarget';
import { LookAtTarget } from './LookAtTarget';
import { PositionComposer } from './PositionComposer';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

/** Where a group stands among its members. */
export const GroupCenter = {
  /** The middle of the box that holds them all: an outlier pulls the shot as far as any member. */
  Bounds: 0,
  /** Their average, by weight: a heavier member pulls it nearer. */
  Average: 1,
} as const;
export type GroupCenter = (typeof GroupCenter)[keyof typeof GroupCenter];

export interface CameraTargetGroupData {
  /** The entities framed together. */
  members: number[];
  /** Each member's weight, in the order of `members`; a missing one is 1, and 0 leaves the member out. */
  weights: number[];
  /** How big each member is, as a sphere about its origin, in world units: what the framing keeps on screen. */
  radius: number;
  /** Where the group stands: {@link GroupCenter}. */
  center: number;
}

export const CameraTargetGroup = defineComponent<CameraTargetGroupData>('CameraTargetGroup', {
  members: [],
  weights: [],
  radius: 50,
  center: GroupCenter.Bounds,
}, {
  entityFields: ['members'],
  worldUnitFields: ['radius'],
  fields: {
    members: { tooltip: 'The entities framed together. A camera given this entity as its target frames all of them.' },
    weights: { tooltip: 'Each member\'s weight, in order; a missing one is 1 and 0 leaves the member out.' },
    radius: { min: 0, tooltip: 'How big each member is, in world units: what the framing keeps on screen.' },
    center: { enum: [{ label: 'Bounds', value: 0 }, { label: 'Average', value: 1 }], tooltip: 'Where the group stands: the middle of the box about them, or their weighted average.' },
  },
});

/** How the framing fits the group: to its width, its height, or whichever needs more room. */
export const FramingMode = {
  Both: 0,
  Horizontal: 1,
  Vertical: 2,
} as const;
export type FramingMode = (typeof FramingMode)[keyof typeof FramingMode];

/** What the camera changes to fit the group. */
export const FramingAdjustment = {
  /** The lens: orthoSize, or the field of view. */
  Zoom: 0,
  /** Where it stands: along where it looks, within its distance range, then the lens for the rest. */
  DollyThenZoom: 1,
} as const;
export type FramingAdjustment = (typeof FramingAdjustment)[keyof typeof FramingAdjustment];

export interface GroupFramingData {
  /** The CameraTargetGroup framed. 0 takes the group the camera's composer, aim or follow targets. */
  group: number;
  /** Share of the screen the group fills. */
  framingSize: number;
  /** {@link FramingMode}. */
  mode: number;
  /** {@link FramingAdjustment}. */
  adjustment: number;
  /** Seconds to catch up most of the way; 0 at once. */
  damping: number;
  /** The lens's range: field of view in degrees, and orthoSize. */
  minFov: number;
  maxFov: number;
  minOrthoSize: number;
  maxOrthoSize: number;
  /** A dolly's range: how near the group's centre the camera may come, and how far it may go. */
  minDistance: number;
  maxDistance: number;
}

export const GroupFraming = defineComponent<GroupFramingData>('GroupFraming', {
  group: INVALID_ENTITY,
  framingSize: 0.8,
  mode: FramingMode.Both,
  adjustment: FramingAdjustment.Zoom,
  damping: 0.5,
  minFov: 10,
  maxFov: 80,
  minOrthoSize: 1,
  maxOrthoSize: 5000,
  minDistance: 100,
  maxDistance: 5000,
}, {
  entityFields: ['group'],
  worldUnitFields: ['minDistance', 'maxDistance'],
  fields: {
    group: { tooltip: 'The CameraTargetGroup framed. Empty takes the group the camera\'s composer, aim or follow targets.' },
    framingSize: { min: 0.05, max: 2, step: 0.01, tooltip: 'Share of the screen the group fills.' },
    mode: { enum: [{ label: 'Both', value: 0 }, { label: 'Horizontal', value: 1 }, { label: 'Vertical', value: 2 }], tooltip: 'Fit the group\'s width, its height, or whichever needs more room.' },
    adjustment: { enum: [{ label: 'Zoom', value: 0 }, { label: 'Dolly then zoom', value: 1 }], tooltip: 'Fit by the lens alone, or move nearer or further first and zoom for the rest.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to catch up most of the way; 0 at once.' },
    minFov: { min: 1, max: 179, unit: '°', advanced: true },
    maxFov: { min: 1, max: 179, unit: '°', advanced: true },
    minOrthoSize: { min: 0, advanced: true },
    maxOrthoSize: { min: 0, advanced: true },
    minDistance: { min: 0, advanced: true, tooltip: 'Dolly: how near the group\'s centre the camera may come.' },
    maxDistance: { min: 0, advanced: true, tooltip: 'Dolly: how far from it the camera may go.' },
  },
});

const rotate = (q: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
};
const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const normalize = (q: Quat): Quat => {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The members of a group that count, with their world positions and weights. */
export function groupMembers(world: World, group: CameraTargetGroupData): { at: Vec3; weight: number }[] {
  const out: { at: Vec3; weight: number }[] = [];
  group.members.forEach((m, i) => {
    const weight = group.weights[i] ?? 1;
    const e = m as Entity;
    if (!(weight > 0) || m <= 0 || !world.valid(e) || !world.has(e, Transform)) return;
    out.push({ at: { ...world.get(e, Transform).worldPosition }, weight });
  });
  return out;
}

/** Where a group of members stands: the middle of their box, or their weighted average. Null with none. */
export function groupCenter(members: readonly { at: Vec3; weight: number }[], center: number): Vec3 | null {
  if (members.length === 0) return null;
  if (center === GroupCenter.Average) {
    let w = 0;
    const s = { x: 0, y: 0, z: 0 };
    for (const m of members) {
      s.x += m.at.x * m.weight; s.y += m.at.y * m.weight; s.z += m.at.z * m.weight; w += m.weight;
    }
    return { x: s.x / w, y: s.y / w, z: s.z / w };
  }
  const lo = { ...members[0].at }, hi = { ...members[0].at };
  for (const { at } of members) {
    lo.x = Math.min(lo.x, at.x); lo.y = Math.min(lo.y, at.y); lo.z = Math.min(lo.z, at.z);
    hi.x = Math.max(hi.x, at.x); hi.y = Math.max(hi.y, at.y); hi.z = Math.max(hi.z, at.z);
  }
  return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
}

/** Puts every group where its members are. Before the position stages, so a camera following a group follows it now. */
export function targetGroupUpdate(world: World): void {
  for (const e of world.getEntitiesWithComponents([CameraTargetGroup, Transform])) {
    const group = world.get(e, CameraTargetGroup);
    const c = groupCenter(groupMembers(world, group), group.center);
    if (c) placeCamera(world, e, world.get(e, Transform), c);
  }
}

/**
 * The box a camera sees a group in: in the camera's own frame (it looks down -Z), the half width and half height the
 * members take across the screen about the group's centre, and the depth of the nearest and farthest of them.
 */
export function groupBoxInView(
  eye: Vec3, rotation: Quat, center: Vec3, members: readonly { at: Vec3 }[], radius: number,
): { halfW: number; halfH: number; near: number; far: number; centerDepth: number } {
  const inv = conjugate(normalize(rotation));
  const c = rotate(inv, { x: center.x - eye.x, y: center.y - eye.y, z: center.z - eye.z });
  let halfW = 0, halfH = 0, near = Infinity, far = -Infinity;
  for (const m of members) {
    const v = rotate(inv, { x: m.at.x - eye.x, y: m.at.y - eye.y, z: m.at.z - eye.z });
    halfW = Math.max(halfW, Math.abs(v.x - c.x) + radius);
    halfH = Math.max(halfH, Math.abs(v.y - c.y) + radius);
    near = Math.min(near, -v.z - radius);
    far = Math.max(far, -v.z + radius);
  }
  return { halfW, halfH, near, far, centerDepth: -c.z };
}

/** The half height of screen a box needs, at its own scale, to fill `framingSize` of a view `aspect` wide. */
export function neededHalfHeight(halfW: number, halfH: number, aspect: number, mode: number, framingSize: number): number {
  const a = aspect > 0 ? aspect : 16 / 9;
  const byW = halfW / a, byH = halfH;
  const h = mode === FramingMode.Horizontal ? byW : mode === FramingMode.Vertical ? byH : Math.max(byW, byH);
  return h / Math.max(0.01, framingSize);
}

/** Per dollying camera: where the rig wanted it, where the framing put it, and how far along it is held. */
const held = new WeakMap<World, Map<Entity, { raw: Vec3; written: Vec3; offset: number }>>();

const same = (a: Vec3, b: Vec3): boolean => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.z - b.z) < 1e-4;

/**
 * Takes last frame's dolly back, before the position stages run: a camera the framing moved, and that nothing has moved
 * since, goes back to where its rig wanted it. Run after the deoccluder's restore, which undoes what was done after it.
 */
export function groupFramingRestore(world: World): void {
  const cams = held.get(world);
  if (!cams) return;
  for (const [e, h] of cams) {
    if (!world.valid(e) || !world.has(e, GroupFraming) || !world.has(e, Transform)) {
      cams.delete(e);
      continue;
    }
    const t = world.get(e, Transform);
    if (same(t.worldPosition, h.written) && !same(h.raw, h.written)) placeCamera(world, e, t, h.raw);
  }
}

/** The group a camera frames: its own `group`, else the one its composer, aim or follow names. */
function groupOf(world: World, e: Entity, framing: GroupFramingData): Entity | null {
  const isGroup = (id: number) => id > 0 && world.valid(id as Entity) && world.has(id as Entity, CameraTargetGroup) ? id as Entity : null;
  if (framing.group > 0) return isGroup(framing.group);
  if (world.has(e, PositionComposer)) { const g = isGroup(world.get(e, PositionComposer).target); if (g) return g; }
  if (world.has(e, LookAtTarget)) { const g = isGroup(world.get(e, LookAtTarget).target); if (g) return g; }
  if (world.has(e, FollowTarget)) { const g = isGroup(world.get(e, FollowTarget).target); if (g) return g; }
  return null;
}

/** Sizes every GroupFraming camera's shot to its group (a finalize stage). */
export function groupFramingUpdate(world: World, dt: number, screenAspect: number): void {
  for (const e of world.getEntitiesWithComponents([GroupFraming, Transform, Camera])) {
    const framing = world.get(e, GroupFraming);
    const g = groupOf(world, e, framing);
    if (!g) continue;
    const groupData = world.get(g, CameraTargetGroup);
    const members = groupMembers(world, groupData);
    const center = groupCenter(members, groupData.center);
    if (!center) continue;
    const camera = world.get(e, Camera);
    const camT = world.get(e, Transform);
    const aspect = cameraAspect(camera, screenAspect);
    const box = groupBoxInView(camT.worldPosition, camT.worldRotation, center, members, Math.max(0, groupData.radius));
    const need = neededHalfHeight(box.halfW, box.halfH, aspect, framing.mode, framing.framingSize);
    const k = framing.damping > 0 ? 1 - Math.exp(-dt / framing.damping) : 1;

    if (camera.projectionType !== 0) {
      const size = clamp(need, framing.minOrthoSize, framing.maxOrthoSize);
      const next = camera.orthoSize + (size - camera.orthoSize) * k;
      if (Math.abs(next - camera.orthoSize) > 1e-4) world.set(e, Camera, { ...camera, orthoSize: next });
      continue;
    }

    const tanHalf = Math.tan((clamp(camera.fov, 1, 179) * Math.PI) / 360);
    // How far the near face of the box is in front of the group's centre.
    const nearOffset = box.centerDepth - box.near;
    let nearFace = box.near;
    if (framing.adjustment === FramingAdjustment.DollyThenZoom && box.centerDepth > 0) {
      // Stand where the lens as it is shows the box filling the shot, within the dolly's range; the lens takes the rest.
      // The move is held apart from where the rig put the camera, and eased, so a rig that places the camera afresh
      // each frame (a FollowTarget) is not walked along a step a frame.
      const want = clamp(need / tanHalf + nearOffset, framing.minDistance, framing.maxDistance);
      const raw = { ...camT.worldPosition };
      const was = held.get(world)?.get(e)?.offset ?? 0;
      const offset = was + (box.centerDepth - want - was) * k;
      const f = rotate(normalize(camT.worldRotation), { x: 0, y: 0, z: -1 });
      const p = { x: raw.x + f.x * offset, y: raw.y + f.y * offset, z: raw.z + f.z * offset };
      placeCamera(world, e, camT, p);
      let cams = held.get(world);
      if (!cams) held.set(world, (cams = new Map()));
      cams.set(e, { raw, written: p, offset });
      nearFace = box.near - offset;
    }
    const wantFov = clamp((2 * Math.atan(need / Math.max(1e-3, nearFace)) * 180) / Math.PI, framing.minFov, framing.maxFov);
    const fov = camera.fov + (wantFov - camera.fov) * k;
    if (Math.abs(fov - camera.fov) > 1e-4) world.set(e, Camera, { ...world.get(e, Camera), fov });
  }
}
