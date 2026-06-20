/**
 * @file  Camera POV — verifies the authored-view-params → view-projection seam
 *        (buildCameraInfo), including the newly-honored camera rotation. The POV
 *        is the decoupling point a camera director will blend over (Phase C).
 */
import { describe, it, expect } from 'vitest';
import { buildCameraInfo, type CameraPOV } from '../src/camera/CameraPlugin';
import { ProjectionType, ClearFlags } from '../src/component';

function ndc(vp: Float32Array, x: number, y: number) {
  return { x: vp[0] * x + vp[4] * y + vp[12], y: vp[1] * x + vp[5] * y + vp[13] };
}

const pov = (over: Partial<CameraPOV>): CameraPOV => ({
  entity: -1,
  isActive: true,
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

describe('camera POV → view-projection', () => {
  it('rotation 0 keeps the old translation-only view (center → clip origin)', () => {
    const cam = buildCameraInfo(pov({ x: 100, y: 50 }), 800, 600, null, [], 0);
    const c = ndc(cam.viewProjection, 100, 50);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    // a point at +halfW to the right maps to clip x = +1
    expect(ndc(cam.viewProjection, 100 + cam.halfW, 50).x).toBeCloseTo(1);
  });

  it('camera rotation rotates the view (+90° → a point on the right maps to the bottom)', () => {
    const cam = buildCameraInfo(pov({ rotation: Math.PI / 2 }), 800, 600, null, [], 0);
    const r = ndc(cam.viewProjection, 50, 0); // world point to the right of the camera
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(-0.5); // appears at the bottom of the view
  });

  it('perspective POV builds without throwing and is non-degenerate', () => {
    const cam = buildCameraInfo(
      pov({ projection: ProjectionType.Perspective, fov: 60, near: 0.1, far: 100 }),
      800,
      600,
      null,
      [],
      0,
    );
    expect(cam.viewProjection.some((v) => v !== 0)).toBe(true);
  });
});
