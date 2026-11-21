// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraNoise.ts
 * @brief   Per-camera noise: the drift of a camera held by hand, or the slow sway of one on a boat, as smooth random motion.
 *
 * @details Six channels of 1D gradient (Perlin) noise, each its own: three move the
 *          view across, up and along itself, three turn it about the same axes, so the camera drifts and nods rather than buzzing. It
 *          moves what is drawn and never the camera's Transform, as a camera shake does: the pipeline
 *          (CameraRig.ts) aims and follows from where the camera really is, and nothing builds up from one frame to the next. It is
 *          applied to each camera before the director blends between them, so a blend from a shaky camera to a still one settles.
 */
import { defineComponent } from '../ecs/component';
import type { World } from '../ecs/world';
import type { CameraPOV } from './CameraPlugin';

export interface CameraNoiseData {
  /** How far the view drifts, in world units: across, up and along the view. 0 keeps it in place. */
  amplitude: number;
  /** How far the view turns, in degrees: a nod, a pan and a roll. A handheld camera is about 0.5. */
  rotation: number;
  /** How many times a second the drift changes its mind: about 0.3 for a handheld camera, 2 for a vehicle. */
  frequency: number;
  /** Picks which drift: two cameras with the same seed move as one. 0 takes it from the entity, so no two cameras match. */
  seed: number;
}

export const CameraNoise = defineComponent<CameraNoiseData>('CameraNoise', {
  amplitude: 0,
  rotation: 0.5,
  frequency: 0.3,
  seed: 0,
}, {
  fields: {
    amplitude: { min: 0, tooltip: 'How far the view drifts across, up and along itself, in world units.' },
    rotation: { min: 0, step: 0.1, unit: '°', tooltip: 'How far the view nods, pans and rolls. About 0.5 is a camera held by hand.' },
    frequency: { min: 0, step: 0.05, unit: 'Hz', tooltip: 'How often the drift changes direction: about 0.3 by hand, 2 on a vehicle.' },
    seed: { step: 1, tooltip: 'Which drift. 0 takes one from the entity, so no two cameras move alike.' },
  },
});

/** A lattice value in [-1, 1) for integer `i` of channel `seed`: an integer hash, so it is the same on every machine. */
function lattice(i: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(seed, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h & 0xffff) / 0x8000 - 1;
}

/** 1D gradient noise at `x`: smooth, 0 at every integer, within [-1, 1]. */
function gradient(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  const a = lattice(i, seed) * f, b = lattice(i + 1, seed) * (f - 1);
  return 2 * (a + (b - a) * u);
}

/**
 * The noise of channel `channel` at time `t` seconds, for a camera of `seed` at `frequency`. Two octaves, the second at an
 * irrational ratio so the pattern never repeats in step with the first. Within [-1, 1]; smooth in `t`. Pure.
 */
export function cameraNoiseAt(seed: number, channel: number, t: number, frequency: number): number {
  const s = Math.imul(seed + 1, 7919) + channel * 104729;
  const x = t * frequency;
  return 0.75 * gradient(x, s) + 0.25 * gradient(x * 2.618 + 17.3, s + 31);
}

type Quat = { x: number; y: number; z: number; w: number };

const multiply = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

const rotate = (q: Quat, x: number, y: number, z: number) => {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  return { x: x + q.w * tx + (q.y * tz - q.z * ty), y: y + q.w * ty + (q.z * tx - q.x * tz), z: z + q.w * tz + (q.x * ty - q.y * tx) };
};

/** A small turn about the view's own right (pitch), up (yaw) and back (roll) axes, in radians. */
const localTurn = (pitch: number, yaw: number, roll: number): Quat => {
  const half = (a: number) => [Math.sin(a / 2), Math.cos(a / 2)] as const;
  const [sp, cp] = half(pitch), [sy, cy] = half(yaw), [sr, cr] = half(roll);
  return multiply(multiply({ x: 0, y: sy, z: 0, w: cy }, { x: sp, y: 0, z: 0, w: cp }), { x: 0, y: 0, z: sr, w: cr });
};

/**
 * `pov` moved by its noise at time `t`. A camera turned off the 2D plane drifts in its own frame and turns about its own axes; a 2D
 * camera drifts across the screen and rolls, the only turn it has. Pure.
 */
export function noisyPOV(pov: CameraPOV, noise: CameraNoiseData, seed: number, t: number): CameraPOV {
  if (!(noise.frequency > 0) || (!(noise.amplitude > 0) && !(noise.rotation > 0))) return pov;
  const n = (channel: number) => cameraNoiseAt(seed, channel, t, noise.frequency);
  const move = Math.max(0, noise.amplitude);
  const turn = (Math.max(0, noise.rotation) * Math.PI) / 180;
  const dx = n(0) * move, dy = n(1) * move, dz = n(2) * move;
  const pitch = n(3) * turn, yaw = n(4) * turn, roll = n(5) * turn;
  const flat = pov.tilt === undefined && pov.projection !== 0;
  if (flat) return { ...pov, x: pov.x + dx, y: pov.y + dy, rotation: pov.rotation + roll };
  const q: Quat = pov.tilt ?? { x: 0, y: 0, z: Math.sin(pov.rotation / 2), w: Math.cos(pov.rotation / 2) };
  const offset = rotate(q, dx, dy, dz);
  const turned = multiply(q, localTurn(pitch, yaw, roll));
  return { ...pov, x: pov.x + offset.x, y: pov.y + offset.y, z: pov.z + offset.z, rotation: pov.rotation + roll, tilt: turned };
}

/** Every camera candidate with a CameraNoise, moved by it at time `t`. The list is changed in place; Transforms are not touched. */
export function applyCameraNoise(world: World, povs: CameraPOV[], t: number): void {
  for (let i = 0; i < povs.length; i++) {
    const pov = povs[i]!;
    if (pov.entity <= 0 || !world.valid(pov.entity as never)) continue;
    const noise = world.tryGet(pov.entity as never, CameraNoise) as CameraNoiseData | null;
    if (!noise) continue;
    povs[i] = noisyPOV(pov, noise, noise.seed !== 0 ? noise.seed : pov.entity, t);
  }
}
