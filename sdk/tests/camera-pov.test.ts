// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Camera POV — verifies the authored-view-params → view-projection seam
 *        (buildCameraInfo), including the newly-honored camera rotation. The POV
 *        is the decoupling point a camera director will blend over (Phase C).
 */
import { describe, it, expect } from 'vitest';
import { buildCameraInfo, snapToPixelGrid, type CameraPOV } from '../src/camera/CameraPlugin';
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
  pixelPerfect: false,
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

  it('snapToPixelGrid rounds to the nearest cell (and no-ops at 0)', () => {
    expect(snapToPixelGrid(10.4, 1)).toBeCloseTo(10);
    expect(snapToPixelGrid(10.6, 1)).toBeCloseTo(11);
    expect(snapToPixelGrid(-3.6, 1)).toBeCloseTo(-4);
    expect(snapToPixelGrid(2.7, 0.5)).toBeCloseTo(2.5);
    expect(snapToPixelGrid(7.3, 0)).toBe(7.3); // worldPerPixel 0 → unchanged
  });

  it('pixel-perfect collapses sub-pixel-grid positions to one view', () => {
    // orthoSize 100, 200px tall, full viewport → worldPerPixel = 2*100/200 = 1.
    const a = buildCameraInfo(pov({ x: 10.1, y: 0.2, pixelPerfect: true }), 200, 200, null, [], 0);
    const b = buildCameraInfo(pov({ x: 10.4, y: -0.3, pixelPerfect: true }), 200, 200, null, [], 1);
    // Both snap to (10, 0) → identical view-projection.
    expect(Array.from(b.viewProjection)).toEqual(Array.from(a.viewProjection));
    expect(b.cameraX).toBeCloseTo(10);
    expect(b.cameraY).toBeCloseTo(0);
  });

  it('without pixel-perfect those same positions produce different views', () => {
    const a = buildCameraInfo(pov({ x: 10.1, y: 0.2, pixelPerfect: false }), 200, 200, null, [], 0);
    const b = buildCameraInfo(pov({ x: 10.4, y: -0.3, pixelPerfect: false }), 200, 200, null, [], 1);
    expect(Array.from(b.viewProjection)).not.toEqual(Array.from(a.viewProjection));
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
