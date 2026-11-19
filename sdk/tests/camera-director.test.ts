// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera director — view-target selection + blending state machine. Pure
 *        logic (inject `now`), so deterministic and WASM-free.
 */
import { describe, it, expect } from 'vitest';
import {
  applyCurve,
  lerpPOV,
  resolveMainPOV,
  BlendCurve,
  createDirectorState,
  shakeCamera,
  cameraDirectorReport,
  blendFor,
  CameraEventKind,
  type CameraDirectorState,
} from '../src/camera/CameraDirector';
import type { CameraPOV } from '../src/camera/CameraPlugin';
import { ProjectionType, ClearFlags } from '../src/ecs/component';

const mkPOV = (over: Partial<CameraPOV>): CameraPOV => ({
  entity: 0,
  isActive: false,
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  projection: ProjectionType.Orthographic,
  orthoSize: 100,
  fov: 0,
  near: 0,
  far: 1000,
  viewport: { x: 0, y: 0, z: 1, w: 1 },
  clearFlags: ClearFlags.ColorAndDepth,
  priority: 0,
  ...over,
});
const dir = (over?: Partial<CameraDirectorState>): CameraDirectorState => ({
  ...createDirectorState(),
  ...over,
});

describe('applyCurve', () => {
  it('eases and clamps', () => {
    expect(applyCurve(BlendCurve.Linear, 0.5)).toBeCloseTo(0.5);
    expect(applyCurve(BlendCurve.EaseIn, 0.5)).toBeCloseTo(0.25);
    expect(applyCurve(BlendCurve.EaseOut, 0.5)).toBeCloseTo(0.75);
    expect(applyCurve(BlendCurve.EaseInOut, 0.5)).toBeCloseTo(0.5);
    expect(applyCurve(BlendCurve.Linear, -1)).toBe(0);
    expect(applyCurve(BlendCurve.Linear, 2)).toBe(1);
  });
});

describe('lerpPOV', () => {
  it('lerps continuous fields, snaps discrete to the target', () => {
    const a = mkPOV({ x: 0, y: 0, orthoSize: 100 });
    const b = mkPOV({ entity: 7, x: 100, y: 50, orthoSize: 200, priority: 5 });
    const m = lerpPOV(a, b, 0.5);
    expect(m.x).toBeCloseTo(50);
    expect(m.y).toBeCloseTo(25);
    expect(m.orthoSize).toBeCloseTo(150);
    expect(m.entity).toBe(7);
    expect(m.priority).toBe(5);
  });

  it('rotates the short way (350° → 10° passes through 360°/0°, not back through 180°)', () => {
    const a = mkPOV({ rotation: (350 * Math.PI) / 180 });
    const b = mkPOV({ rotation: (10 * Math.PI) / 180 });
    const m = lerpPOV(a, b, 0.5);
    const deg = ((m.rotation * 180) / Math.PI) % 360;
    expect(Math.min(Math.abs(deg - 0), Math.abs(deg - 360))).toBeLessThan(1);
  });
});

describe('resolveMainPOV', () => {
  const A = mkPOV({ entity: 1, isActive: true, x: 0 });
  const B = mkPOV({ entity: 2, x: 100 });

  it('picks the isActive camera (authoritative over priority)', () => {
    const lowActive = mkPOV({ entity: 1, isActive: true, priority: 0 });
    const highInactive = mkPOV({ entity: 2, isActive: false, priority: 10 });
    expect(resolveMainPOV(dir(), [highInactive, lowActive], 0, true)?.entity).toBe(1);
  });

  it('picks the highest priority among active cameras, which is every camera the engine hands over', () => {
    // The engine's camera list holds only active cameras (registry_getCameraEntities), so "the first active one" was
    // whichever came first, and priority chose nothing.
    const first = mkPOV({ entity: 1, isActive: true, priority: 1 });
    const higher = mkPOV({ entity: 2, isActive: true, priority: 5 });
    expect(resolveMainPOV(dir(), [first, higher], 0, true)?.entity).toBe(2);
    expect(resolveMainPOV(dir(), [higher, first], 0, true)?.entity).toBe(2);
  });

  it('keeps the first of two active cameras of equal priority, whichever order they arrive in next', () => {
    const a = mkPOV({ entity: 1, isActive: true, priority: 3 });
    const b = mkPOV({ entity: 2, isActive: true, priority: 3 });
    expect(resolveMainPOV(dir(), [a, b], 0, true)?.entity).toBe(1);
  });

  it('falls back to highest priority when none is active', () => {
    const p0 = mkPOV({ entity: 1, priority: 0 });
    const p5 = mkPOV({ entity: 2, priority: 5 });
    expect(resolveMainPOV(dir(), [p0, p5], 0, true)?.entity).toBe(2);
  });

  it('blends from the current view to a new target over time', () => {
    const d = dir();
    expect(resolveMainPOV(d, [A, B], 0, true)?.entity).toBe(1); // A is current

    d.hasPending = true;
    d.pendingTarget = 2;
    d.pendingTime = 2;
    d.pendingCurve = BlendCurve.Linear;

    expect(resolveMainPOV(d, [A, B], 0, true)!.x).toBeCloseTo(0); // start = A
    expect(d.blending).toBe(true);
    expect(resolveMainPOV(d, [A, B], 1, true)!.x).toBeCloseTo(50); // midpoint
    const end = resolveMainPOV(d, [A, B], 2, true);
    expect(end!.x).toBeCloseTo(100); // end = B
    expect(end!.entity).toBe(2);
    expect(d.blending).toBe(false);
  });

  it('peek (advance=false) returns the current view without advancing', () => {
    const d = dir({ currentMain: A });
    d.hasPending = true;
    d.pendingTarget = 2;
    expect(resolveMainPOV(d, [A, B], 5, false)).toBe(A);
    expect(d.hasPending).toBe(true); // not consumed
  });

  it('shake offsets the rendered POV, decays, then expires (render path only)', () => {
    const d = dir();
    d.shakes.push({ amplitude: 50, rotation: 0, frequency: 10, duration: 1, startTime: -1, seed: 0 });
    resolveMainPOV(d, [A], 0, true); // first advance sets startTime (e=0 → ~no offset)
    const mid = resolveMainPOV(d, [A], 0.3, true);
    expect(Math.abs(mid!.x)).toBeGreaterThan(0); // shaken off-center
    expect(d.shakes.length).toBe(1);
    const after = resolveMainPOV(d, [A], 1.2, true); // past duration
    expect(after!.x).toBeCloseTo(0);
    expect(d.shakes.length).toBe(0); // expired + dropped
  });

  it('peek does not age or drop shakes', () => {
    const d = dir({ currentMain: A });
    d.shakes.push({ amplitude: 50, rotation: 0, frequency: 10, duration: 1, startTime: -1, seed: 0 });
    resolveMainPOV(d, [A], 0.3, false); // peek
    expect(d.shakes.length).toBe(1);
  });
});

describe('timeline shot override', () => {
  const A = mkPOV({ entity: 1, isActive: true, x: 0 });
  const B = mkPOV({ entity: 2, x: 100 });

  it('holds the shot camera over the active one, and blends across an overlap', () => {
    const d = dir();
    d.timelineShot = { from: null, to: 2, weight: 1, curve: BlendCurve.Linear };
    expect(resolveMainPOV(d, [A, B], 0, true)?.entity).toBe(2);
    d.timelineShot = { from: 1, to: 2, weight: 0.5, curve: BlendCurve.Linear };
    expect(resolveMainPOV(d, [A, B], 0, true)!.x).toBeCloseTo(50);
  });

  it('gives the view back to the scene camera once the shot is cleared', () => {
    const d = dir();
    d.timelineShot = { from: null, to: 2, weight: 1, curve: BlendCurve.Linear };
    resolveMainPOV(d, [A, B], 0, true);
    d.timelineShot = null;
    expect(resolveMainPOV(d, [A, B], 1, true)?.entity).toBe(1);
  });

  it('falls back to normal selection when the shot camera is gone', () => {
    const d = dir();
    d.timelineShot = { from: null, to: 9, weight: 1, curve: BlendCurve.Linear };
    expect(resolveMainPOV(d, [A, B], 0, true)?.entity).toBe(1);
  });
});

/** A turn of `degrees` about world up (+Y), as the camera Transform's quaternion. */
const yawQuat = (degrees: number) => {
  const h = (degrees * Math.PI) / 360;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
};
/** Where a camera with orientation `q` looks: its local -Z in the world. */
const forward = (q: { x: number; y: number; z: number; w: number }) => ({
  x: -(2 * (q.x * q.z + q.w * q.y)),
  y: -(2 * (q.y * q.z - q.w * q.x)),
  z: -(1 - 2 * (q.x * q.x + q.y * q.y)),
});
/** The orientation a POV is drawn with: its tilt, or a turn about Z by its rotation. */
const drawnQuat = (p: CameraPOV) =>
  p.tilt ?? { x: 0, y: 0, z: Math.sin(p.rotation / 2), w: Math.cos(p.rotation / 2) };

describe('blending 3D cameras', () => {
  const persp = { projection: ProjectionType.Perspective, fov: 60, near: 1, far: 5000 };
  const A = mkPOV({ ...persp, entity: 1, tilt: yawQuat(0) as CameraPOV['tilt'] });
  const B = mkPOV({ ...persp, entity: 2, tilt: yawQuat(90) as CameraPOV['tilt'] });

  it('turns the view halfway at the middle of the blend, instead of facing -Z for the whole of it', () => {
    const f = forward(drawnQuat(lerpPOV(A, B, 0.5)));
    // Halfway between looking down -Z and looking down -X: 45 degrees, on the ground plane.
    expect(f.x).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(f.y).toBeCloseTo(0, 5);
    expect(f.z).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('ends exactly on each camera, and keeps a unit orientation all the way', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const q = drawnQuat(lerpPOV(A, B, t));
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    }
    expect(forward(drawnQuat(lerpPOV(A, B, 1))).x).toBeCloseTo(-1, 6);
    expect(forward(drawnQuat(lerpPOV(A, B, 0))).z).toBeCloseTo(-1, 6);
  });

  it('turns the short way round, as the 2D roll does', () => {
    const near = mkPOV({ ...persp, entity: 3, tilt: yawQuat(170) as CameraPOV['tilt'] });
    const far = mkPOV({ ...persp, entity: 4, tilt: yawQuat(-170) as CameraPOV['tilt'] });
    const f = forward(drawnQuat(lerpPOV(near, far, 0.5)));
    // 170 and -170 are twenty degrees apart through 180, where the camera looks down +Z.
    expect(f.z).toBeCloseTo(1, 5);
  });

  it('blends from a camera that only rolls into one that is turned', () => {
    const flat = mkPOV({ ...persp, entity: 5 });
    const q = drawnQuat(lerpPOV(flat, B, 0.5));
    expect(forward(q).x).toBeCloseTo(-Math.SQRT1_2, 5);
  });

  it('carries the turn through the director while a setViewTarget blend runs', () => {
    const d = dir({ target: 1, currentMain: A });
    d.hasPending = true;
    d.pendingTarget = 2;
    d.pendingTime = 1;
    d.pendingCurve = BlendCurve.Linear;
    resolveMainPOV(d, [A, B], 0, true);
    const mid = resolveMainPOV(d, [A, B], 0.5, true)!;
    expect(mid.tilt).toBeDefined();
    expect(forward(drawnQuat(mid)).x).toBeCloseTo(-Math.SQRT1_2, 5);
  });
});

describe('shaking a 3D camera', () => {
  const persp = { projection: ProjectionType.Perspective, fov: 60, near: 1, far: 5000 };
  // Looking down -X: its screen's right is world -Z, its screen's up is world +Y.
  const side = mkPOV({ ...persp, entity: 1, isActive: true, tilt: yawQuat(90) as CameraPOV['tilt'] });

  it('moves the eye across the screen, not along the view where it shows nothing', () => {
    const d = dir();
    shakeCamera({ getResource: () => d } as never, { amplitude: 10, rotation: 0.2, duration: 1 });
    resolveMainPOV(d, [side], 0, true);
    const shaken = resolveMainPOV(d, [side], 0.13, true)!;
    // Along the view (world X) it stands still; across it (world Z and Y) it moves.
    expect(shaken.x).toBeCloseTo(side.x, 6);
    expect(Math.abs(shaken.z - side.z) + Math.abs(shaken.y - side.y)).toBeGreaterThan(1);
  });

  it('rolls a 3D view about where it looks', () => {
    const d = dir();
    shakeCamera({ getResource: () => d } as never, { amplitude: 0, rotation: 0.2, duration: 1 });
    resolveMainPOV(d, [side], 0, true);
    const shaken = resolveMainPOV(d, [side], 0.13, true)!;
    const q = drawnQuat(shaken);
    // Still looking down -X, but turned about that axis: the orientation is not the one it started with.
    expect(forward(q).x).toBeCloseTo(-1, 5);
    expect(Math.abs(q.x - side.tilt!.x) + Math.abs(q.z - side.tilt!.z)).toBeGreaterThan(1e-3);
  });
});

describe('cameraDirectorReport', () => {
  const A = mkPOV({ entity: 1, isActive: true, priority: 1, x: 0 });
  const B = mkPOV({ entity: 2, isActive: true, priority: 0, x: 100 });

  it('names the live camera and the cameras it was chosen among', () => {
    const d = dir();
    resolveMainPOV(d, [A, B], 0, true);
    const r = cameraDirectorReport(d);
    expect(r.live).toBe(1);
    expect(r.blend).toBeNull();
    expect(r.cameras).toEqual([{ entity: 1, priority: 1, active: true }, { entity: 2, priority: 0, active: true }]);
  });

  it('reports a default blend from the camera it left, and how far it has got', () => {
    const d = dir({ defaultBlend: 2, defaultCurve: BlendCurve.Linear });
    resolveMainPOV(d, [A, B], 0, true);
    const raised = { ...B, priority: 5 };
    resolveMainPOV(d, [A, raised], 1, true);
    resolveMainPOV(d, [A, raised], 1.5, true);
    expect(cameraDirectorReport(d).blend).toEqual({ from: 1, to: 2, progress: 0.25, duration: 2 });
    resolveMainPOV(d, [A, raised], 3, true);
    expect(cameraDirectorReport(d)).toMatchObject({ live: 2, blend: null });
  });

  it('says a blend that left another blend part-way came from no one camera', () => {
    const C = mkPOV({ entity: 3, isActive: true, priority: 0 });
    const d = dir({ defaultBlend: 2 });
    resolveMainPOV(d, [A, B, C], 0, true);
    resolveMainPOV(d, [A, { ...B, priority: 5 }, C], 1, true);
    resolveMainPOV(d, [A, { ...B, priority: 5 }, { ...C, priority: 9 }], 1.5, true);
    expect(cameraDirectorReport(d).blend).toMatchObject({ from: null, to: 3 });
  });

  it('is empty with no camera', () => {
    const d = dir();
    resolveMainPOV(d, [], 0, true);
    expect(cameraDirectorReport(d)).toEqual({ live: null, blend: null, timeline: false, cameras: [] });
  });
});

describe('equal priority: the camera activated last', () => {
  const A = mkPOV({ entity: 1, isActive: true, priority: 3, x: 0 });
  const B = mkPOV({ entity: 2, isActive: true, priority: 3, x: 100 });

  it('keeps the first of cameras there from the start, and goes to one switched on later', () => {
    const d = dir();
    expect(resolveMainPOV(d, [A, B], 0, true)?.entity).toBe(1);
    // B switched off, then on again: activated last, so it wins the tie.
    expect(resolveMainPOV(d, [A], 1, true)?.entity).toBe(1);
    expect(resolveMainPOV(d, [A, B], 2, true)?.entity).toBe(2);
    // And A, switched off and on after it, takes it back.
    resolveMainPOV(d, [B], 3, true);
    expect(resolveMainPOV(d, [A, B], 4, true)?.entity).toBe(1);
  });

  it('still lets a higher priority win over a camera activated later', () => {
    const d = dir();
    resolveMainPOV(d, [{ ...A, priority: 5 }], 0, true);
    expect(resolveMainPOV(d, [{ ...A, priority: 5 }, B], 1, true)?.entity).toBe(1);
  });
});

describe('custom blends', () => {
  const A = mkPOV({ entity: 1, isActive: true, priority: 1, x: 0 });
  const B = mkPOV({ entity: 2, isActive: true, priority: 0, x: 100 });
  const C = mkPOV({ entity: 3, isActive: true, priority: 0, x: 200 });

  it('picks the blend naming both ends, then the one naming where it goes, then where it leaves, then the default', () => {
    const d = dir({
      defaultBlend: 1, defaultCurve: BlendCurve.EaseInOut,
      customBlends: [
        { from: 1, to: -1, time: 3, curve: BlendCurve.Linear },
        { from: -1, to: 2, time: 2, curve: BlendCurve.EaseIn },
        { from: 1, to: 2, time: 0.5, curve: BlendCurve.EaseOut },
      ],
    });
    expect(blendFor(d, 1, 2)).toEqual({ time: 0.5, curve: BlendCurve.EaseOut });
    expect(blendFor(d, 3, 2)).toEqual({ time: 2, curve: BlendCurve.EaseIn });
    expect(blendFor(d, 1, 3)).toEqual({ time: 3, curve: BlendCurve.Linear });
    expect(blendFor(d, 3, 1)).toEqual({ time: 1, curve: BlendCurve.EaseInOut });
  });

  it('blends a change of live camera by its custom blend, and cuts where that says 0', () => {
    const d = dir({ defaultBlend: 1, customBlends: [{ from: 1, to: 2, time: 4, curve: BlendCurve.Linear }, { from: 2, to: 3, time: 0, curve: 0 }] });
    resolveMainPOV(d, [A, B, C], 0, true);
    resolveMainPOV(d, [A, { ...B, priority: 5 }, C], 1, true);
    expect(d.duration).toBe(4);
    expect(resolveMainPOV(d, [A, { ...B, priority: 5 }, C], 2, true)!.x).toBeCloseTo(25, 6);
    // Into C mid-blend with a cut: the view is C's at once.
    const cut = resolveMainPOV(d, [A, { ...B, priority: 5 }, { ...C, priority: 9 }], 2.5, true)!;
    expect(cut.x).toBe(200);
    expect(d.blending).toBe(false);
  });
});

describe('camera events', () => {
  const A = mkPOV({ entity: 1, isActive: true, priority: 1, x: 0 });
  const B = mkPOV({ entity: 2, isActive: true, priority: 0, x: 100 });

  it('tells of the first live camera, of a cut, and of nothing while the view stays', () => {
    const d = dir();
    resolveMainPOV(d, [A, B], 0, true);
    expect(d.pendingEvents).toEqual([{ kind: CameraEventKind.Activated, camera: 1, previous: 0, blendTime: 0 }]);
    d.pendingEvents.length = 0;
    resolveMainPOV(d, [A, B], 1, true);
    expect(d.pendingEvents).toEqual([]);
    resolveMainPOV(d, [A, { ...B, priority: 5 }], 2, true);
    expect(d.pendingEvents).toEqual([{ kind: CameraEventKind.Activated, camera: 2, previous: 1, blendTime: 0 }]);
  });

  it('tells of a blend as it starts, with its length, and again once, when it finishes', () => {
    const d = dir({ defaultBlend: 2 });
    resolveMainPOV(d, [A, B], 0, true);
    d.pendingEvents.length = 0;
    resolveMainPOV(d, [A, { ...B, priority: 5 }], 1, true);
    expect(d.pendingEvents).toEqual([{ kind: CameraEventKind.Activated, camera: 2, previous: 1, blendTime: 2 }]);
    d.pendingEvents.length = 0;
    resolveMainPOV(d, [A, { ...B, priority: 5 }], 2, true);
    expect(d.pendingEvents).toEqual([]);
    resolveMainPOV(d, [A, { ...B, priority: 5 }], 3, true);
    expect(d.pendingEvents).toEqual([{ kind: CameraEventKind.BlendFinished, camera: 2, previous: 1, blendTime: 2 }]);
    d.pendingEvents.length = 0;
    resolveMainPOV(d, [A, { ...B, priority: 5 }], 4, true);
    expect(d.pendingEvents).toEqual([]);
  });

  it('tells nothing from a peek', () => {
    const d = dir();
    resolveMainPOV(d, [A, B], 0, false);
    expect(d.pendingEvents).toEqual([]);
  });
});
