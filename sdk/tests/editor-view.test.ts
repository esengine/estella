/**
 * @file  Editor camera (EditorView) — verifies the editor viewport camera builds
 *        a geometrically correct full-frame view-projection from {x, y, orthoSize},
 *        using the same math primitives as scene cameras. This is the new code in
 *        the camera override path; the render path itself is shared with scene
 *        cameras (so if scene cameras render, the editor camera renders).
 */
import { describe, it, expect } from 'vitest';
import { editorCameraInfo } from '../src/camera/CameraPlugin';
import { ClearFlags } from '../src/component';

// Apply a column-major VP matrix to a 2D world point → clip/NDC xy.
function ndc(vp: Float32Array, x: number, y: number) {
  return {
    x: vp[0] * x + vp[4] * y + vp[12],
    y: vp[1] * x + vp[5] * y + vp[13],
  };
}

describe('EditorView camera', () => {
  it('builds a full-frame ortho view centered on (x, y) with orthoSize half-height', () => {
    const cam = editorCameraInfo({ active: true, x: 100, y: 50, orthoSize: 300 }, 800, 600, []);

    // Configuration: synthetic (no entity), full-frame, clears color+depth.
    expect(cam.entity).toBe(-1);
    expect(cam.viewportRect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(cam.clearFlags).toBe(ClearFlags.ColorAndDepth);
    expect(cam.cameraX).toBe(100);
    expect(cam.cameraY).toBe(50);
    expect(cam.halfH).toBe(300);
    expect(cam.halfW).toBeCloseTo(300 * (800 / 600)); // 400, aspect-corrected

    // Geometry: the camera center maps to clip origin; the view edges to ±1.
    const center = ndc(cam.viewProjection, 100, 50);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);

    const right = ndc(cam.viewProjection, 100 + cam.halfW, 50);
    expect(right.x).toBeCloseTo(1);

    const top = ndc(cam.viewProjection, 100, 50 + 300);
    expect(top.y).toBeCloseTo(1);
  });

  it('zoom (orthoSize) widens/narrows the visible world extent', () => {
    const near = editorCameraInfo({ active: true, x: 0, y: 0, orthoSize: 100 }, 800, 600, []);
    const far = editorCameraInfo({ active: true, x: 0, y: 0, orthoSize: 400 }, 800, 600, []);
    // A larger orthoSize sees more world → a given world point sits closer to center.
    const p = 200;
    expect(Math.abs(ndc(near.viewProjection, p, 0).x)).toBeGreaterThan(
      Math.abs(ndc(far.viewProjection, p, 0).x),
    );
  });
});
