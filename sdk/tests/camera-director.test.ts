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
  DEFAULT_DIRECTOR,
  type CameraDirectorState,
} from '../src/camera/CameraDirector';
import type { CameraPOV } from '../src/camera/CameraPlugin';
import { ProjectionType, ClearFlags } from '../src/component';

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
  ...DEFAULT_DIRECTOR,
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
});
