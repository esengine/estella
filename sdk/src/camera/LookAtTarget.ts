// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    LookAtTarget.ts
 * @brief   Per-camera aim: turn a 3D camera so a target sits where the shot puts it on screen.
 *
 * @details The rotation stage of a camera rig (CameraRig.ts), after its position stage: FollowTarget says where a camera
 *          stands, this says where it looks:
 *          the target is held at a point of the screen, may drift inside a dead zone around it without the camera
 *          turning, and is caught up to with a damping time. The camera is turned about world up and its own right, so
 *          it never rolls. A perspective camera only: an orthographic one draws a plane, and turning it shows its edge.
 */
import { defineComponent, Transform, Camera } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { cameraAspect } from './cameraAspect';

export interface LookAtTargetData {
  /** Entity to look at (0 = none). */
  target: number;
  /** Point on the target looked at, as an offset from its origin in world units: the head of a character, not its feet. */
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  /** Where on screen the target is held: 0 the left edge, 0.5 the centre, 1 the right edge. */
  screenX: number;
  /** Where on screen the target is held: 0 the bottom edge, 0.5 the centre, 1 the top edge. */
  screenY: number;
  /** Width of the box around that point the target may move in without the camera turning, as a share of the screen. */
  deadzoneWidth: number;
  /** Height of that box, as a share of the screen. */
  deadzoneHeight: number;
  /** Damping time in seconds (larger = slower to turn; 0 = turn at once). */
  damping: number;
}

export const LookAtTarget = defineComponent<LookAtTargetData>('LookAtTarget', {
  target: INVALID_ENTITY,
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  screenX: 0.5,
  screenY: 0.5,
  deadzoneWidth: 0,
  deadzoneHeight: 0,
  damping: 0.1,
}, {
  entityFields: ['target'],
  fields: {
    target: { tooltip: 'The transform this camera turns to look at.' },
    offsetX: { tooltip: 'Point looked at, as an offset from the target in world units: its head rather than its feet.' },
    screenX: { min: 0, max: 1, step: 0.01, tooltip: 'Where the target is held across the screen: 0 left, 0.5 centre, 1 right.' },
    screenY: { min: 0, max: 1, step: 0.01, tooltip: 'Where the target is held up the screen: 0 bottom, 0.5 centre, 1 top.' },
    deadzoneWidth: { min: 0, max: 1, step: 0.01, tooltip: 'Share of the screen the target may move across without the camera turning.' },
    deadzoneHeight: { min: 0, max: 1, step: 0.01, tooltip: 'Share of the screen the target may move up and down without the camera turning.' },
    damping: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to turn most of the way to the target; 0 turns at once.' },
  },
});

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

/** What a lens shows: the tangent of half its vertical field of view, and its width over its height. */
export interface AimLens {
  tanHalfFov: number;
  aspect: number;
}

/** Steepest a camera is turned up or down: straight up has no yaw to keep. */
const MAX_PITCH = (89.5 * Math.PI) / 180;
/** Rounds of the correction that puts the target on its screen point; each one cuts the error by about the square. */
const SOLVE_ROUNDS = 6;

const quatYawPitch = (yaw: number, pitch: number): Quat => {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  // A turn about world up, then about the turned right: yaw * pitch.
  return { x: cy * sp, y: sy * cp, z: -sy * sp, w: cy * cp };
};

const rotate = (q: Quat, v: Vec3): Vec3 => {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
};

const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

const multiply = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

const normalize = (q: Quat): Quat => {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};

/** Whether two orientations are the same turn, to the precision a 32-bit Transform stores (q and -q are one turn). */
const sameTurn = (a: Quat, b: Quat): boolean => {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / ((Math.hypot(a.x, a.y, a.z, a.w) * Math.hypot(b.x, b.y, b.z, b.w)) || 1);
  return dot > 1 - 1e-10;
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const shortAngle = (from: number, to: number): number => {
  const TWO_PI = Math.PI * 2;
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
};

/** The yaw and pitch of an orientation: where its -Z points, read back as a turn about up and a lift above the horizon. */
export function yawPitchOf(q: Quat): { yaw: number; pitch: number } {
  const f = rotate(q, { x: 0, y: 0, z: -1 });
  return { yaw: Math.atan2(-f.x, -f.z), pitch: Math.asin(clamp(f.y, -1, 1)) };
}

/** Where `point` falls on the screen of a camera at `eye` turned by `yaw` and `pitch`, or null when it is behind it. */
export function screenPointOf(eye: Vec3, yaw: number, pitch: number, point: Vec3, lens: AimLens): { x: number; y: number } | null {
  const v = rotate(conjugate(quatYawPitch(yaw, pitch)), { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z });
  if (-v.z <= 1e-6) return null;
  return {
    x: 0.5 + (0.5 * (v.x / -v.z)) / (lens.tanHalfFov * lens.aspect),
    y: 0.5 + (0.5 * (v.y / -v.z)) / lens.tanHalfFov,
  };
}

/** The yaw and pitch that put `point` at screen point (`sx`, `sy`) for a camera at `eye`. */
function solveAim(eye: Vec3, point: Vec3, sx: number, sy: number, lens: AimLens): { yaw: number; pitch: number } {
  const d = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const len = Math.hypot(d.x, d.y, d.z);
  let yaw = Math.atan2(-d.x, -d.z);
  let pitch = Math.asin(clamp(d.y / len, -1, 1));
  // From straight at it, turn away by the angle the screen point is off centre; a target held off centre on both axes
  // is off by a little more than either alone, which the rounds below take out.
  yaw += Math.atan((2 * sx - 1) * lens.tanHalfFov * lens.aspect);
  pitch -= Math.atan((2 * sy - 1) * lens.tanHalfFov);
  for (let round = 0; round < SOLVE_ROUNDS; round++) {
    const at = screenPointOf(eye, yaw, clamp(pitch, -MAX_PITCH, MAX_PITCH), point, lens);
    if (!at) break;
    // Turning left (more yaw) moves what is seen to the right; looking up (more pitch) moves it down.
    yaw += Math.atan(2 * (at.x - sx) * lens.tanHalfFov * lens.aspect) * -1;
    pitch += Math.atan(2 * (at.y - sy) * lens.tanHalfFov);
  }
  return { yaw, pitch: clamp(pitch, -MAX_PITCH, MAX_PITCH) };
}

/**
 * One aim step. Pure: from the camera's eye and world orientation, the point it looks at, its lens, the composition and
 * dt, the world orientation it turns to. Unchanged while the target is inside the dead zone; outside it, aimed so the
 * target comes back to the zone's nearest edge, which with no dead zone is the screen point itself. Null when there is
 * nothing to aim at (the point is the eye).
 */
export function aimStep(eye: Vec3, rotation: Quat, point: Vec3, lens: AimLens, aim: LookAtTargetData, dt: number): Quat | null {
  if (Math.hypot(point.x - eye.x, point.y - eye.y, point.z - eye.z) < 1e-6) return null;
  const now = yawPitchOf(rotation);
  const at = screenPointOf(eye, now.yaw, now.pitch, point, lens);
  const halfW = Math.max(0, aim.deadzoneWidth) / 2, halfH = Math.max(0, aim.deadzoneHeight) / 2;
  let wantX = aim.screenX, wantY = aim.screenY;
  if (at) {
    wantX = clamp(at.x, aim.screenX - halfW, aim.screenX + halfW);
    wantY = clamp(at.y, aim.screenY - halfH, aim.screenY + halfH);
    if (wantX === at.x && wantY === at.y) return rotation;
  }
  const goal = solveAim(eye, point, wantX, wantY, lens);
  const keep = aim.damping > 0 ? Math.exp(-dt / aim.damping) : 0;
  const yaw = now.yaw + shortAngle(now.yaw, goal.yaw) * (1 - keep);
  const pitch = now.pitch + (goal.pitch - now.pitch) * (1 - keep);
  return quatYawPitch(yaw, pitch);
}

/** What a lens of `fovDegrees` (vertical) shows on a view `aspect` wide for its height; 16:9 while that is not known. */
export function aimLens(fovDegrees: number, aspect: number): AimLens {
  return {
    tanHalfFov: Math.tan((clamp(fovDegrees, 1, 179) * Math.PI) / 360),
    aspect: aspect > 0 ? aspect : 16 / 9,
  };
}

/**
 * Turns every perspective camera with a LookAtTarget toward its target. Writes the camera's own rotation: under a
 * parent, the world turn it wants is taken back through the parent's.
 */
export function lookAtUpdate(world: World, dt: number, screenAspect: number): void {
  for (const e of world.getEntitiesWithComponents([LookAtTarget, Transform, Camera])) {
    const aim = world.get(e, LookAtTarget);
    const target = aim.target as Entity;
    if (aim.target <= 0 || !world.valid(target) || !world.has(target, Transform)) continue;
    const camera = world.get(e, Camera);
    if (camera.projectionType !== 0) continue;
    const camT = world.get(e, Transform);
    const tgtT = world.get(target, Transform);
    const point = {
      x: tgtT.worldPosition.x + aim.offsetX,
      y: tgtT.worldPosition.y + aim.offsetY,
      z: tgtT.worldPosition.z + aim.offsetZ,
    };
    const lens = aimLens(camera.fov, cameraAspect(camera, screenAspect));
    const next = aimStep(camT.worldPosition, camT.worldRotation, point, lens, aim, dt);
    // Aimed already, to what a Transform holds: not written, so a still shot stamps no change every frame.
    if (!next || sameTurn(next, camT.worldRotation)) continue;
    // worldRotation = parent * rotation, so the rotation that gives the world turn wanted is parent⁻¹ * wanted. Each
    // normalised: a 32-bit store is a hair off unit length, and taken through a conjugate the hair is squared every
    // frame, until the rotation is 1e29 long and nothing is drawn.
    const parent = normalize(multiply(normalize(camT.worldRotation), conjugate(normalize(camT.rotation))));
    const local = normalize(multiply(conjugate(parent), next));
    world.set(e, Transform, { ...camT, rotation: local, worldRotation: next });
  }
}
