// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraDirector.ts
 * @brief   The camera director — picks the active view target among the scene's
 *          cameras and BLENDS smoothly between targets over time, the way UE's
 *          APlayerCameraManager (SetViewTargetWithBlend) and Unity Cinemachine's
 *          Brain do. It resolves ONE main point-of-view per frame (the previous
 *          target's POV lerped toward the new target's), which the camera plugin
 *          builds into the rendered view. Cameras stay declarative view defs; the
 *          director is the runtime that selects + transitions between them.
 */
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { applyEasing, EasingType } from '../animation/Easing';
import type { CameraPOV } from './CameraPlugin';

/** Easing for a view-target transition. */
export const BlendCurve = {
  Linear: 0,
  EaseIn: 1,
  EaseOut: 2,
  EaseInOut: 3,
} as const;
export type BlendCurve = (typeof BlendCurve)[keyof typeof BlendCurve];

export function applyCurve(curve: number, t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  // BlendCurve 0..3 aligns with Easing's Linear/EaseInQuad/EaseOutQuad/EaseInOutQuad
  // (identical formulas) — delegate so the easing math lives in one place.
  return applyEasing(curve as EasingType, x);
}

/** Signed shortest angular delta a→b (radians), so a blend never spins the long way. */
function shortAngle(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

type Quat = { x: number; y: number; z: number; w: number };

/** The orientation a POV is drawn with: its tilt, or a turn about Z by its 2D rotation (CameraPlugin's view). */
function povQuat(p: CameraPOV): Quat {
  return p.tilt ?? { x: 0, y: 0, z: Math.sin(p.rotation / 2), w: Math.cos(p.rotation / 2) };
}

/** Spherical interpolation the short way round: q and -q are one orientation, and the other way is the long turn. */
function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  let wa: number;
  let wb: number;
  if (dot > 0.9995) {
    // Nearly the same: a straight line, normalised below, is what a sine of a vanishing angle would divide by zero for.
    wa = 1 - t;
    wb = t * sign;
  } else {
    const angle = Math.acos(dot);
    const s = Math.sin(angle);
    wa = Math.sin((1 - t) * angle) / s;
    wb = (Math.sin(t * angle) / s) * sign;
  }
  const q = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb, w: a.w * wa + b.w * wb };
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** `q` turned further by `r`, about the axis `r` names in `q`'s own frame. */
function mulQuat(q: Quat, r: Quat): Quat {
  return {
    x: q.w * r.x + q.x * r.w + q.y * r.z - q.z * r.y,
    y: q.w * r.y - q.x * r.z + q.y * r.w + q.z * r.x,
    z: q.w * r.z + q.x * r.y - q.y * r.x + q.z * r.w,
    w: q.w * r.w - q.x * r.x - q.y * r.y - q.z * r.z,
  };
}

/** The vector (x, y, z) of `q`'s own frame, in the world. */
function rotateVec(q: Quat, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * Interpolate two POVs. Continuous fields lerp; discrete ones snap to the target.
 *
 * A camera turned off the 2D plane is drawn from its `tilt`, not its Z angle, so a blend where either end has one
 * carries a tilt the whole way: the slerp of the two orientations. Without it every frame of the blend was drawn
 * looking straight down -Z, and the view jumped back to the target's turn when the blend ended. An `orbit` (the editor
 * view's) blends when both ends have one, and is the target's from the midpoint otherwise, as a projection is.
 */
export function lerpPOV(a: CameraPOV, b: CameraPOV, t: number): CameraPOV {
  const l = (x: number, y: number) => x + (y - x) * t;
  const tilt = a.tilt || b.tilt ? slerp(povQuat(a), povQuat(b), t) : undefined;
  const orbit = a.orbit && b.orbit
    ? {
        yaw: a.orbit.yaw + shortAngle(a.orbit.yaw, b.orbit.yaw) * t,
        pitch: l(a.orbit.pitch, b.orbit.pitch),
        focusZ: l(a.orbit.focusZ, b.orbit.focusZ),
      }
    : t < 0.5 ? a.orbit : b.orbit;
  return {
    ...(tilt ? { tilt } : {}),
    ...(orbit ? { orbit } : {}),
    entity: b.entity,
    isActive: b.isActive,
    x: l(a.x, b.x),
    y: l(a.y, b.y),
    z: l(a.z, b.z),
    rotation: a.rotation + shortAngle(a.rotation, b.rotation) * t,
    projection: t < 0.5 ? a.projection : b.projection, // discrete: flip at the midpoint
    orthoSize: l(a.orthoSize, b.orthoSize),
    fov: l(a.fov, b.fov),
    near: l(a.near, b.near),
    far: l(a.far, b.far),
    viewport: b.viewport,
    clearFlags: b.clearFlags,
    priority: b.priority,
    pixelPerfect: t < 0.5 ? a.pixelPerfect : b.pixelPerfect, // discrete: flip at the midpoint
    cullingMask: b.cullingMask, // discrete: the target camera decides what it shows
    renderTarget: b.renderTarget, // discrete: a blend cannot be half in a texture
  };
}

function clonePOV(p: CameraPOV): CameraPOV {
  return { ...p, viewport: { ...p.viewport } };
}

/** A transient camera shake — a decaying view-space perturbation (UE modifier). */
export interface ActiveShake {
  amplitude: number; // positional, world units
  rotation: number; // rotational, radians
  frequency: number; // Hz
  duration: number; // seconds
  startTime: number; // seconds; -1 until first applied
  seed: number; // decorrelates concurrent shakes
}

export interface CameraDirectorState {
  /** Committed view-target entity, or -1 → fall back to the active/priority camera. */
  target: number;
  // Pending setViewTarget request, applied on the next resolve.
  hasPending: boolean;
  pendingTarget: number;
  pendingTime: number; // seconds
  pendingCurve: number;
  // Active blend.
  blending: boolean;
  from: CameraPOV | null;
  startTime: number; // seconds (engine elapsed clock)
  duration: number; // seconds
  curve: number;
  /** Last resolved main POV — also the snapshot source when a new blend starts. */
  currentMain: CameraPOV | null;
  /** Active transient shakes (applied to the rendered POV, never to the Transform). */
  shakes: ActiveShake[];
  shakeSeq: number;
  /**
   * The view a playing timeline's camera track asks for, set every step it has one. While present it
   * is the view and `setViewTarget` waits; when the track has nothing to say the scene's own camera is
   * the view again.
   */
  timelineShot: TimelineShot | null;
  /** The timeline player that set `timelineShot`, so only it can take it back. */
  timelineOwner: number;
  /**
   * The blend a change of the live camera gets when nothing asked for it: a higher priority, a camera turned on or off,
   * isActive moved. Seconds; 0 cuts, which is what a scene without a CameraBrain does. Set from the scene's CameraBrain
   * each frame (CameraRig.ts), as Cinemachine's Brain holds its Default Blend.
   */
  defaultBlend: number;
  defaultCurve: number;
  /** The camera the last resolve settled on, to see the live camera change between two of them. -1 before the first. */
  lastLive: number;
  /** The camera the blend under way leaves, or -1 when it left a view no one camera had (a blend cut into mid-way). */
  blendFrom: number;
  /** The cameras the last advancing resolve chose among, and when it ran: what {@link cameraDirectorReport} reads. */
  candidates: readonly CameraPOV[];
  lastNow: number;
  /**
   * When each candidate became one, as a count: of two live-worthy cameras of one priority, the one activated last wins,
   * as Cinemachine's Brain decides. Cameras there from the first frame share one count, so a scene as loaded keeps the
   * first of them.
   */
  activation: Map<number, number>;
  activationSeq: number;
  /**
   * Blends for particular changes of camera, from the scene's CameraBrain (CameraRig.ts): from one camera to another,
   * by entity, -1 for any. The first that names both ends wins, then one naming the camera blended to, then the one
   * blended from; otherwise the default blend.
   */
  customBlends: CustomBlend[];
}

/** A blend the brain gives one change of camera: `from` and `to` are entities, -1 any. */
export interface CustomBlend {
  from: number;
  to: number;
  time: number;
  curve: number;
}

/** A shot between two cameras, `weight` of the way from `from` (or none) to `to`. */
export interface TimelineShot {
  from: number | null;
  to: number;
  weight: number;
  curve: number;
}

export const DEFAULT_DIRECTOR: CameraDirectorState = {
  target: -1,
  hasPending: false,
  pendingTarget: -1,
  pendingTime: 0,
  pendingCurve: BlendCurve.EaseInOut,
  blending: false,
  from: null,
  startTime: 0,
  duration: 0,
  curve: BlendCurve.EaseInOut,
  currentMain: null,
  shakes: [],
  shakeSeq: 0,
  timelineShot: null,
  timelineOwner: -1,
  defaultBlend: 0,
  defaultCurve: BlendCurve.EaseInOut,
  lastLive: -1,
  blendFrom: -1,
  candidates: [],
  lastNow: 0,
  activation: new Map(),
  activationSeq: 0,
  customBlends: [],
};

/** A fresh director state (own arrays) — use per App, not the shared default. */
export function createDirectorState(): CameraDirectorState {
  return { ...DEFAULT_DIRECTOR, from: null, currentMain: null, shakes: [], candidates: [], activation: new Map(), customBlends: [] };
}

export const CameraDirector = defineResource<CameraDirectorState>(
  createDirectorState(),
  'CameraDirector',
);

/**
 * Where director commands land: the App (host code) or the CameraDirector
 * resource state itself (systems — `Res(CameraDirector)`).
 */
export type CameraDirectorHost = App | CameraDirectorState;

function directorOf(host: CameraDirectorHost): CameraDirectorState {
  return typeof (host as App).getResource === 'function'
    ? (host as App).getResource(CameraDirector)
    : (host as CameraDirectorState);
}

/**
 * Switch the active view target, optionally blending over `time` seconds with an
 * easing `curve`. Records intent; the director applies it on the next frame
 * (snapshotting the current view as the blend start). `time<=0` (or no prior
 * view) is an instant cut. Pass the App from host code, or the
 * `Res(CameraDirector)` state from inside a system.
 */
export function setViewTarget(
  host: CameraDirectorHost,
  entity: number,
  opts?: { time?: number; curve?: number },
): void {
  const dir = directorOf(host);
  dir.hasPending = true;
  dir.pendingTarget = entity;
  dir.pendingTime = opts?.time ?? 0;
  dir.pendingCurve = opts?.curve ?? BlendCurve.EaseInOut;
}

/**
 * A playing timeline's camera track says which camera is the view (and, across an overlap, how far one is
 * blended into the next). Pass `null` to give the view back: only the player that set a shot can clear it.
 */
export function setTimelineShot(host: CameraDirectorHost, owner: number, shot: TimelineShot | null): void {
  const dir = directorOf(host);
  if (shot) {
    dir.timelineShot = shot;
    dir.timelineOwner = owner;
  } else if (dir.timelineOwner === owner) {
    dir.timelineShot = null;
    dir.timelineOwner = -1;
  }
}

/**
 * Trigger a transient camera shake on the active view — a decaying perturbation
 * applied to the rendered POV only (never to a camera's Transform, so it always
 * recovers and never dirties the scene). The UE `StartCameraShake` analog.
 * Pass the App from host code, or the `Res(CameraDirector)` state from a system.
 */
export function shakeCamera(
  host: CameraDirectorHost,
  opts?: { amplitude?: number; rotation?: number; frequency?: number; duration?: number },
): void {
  const dir = directorOf(host);
  dir.shakes.push({
    amplitude: opts?.amplitude ?? 12,
    rotation: opts?.rotation ?? 0,
    frequency: opts?.frequency ?? 22,
    duration: opts?.duration ?? 0.4,
    startTime: -1,
    seed: dir.shakeSeq++,
  });
}

// Deterministic smooth pseudo-noise in ~[-1, 1] (two decorrelated sines).
const shakeNoise = (t: number, seed: number): number =>
  Math.sin(t + seed * 1.3) * 0.6 + Math.sin(t * 1.7 + seed * 2.9) * 0.4;

/**
 * Apply + age the active shakes, returning the POV offset for rendering. Drops
 * expired shakes. Mutates the shake list, so it runs only on the advancing
 * (render) resolve — the peek resolve leaves the view un-shaken (so screen<->world
 * doesn't jitter while the camera shakes).
 */
function applyShakes(dir: CameraDirectorState, pov: CameraPOV, now: number): CameraPOV {
  if (dir.shakes.length === 0) return pov;
  let ox = 0;
  let oy = 0;
  let orot = 0;
  const alive: ActiveShake[] = [];
  for (const s of dir.shakes) {
    if (s.startTime < 0) s.startTime = now;
    const e = now - s.startTime;
    if (e >= s.duration || s.duration <= 0) continue; // expired → dropped
    const decay = 1 - e / s.duration;
    const phase = 2 * Math.PI * s.frequency * e;
    ox += s.amplitude * decay * shakeNoise(phase, s.seed);
    oy += s.amplitude * decay * shakeNoise(phase, s.seed + 11);
    orot += s.rotation * decay * shakeNoise(phase, s.seed + 23);
    alive.push(s);
  }
  dir.shakes = alive;
  if (ox === 0 && oy === 0 && orot === 0) return pov;
  if (!pov.tilt) return { ...pov, x: pov.x + ox, y: pov.y + oy, rotation: pov.rotation + orot };
  // A turned camera shakes in its own frame: across its screen, and rolled about where it looks. In world x and y a
  // camera looking along x would move toward what it sees and show no shake, and a 3D view never reads the Z angle.
  const right = rotateVec(pov.tilt, 1, 0, 0);
  const up = rotateVec(pov.tilt, 0, 1, 0);
  const roll = mulQuat(pov.tilt, { x: 0, y: 0, z: Math.sin(orot / 2), w: Math.cos(orot / 2) });
  return {
    ...pov,
    x: pov.x + right.x * ox + up.x * oy,
    y: pov.y + right.y * ox + up.y * oy,
    z: pov.z + right.z * ox + up.z * oy,
    rotation: pov.rotation + orot,
    tilt: roll,
  };
}

/**
 * The live camera by policy: the highest priority among the active cameras, as Cinemachine picks among enabled virtual
 * cameras; among all of them when none is active. The engine hands over only active cameras, so taking the first active
 * one, as this did, let priority choose nothing. A tie goes to the camera activated last (`activation`), then the first.
 */
function pickActive(candidates: CameraPOV[], activation?: ReadonlyMap<number, number>): CameraPOV {
  const anyActive = candidates.some((c) => c.isActive);
  const when = (c: CameraPOV) => activation?.get(c.entity) ?? 0;
  let best: CameraPOV | null = null;
  for (const c of candidates) {
    if (anyActive && !c.isActive) continue;
    if (!best || c.priority > best.priority || (c.priority === best.priority && when(c) > when(best))) best = c;
  }
  return best ?? candidates[0];
}

/**
 * Counts each camera that has become a candidate since the last frame: one that was not among them, or was there
 * switched off. Cameras gone are forgotten, so one that comes back counts as activated anew. The first frame counts
 * every camera at once.
 */
function noteActivations(dir: CameraDirectorState, candidates: readonly CameraPOV[]): void {
  const first = dir.activation.size === 0 && dir.lastLive < 0;
  const seen = new Set<number>();
  let fresh = false;
  for (const c of candidates) {
    if (!c.isActive) continue;
    seen.add(c.entity);
    if (!dir.activation.has(c.entity)) {
      if (!fresh && !first) dir.activationSeq++;
      fresh = true;
      dir.activation.set(c.entity, first ? 0 : dir.activationSeq);
    }
  }
  for (const e of [...dir.activation.keys()]) if (!seen.has(e)) dir.activation.delete(e);
}

/** The blend the brain gives a change of camera from `from` to `to`: its custom one, else its default. */
export function blendFor(dir: CameraDirectorState, from: number, to: number): { time: number; curve: number } {
  const both = dir.customBlends.find((b) => b.from === from && b.to === to)
    ?? dir.customBlends.find((b) => b.from < 0 && b.to === to)
    ?? dir.customBlends.find((b) => b.from === from && b.to < 0);
  return both ? { time: both.time, curve: both.curve } : { time: dir.defaultBlend, curve: dir.defaultCurve };
}

/**
 * Resolve the main POV for this frame from the full-frame camera candidates.
 * `advance` runs the state machine (consume a pending target, tick the blend);
 * pass false to just peek the last resolved POV (so a second consumer per frame
 * — the early UICameraInfo sync — doesn't double-advance the blend).
 */
export function resolveMainPOV(
  dir: CameraDirectorState,
  candidates: CameraPOV[],
  now: number,
  advance: boolean,
): CameraPOV | null {
  if (candidates.length === 0) {
    if (advance) {
      dir.currentMain = null;
      dir.candidates = [];
    }
    return null;
  }
  if (!advance) {
    return dir.currentMain ?? pickActive(candidates, dir.activation);
  }
  dir.candidates = candidates;
  dir.lastNow = now;
  noteActivations(dir, candidates);

  // Apply a pending setViewTarget — snapshot the current view as the blend start.
  const asked = dir.hasPending;
  if (dir.hasPending) {
    dir.hasPending = false;
    if (dir.pendingTime > 0 && dir.currentMain) {
      dir.blendFrom = dir.blending ? -1 : dir.lastLive;
      dir.from = clonePOV(dir.currentMain);
      dir.blending = true;
      dir.startTime = now;
      dir.duration = dir.pendingTime;
      dir.curve = dir.pendingCurve;
    } else {
      dir.blending = false;
      dir.from = null;
    }
    dir.target = dir.pendingTarget;
  }

  const shot = dir.timelineShot;
  const shotTo = shot ? candidates.find((c) => c.entity === shot.to) : undefined;
  if (shot && shotTo) {
    const shotFrom = shot.from === null ? undefined : candidates.find((c) => c.entity === shot.from);
    const cut = shotFrom ? lerpPOV(shotFrom, shotTo, applyCurve(shot.curve, shot.weight)) : shotTo;
    dir.blending = false;
    dir.from = null;
    dir.currentMain = cut;
    return applyShakes(dir, cut, now);
  }

  const targetPOV =
    (dir.target >= 0 ? candidates.find((c) => c.entity === dir.target) : undefined) ??
    pickActive(candidates, dir.activation);

  // The live camera changed with nothing asking: blend into it as the brain says for this change (its custom blend, else
  // its default), from wherever the view is now (a blend under way included, so a second change mid-blend does not jump).
  const blend = !asked && dir.lastLive >= 0 && targetPOV.entity !== dir.lastLive ? blendFor(dir, dir.lastLive, targetPOV.entity) : null;
  if (blend && blend.time > 0 && dir.currentMain) {
    dir.blendFrom = dir.blending ? -1 : dir.lastLive;
    dir.from = clonePOV(dir.currentMain);
    dir.blending = true;
    dir.startTime = now;
    dir.duration = blend.time;
    dir.curve = blend.curve;
  } else if (blend) {
    // A cut: a blend under way into the camera left behind ends here too.
    dir.blending = false;
    dir.from = null;
  }
  dir.lastLive = targetPOV.entity;

  let main: CameraPOV;
  if (dir.blending && dir.from) {
    const elapsed = now - dir.startTime;
    if (dir.duration <= 0 || elapsed >= dir.duration) {
      dir.blending = false;
      dir.from = null;
      main = targetPOV;
    } else {
      main = lerpPOV(dir.from, targetPOV, applyCurve(dir.curve, elapsed / dir.duration));
    }
  } else {
    main = targetPOV;
  }

  // currentMain stays the pre-shake view (blend snapshot + screen<->world use it);
  // shake is a render-only transient offset on top.
  dir.currentMain = main;
  return applyShakes(dir, main, now);
}

/** One camera the director chose among, as {@link cameraDirectorReport} lists it. */
export interface CameraCandidateReport {
  entity: number;
  priority: number;
  active: boolean;
}

/**
 * What the director is doing, as of its last frame: the live camera, the blend under way, and the cameras it chose
 * among. Cinemachine's Brain shows the same in its inspector (Live Camera, Live Blend); the editor shows it on the
 * Outliner's camera rows and on the game view while playing.
 */
export interface CameraDirectorReport {
  /** The camera the view is, or blends into; null with no camera. */
  live: number | null;
  /** The blend under way: from which camera (null when it left a blend part-way), and how far, 0 to 1. */
  blend: { from: number | null; to: number; progress: number; duration: number } | null;
  /** True while a timeline's camera track holds the view. */
  timeline: boolean;
  cameras: CameraCandidateReport[];
}

/** The director's state as a plain report, for an inspector or a test. */
export function cameraDirectorReport(host: CameraDirectorHost): CameraDirectorReport {
  const dir = directorOf(host);
  const cameras = dir.candidates.map((c) => ({ entity: c.entity, priority: c.priority, active: c.isActive }));
  const live = dir.currentMain ? dir.currentMain.entity : null;
  const shot = dir.timelineShot;
  if (shot && cameras.some((c) => c.entity === shot.to)) {
    const blending = shot.from !== null && shot.weight < 1;
    return {
      live: shot.to,
      blend: blending ? { from: shot.from, to: shot.to, progress: shot.weight, duration: 0 } : null,
      timeline: true,
      cameras,
    };
  }
  const blend = dir.blending && dir.from && live !== null
    ? {
        from: dir.blendFrom >= 0 ? dir.blendFrom : null,
        to: live,
        progress: dir.duration > 0 ? Math.min(1, Math.max(0, (dir.lastNow - dir.startTime) / dir.duration)) : 1,
        duration: dir.duration,
      }
    : null;
  return { live, blend, timeline: false, cameras };
}
