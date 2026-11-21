// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraImpulse.ts
 * @brief   Shakes that happen somewhere: an impulse fired at a place, felt by the cameras that listen, more the nearer
 *          they are. An impulse source and its listeners.
 *
 * @details `shakeCamera` shakes the drawn view wherever it is. An explosion is not like that: a camera beside it jolts, one
 *          across the level barely trembles, and with a propagation speed the far one feels it a moment later. A
 *          `CameraImpulseSource` describes the jolt (how far and how much it turns the view, how fast it trembles, its
 *          attack, sustain and decay, and how it fades with distance); `fireImpulse` sets one off where the source is,
 *          as does setting its `fire` flag (for a timeline, a visual script, or the inspector in play). A
 *          `CameraImpulseListener` on a camera says which channels it feels and how strongly.
 *
 *          The jolt moves only what is drawn, per camera before the blend, as noise does (CameraNoise.ts): it never
 *          touches a camera's Transform, so it always settles.
 */
import { defineComponent, Transform } from '../ecs/component';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import type { CameraPOV } from './CameraPlugin';
import { noisyPOV } from './CameraNoise';

type Vec3 = { x: number; y: number; z: number };

export interface CameraImpulseSourceData {
  /** How far the view is thrown, in world units, at full strength. */
  amplitude: number;
  /** How far it is turned, in degrees, at full strength. */
  rotation: number;
  /** How fast it trembles, in Hz: about 8 for a blast, 2 for a heavy footfall. */
  frequency: number;
  /** Seconds to reach full strength, to hold it, and to die away. */
  attack: number;
  sustain: number;
  decay: number;
  /** Felt at full strength within this distance of the source. */
  radius: number;
  /** Beyond the radius, the distance over which it fades to nothing. */
  dissipation: number;
  /** World units a second it travels at; 0 is felt everywhere at once. */
  propagationSpeed: number;
  /** Which listeners feel it: a listener feels an impulse sharing a bit of its channels. */
  channels: number;
  /** Set to fire an impulse from here; cleared once fired. */
  fire: boolean;
}

export const CameraImpulseSource = defineComponent<CameraImpulseSourceData>('CameraImpulseSource', {
  amplitude: 20,
  rotation: 1,
  frequency: 8,
  attack: 0.02,
  sustain: 0.1,
  decay: 0.6,
  radius: 300,
  dissipation: 2000,
  propagationSpeed: 0,
  channels: 1,
  fire: false,
}, {
  worldUnitFields: ['amplitude', 'radius', 'dissipation', 'propagationSpeed'],
  fields: {
    amplitude: { min: 0, tooltip: 'How far the view is thrown, in world units, at full strength.' },
    rotation: { min: 0, step: 0.1, unit: '°', tooltip: 'How far the view is turned at full strength.' },
    frequency: { min: 0, step: 0.5, unit: 'Hz', tooltip: 'How fast it trembles: about 8 for a blast, 2 for a heavy footfall.' },
    attack: { min: 0, step: 0.01, unit: 's', tooltip: 'Seconds to reach full strength.' },
    sustain: { min: 0, step: 0.01, unit: 's', tooltip: 'Seconds held at full strength.' },
    decay: { min: 0, step: 0.05, unit: 's', tooltip: 'Seconds to die away.' },
    radius: { min: 0, tooltip: 'Felt at full strength within this distance of the source.' },
    dissipation: { min: 0, tooltip: 'Beyond the radius, the distance over which it fades to nothing.' },
    propagationSpeed: { min: 0, advanced: true, tooltip: 'World units a second it travels at; 0 is felt everywhere at once.' },
    channels: { bitmask: { bits: 8 }, advanced: true, tooltip: 'Which listeners feel it: those sharing a channel.' },
    fire: { tooltip: 'Set to fire an impulse from here (in play); cleared once fired.' },
  },
});

export interface CameraImpulseListenerData {
  /** Which impulses this camera feels: those sharing a bit of these channels. */
  channels: number;
  /** How strongly: 1 as fired, 0 not at all. */
  gain: number;
  /** Measure distance on the X/Y plane only, as a 2D game's camera stands off it. */
  use2DDistance: boolean;
}

export const CameraImpulseListener = defineComponent<CameraImpulseListenerData>('CameraImpulseListener', {
  channels: 1,
  gain: 1,
  use2DDistance: false,
}, {
  fields: {
    channels: { bitmask: { bits: 8 }, tooltip: 'Which impulses this camera feels: those sharing a channel.' },
    gain: { min: 0, step: 0.1, tooltip: 'How strongly: 1 as fired, 0 not at all.' },
    use2DDistance: { tooltip: 'Measure distance on the X/Y plane only, as a 2D camera stands off the plane it shows.' },
  },
});

/** An impulse set off and not yet died away everywhere. */
interface ActiveImpulse {
  origin: Vec3;
  def: CameraImpulseSourceData;
  force: number;
  /** Engine seconds when it was first drawn; -1 until then (a game system does not know the render clock). */
  start: number;
  seed: number;
}

const active = new WeakMap<World, ActiveImpulse[]>();
let seq = 0;

/**
 * Sets off an impulse from `source` (an entity with a CameraImpulseSource), where it is now, at `force` times its
 * strength. Each listening camera feels it by its distance. Returns false when the entity has no source.
 */
export function fireImpulse(world: World, source: Entity, force = 1): boolean {
  if (!world.valid(source) || !world.has(source, CameraImpulseSource) || !world.has(source, Transform)) return false;
  const def = { ...world.get(source, CameraImpulseSource) };
  const p = world.get(source, Transform).worldPosition;
  let list = active.get(world);
  if (!list) active.set(world, (list = []));
  list.push({ origin: { x: p.x, y: p.y, z: p.z }, def, force, start: -1, seed: 977 + seq++ });
  return true;
}

/** Fires every source whose `fire` flag is set, and clears it (the rig's update, in play). */
export function impulseSourceUpdate(world: World): void {
  for (const e of world.getEntitiesWithComponents([CameraImpulseSource, Transform])) {
    const src = world.get(e, CameraImpulseSource);
    if (!src.fire) continue;
    fireImpulse(world, e);
    world.set(e, CameraImpulseSource, { ...src, fire: false });
  }
}

/** Strength over time: up through the attack, held, then down through the decay; 0 before and after. */
export function impulseEnvelope(t: number, attack: number, sustain: number, decay: number): number {
  if (t < 0) return 0;
  if (t < attack) return attack > 0 ? t / attack : 1;
  if (t < attack + sustain) return 1;
  const d = t - attack - sustain;
  if (d >= decay) return 0;
  const k = 1 - d / decay;
  return k * k;
}

/** Strength over distance: whole within the radius, fading smoothly to nothing across the dissipation beyond it. */
export function impulseAttenuation(distance: number, radius: number, dissipation: number): number {
  if (distance <= radius) return 1;
  if (dissipation <= 0) return 0;
  const x = (distance - radius) / dissipation;
  if (x >= 1) return 0;
  const s = 1 - x;
  return s * s * (3 - 2 * s);
}

/**
 * `pov` as an impulse (fired from `origin` with `def` at `force`, its noise `seed`) jolts it `elapsed` seconds after it
 * was fired, for a camera that listens as `listener` says: by its channels and gain, its distance from the origin, and
 * the time the impulse takes to get there. Worked out at once, so the runtime and a scrubbing preview (the
 * Sequencer's) show the same jolt for the same time.
 */
export function impulsedPOV(
  pov: CameraPOV,
  impulse: { origin: Vec3; def: CameraImpulseSourceData; force: number; seed: number },
  listener: CameraImpulseListenerData,
  elapsed: number,
): CameraPOV {
  const d = impulse.def;
  if ((d.channels & listener.channels) === 0 || !(listener.gain > 0)) return pov;
  const dx = pov.x - impulse.origin.x, dy = pov.y - impulse.origin.y, dz = listener.use2DDistance ? 0 : pov.z - impulse.origin.z;
  const distance = Math.hypot(dx, dy, dz);
  const delay = d.propagationSpeed > 0 ? distance / d.propagationSpeed : 0;
  const t = elapsed - delay;
  const strength = impulse.force * listener.gain * impulseEnvelope(t, d.attack, d.sustain, d.decay)
    * impulseAttenuation(distance, d.radius, d.dissipation);
  if (!(strength > 0)) return pov;
  return noisyPOV(pov, { amplitude: d.amplitude * strength, rotation: d.rotation * strength, frequency: d.frequency, seed: impulse.seed }, impulse.seed, t);
}

/**
 * Jolts each listening camera's drawn view by the impulses it feels at time `now`, and forgets impulses that have died
 * away everywhere. Run beside the noise, on the per-camera views before the director blends them.
 */
export function applyCameraImpulses(world: World, povs: CameraPOV[], now: number): void {
  const list = active.get(world);
  if (!list || list.length === 0) return;
  for (const imp of list) if (imp.start < 0) imp.start = now;
  for (let i = 0; i < povs.length; i++) {
    const pov = povs[i]!;
    if (pov.entity <= 0 || !world.valid(pov.entity as never)) continue;
    const listener = world.tryGet(pov.entity as never, CameraImpulseListener) as CameraImpulseListenerData | null;
    if (!listener || !(listener.gain > 0)) continue;
    let view = pov;
    for (const imp of list) view = impulsedPOV(view, imp, listener, now - imp.start);
    povs[i] = view;
  }
  // Gone once it has died away at the farthest place it reaches.
  const alive = list.filter((imp) => {
    const d = imp.def;
    const reach = d.propagationSpeed > 0 ? (d.radius + d.dissipation) / d.propagationSpeed : 0;
    return now - imp.start <= d.attack + d.sustain + d.decay + reach;
  });
  if (alive.length !== list.length) active.set(world, alive);
}
