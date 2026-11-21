// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    PositionComposer.ts
 * @brief   Moves a camera, without turning it, so its target sits at a chosen point of the screen,
 *          for a 2D camera and a 3D one alike.
 *
 * @details The composition is said on the screen, as LookAtTarget's is, and with the same field names, so the editor's
 *          guides draw and drag either: a screen point, a dead zone around it the target may wander in with the camera
 *          still, and a soft zone beyond that, inside which the camera catches up eased by `damping`. A target past the
 *          soft zone is brought to its edge at once: the zone is as far off the point as a shot ever lets it get.
 *
 *          The camera moves across its own screen plane (its right and up), so a turned camera slides as a dolly would;
 *          a 3D camera also keeps `cameraDistance` from the target along where it looks, eased by `depthDamping`. An
 *          orthographic camera's screen is its `orthoSize` tall at any depth, and depth is left alone.
 *
 *          A position stage (CameraRig.ts): it runs where FollowTarget and CameraDolly do, and a camera uses one of them.
 */
import { defineComponent, Transform, Camera, type CameraData } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { cameraAspect } from './cameraAspect';
import { placeCamera } from './cameraPlace';

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

export interface PositionComposerData {
  /** The transform the camera frames. */
  target: number;
  /** The point framed, as an offset from the target in world units. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  /** Where the target is held across the screen: 0 left, 0.5 centre, 1 right. */
  screenX: number;
  /** Where the target is held up the screen: 0 bottom, 0.5 centre, 1 top. */
  screenY: number;
  /** Share of the screen the target may move in with the camera still. */
  deadzoneWidth: number;
  deadzoneHeight: number;
  /** Share of the screen the target is kept inside: past its edge the camera moves at once. */
  softzoneWidth: number;
  softzoneHeight: number;
  /** Seconds to catch up most of the way across the screen; 0 at once. */
  damping: number;
  /** 3D: how far in front of the camera the target is kept, along where it looks. 0 keeps whatever distance it has. */
  cameraDistance: number;
  /** 3D: seconds to catch up most of the way to that distance. */
  depthDamping: number;
}

export const PositionComposer = defineComponent<PositionComposerData>('PositionComposer', {
  target: INVALID_ENTITY,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  screenX: 0.5,
  screenY: 0.5,
  deadzoneWidth: 0,
  deadzoneHeight: 0,
  softzoneWidth: 0.8,
  softzoneHeight: 0.8,
  damping: 0.3,
  cameraDistance: 0,
  depthDamping: 0.3,
}, {
  entityFields: ['target'],
  worldUnitFields: ['offsetX', 'offsetY', 'offsetZ', 'cameraDistance'],
  fields: {
    target: { tooltip: 'The transform this camera frames.' },
    offsetX: { tooltip: 'Point framed, as an offset from the target in world units: its head rather than its feet.' },
    screenX: { min: 0, max: 1, step: 0.01, tooltip: 'Where the target is held across the screen: 0 left, 0.5 centre, 1 right.' },
    screenY: { min: 0, max: 1, step: 0.01, tooltip: 'Where the target is held up the screen: 0 bottom, 0.5 centre, 1 top.' },
    deadzoneWidth: { min: 0, max: 1, step: 0.01, tooltip: 'Share of the screen the target may move across with the camera still.' },
    deadzoneHeight: { min: 0, max: 1, step: 0.01, tooltip: 'Share of the screen the target may move up and down with the camera still.' },
    softzoneWidth: { min: 0, max: 2, step: 0.01, tooltip: 'Share of the screen the target is kept inside; past it the camera moves at once.' },
    softzoneHeight: { min: 0, max: 2, step: 0.01, tooltip: 'Share of the screen the target is kept inside up and down; past it the camera moves at once.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to catch up most of the way across the screen; 0 at once.' },
    cameraDistance: { min: 0, tooltip: '3D: how far in front of the camera the target is kept. 0 keeps whatever distance it has.' },
    depthDamping: { min: 0, step: 0.05, unit: 's', tooltip: '3D: seconds to catch up most of the way to that distance.' },
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

/**
 * How far along one screen axis the camera moves this frame, as a share of the screen: the target is `at`, held at
 * `want`, free inside a dead zone `dead` wide and kept inside a soft zone `soft` wide. Past the soft zone's edge the
 * excess goes at once; the rest of the way past the dead zone is caught up by the share `k`.
 */
export function composeAxis(at: number, want: number, dead: number, soft: number, k: number): number {
  const off = at - want;
  const halfDead = Math.max(0, dead) / 2;
  const past = Math.abs(off) <= halfDead ? 0 : off - Math.sign(off) * halfDead;
  if (past === 0) return 0;
  const halfSoft = Math.max(halfDead, Math.max(0, soft) / 2);
  const hard = Math.abs(off) > halfSoft ? off - Math.sign(off) * halfSoft : 0;
  return hard + (past - hard) * k;
}

/** The screen of a camera at a depth: how many world units its full width and height span. */
function screenSpan(camera: CameraData, aspect: number, depth: number): { w: number; h: number } {
  const a = aspect > 0 ? aspect : 16 / 9;
  const h = camera.projectionType === 0
    ? 2 * depth * Math.tan((Math.min(179, Math.max(1, camera.fov)) * Math.PI) / 360)
    : 2 * camera.orthoSize;
  return { w: h * a, h };
}

/**
 * One composer step. Pure: from where the camera is and how it is turned, the point it frames, its lens and the
 * composition, where the camera goes this frame. The point's place on screen is measured in the camera's own frame (it
 * looks down its -Z), so a camera turned any way slides across what it sees.
 */
export function composeStep(
  eye: Vec3, rotation: Quat, point: Vec3, camera: CameraData, aspect: number, data: PositionComposerData, dt: number,
): Vec3 {
  const q = normalize(rotation);
  const v = rotate(conjugate(q), { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z });
  const perspective = camera.projectionType === 0;
  // Depth first, so the screen is measured at the distance the camera is going to.
  let moveZ = 0;
  let depth = -v.z;
  if (perspective && data.cameraDistance > 0) {
    const kz = data.depthDamping > 0 ? 1 - Math.exp(-dt / data.depthDamping) : 1;
    // Moving the camera forward by m (its -Z) brings the point m nearer.
    const m = (depth - data.cameraDistance) * kz;
    moveZ = -m;
    depth -= m;
  }
  if (perspective && depth <= 1e-6) return eye;
  const span = screenSpan(camera, aspect, depth);
  const at = { x: 0.5 + v.x / span.w, y: 0.5 + v.y / span.h };
  const k = data.damping > 0 ? 1 - Math.exp(-dt / data.damping) : 1;
  const mx = composeAxis(at.x, data.screenX, data.deadzoneWidth, data.softzoneWidth, k) * span.w;
  const my = composeAxis(at.y, data.screenY, data.deadzoneHeight, data.softzoneHeight, k) * span.h;
  if (mx === 0 && my === 0 && moveZ === 0) return eye;
  const d = rotate(q, { x: mx, y: my, z: moveZ });
  return { x: eye.x + d.x, y: eye.y + d.y, z: eye.z + d.z };
}

/** Moves every camera with a PositionComposer so its target sits where the composition holds it (a position stage). */
export function positionComposerUpdate(world: World, dt: number, screenAspect: number): void {
  for (const e of world.getEntitiesWithComponents([PositionComposer, Transform, Camera])) {
    const data = world.get(e, PositionComposer);
    const target = data.target as Entity;
    if (data.target <= 0 || !world.valid(target) || !world.has(target, Transform)) continue;
    const camera = world.get(e, Camera);
    const camT = world.get(e, Transform);
    const tp = world.get(target, Transform).worldPosition;
    const point = { x: tp.x + data.offsetX, y: tp.y + data.offsetY, z: tp.z + data.offsetZ };
    const next = composeStep(camT.worldPosition, camT.worldRotation, point, camera, cameraAspect(camera, screenAspect), data, dt);
    if (next !== camT.worldPosition) placeCamera(world, e, camT, next);
  }
}
