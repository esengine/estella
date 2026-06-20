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
import type { App } from '../app';
import { defineResource } from '../resource';
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
  switch (curve) {
    case BlendCurve.EaseIn:
      return x * x;
    case BlendCurve.EaseOut:
      return 1 - (1 - x) * (1 - x);
    case BlendCurve.EaseInOut:
      return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) * (-2 * x + 2)) / 2;
    default:
      return x; // Linear
  }
}

/** Signed shortest angular delta a→b (radians), so a blend never spins the long way. */
function shortAngle(a: number, b: number): number {
  const TWO_PI = Math.PI * 2;
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Interpolate two POVs. Continuous fields lerp; discrete ones snap to the target. */
export function lerpPOV(a: CameraPOV, b: CameraPOV, t: number): CameraPOV {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
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
  };
}

function clonePOV(p: CameraPOV): CameraPOV {
  return { ...p, viewport: { ...p.viewport } };
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
};

export const CameraDirector = defineResource<CameraDirectorState>(
  { ...DEFAULT_DIRECTOR },
  'CameraDirector',
);

/**
 * Switch the active view target, optionally blending over `time` seconds with an
 * easing `curve`. Records intent; the director applies it on the next frame
 * (snapshotting the current view as the blend start). `time<=0` (or no prior
 * view) is an instant cut.
 */
export function setViewTarget(
  app: App,
  entity: number,
  opts?: { time?: number; curve?: number },
): void {
  const dir = app.getResource(CameraDirector);
  dir.hasPending = true;
  dir.pendingTarget = entity;
  dir.pendingTime = opts?.time ?? 0;
  dir.pendingCurve = opts?.curve ?? BlendCurve.EaseInOut;
}

/** The active camera by policy: isActive wins (authoritative), else highest priority. */
function pickActive(candidates: CameraPOV[]): CameraPOV {
  const active = candidates.find((c) => c.isActive);
  if (active) return active;
  let best = candidates[0];
  for (const c of candidates) if (c.priority > best.priority) best = c;
  return best;
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
    if (advance) dir.currentMain = null;
    return null;
  }
  if (!advance) {
    return dir.currentMain ?? pickActive(candidates);
  }

  // Apply a pending setViewTarget — snapshot the current view as the blend start.
  if (dir.hasPending) {
    dir.hasPending = false;
    if (dir.pendingTime > 0 && dir.currentMain) {
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

  const targetPOV =
    (dir.target >= 0 ? candidates.find((c) => c.entity === dir.target) : undefined) ??
    pickActive(candidates);

  if (dir.blending && dir.from) {
    const elapsed = now - dir.startTime;
    if (dir.duration <= 0 || elapsed >= dir.duration) {
      dir.blending = false;
      dir.from = null;
      dir.currentMain = targetPOV;
      return targetPOV;
    }
    const blended = lerpPOV(dir.from, targetPOV, applyCurve(dir.curve, elapsed / dir.duration));
    dir.currentMain = blended;
    return blended;
  }

  dir.currentMain = targetPOV;
  return targetPOV;
}
