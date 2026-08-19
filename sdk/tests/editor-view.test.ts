// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor camera (EditorView) — verifies the editor viewport camera builds
 *        a geometrically correct full-frame view-projection from {x, y, orthoSize},
 *        using the same math primitives as scene cameras. This is the new code in
 *        the camera override path; the render path itself is shared with scene
 *        cameras (so if scene cameras render, the editor camera renders).
 */
import { describe, it, expect } from 'vitest';
import { editorCameraInfo } from '../src/camera/CameraPlugin';
import { ClearFlags } from '../src/ecs/component';

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

// =============================================================================
// Perspective preview (2.5D authoring)
// =============================================================================

import {
  DEFAULT_EDITOR_VIEW,
  editorViewHalfExtent,
  editorViewHalfHeight,
  setEditorViewHalfHeight,
  editorViewAxes,
  editorViewBasis,
  editorViewBoxExtent,
  editorViewEye,
  editorViewWorkPlane,
  moveEditorViewFocus,
  worldAxisVector,
} from '../src/camera/EditorView';
import type { Vec3 } from '../src/types';

const view = (over: Partial<typeof DEFAULT_EDITOR_VIEW>) =>
  ({ ...DEFAULT_EDITOR_VIEW, active: true, ...over });

/** Projects a world point INCLUDING its z — the whole point of a perspective view. */
function ndc3(vp: Float32Array, x: number, y: number, z: number) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  return { x: cx / cw, y: cy / cw };
}

describe('EditorView perspective preview', () => {
  // The default has to be the view every existing project already had, to the bit.
  it('is off by default, and the orthographic view is untouched', () => {
    expect(DEFAULT_EDITOR_VIEW.perspective).toBe(false);
    const a = editorCameraInfo(view({ x: 100, y: 50, orthoSize: 300 }), 800, 600, []);
    const b = editorCameraInfo({ active: true, x: 100, y: 50, orthoSize: 300 } as never, 800, 600, []);
    expect(Array.from(a.viewProjection)).toEqual(Array.from(b.viewProjection));
  });

  // What an orthographic view fundamentally cannot show: two things the same size
  // at different depths are the same size on screen. Here they must not be.
  it('makes depth visible — nearer content projects larger', () => {
    const cam = editorCameraInfo(view({ perspective: true, distance: 1000, fov: 60 }), 800, 600, []);

    const near = ndc3(cam.viewProjection, 100, 0, 0);
    const far = ndc3(cam.viewProjection, 100, 0, -900);

    // Same world x, different depth ⇒ different screen x. The nearer one is
    // further from the centre, which IS the perspective divide.
    expect(Math.abs(near.x)).toBeGreaterThan(Math.abs(far.x) * 1.5);
  });

  it('zooms by moving the camera, not by widening a box', () => {
    const close = editorCameraInfo(view({ perspective: true, distance: 500 }), 800, 600, []);
    const away = editorCameraInfo(view({ perspective: true, distance: 2000 }), 800, 600, []);

    // The same world point fills more of the screen from closer up.
    expect(Math.abs(ndc3(close.viewProjection, 100, 0, 0).x))
      .toBeGreaterThan(Math.abs(ndc3(away.viewProjection, 100, 0, 0).x));
  });

  it('leaves orthoSize meaningless in perspective, and fov in charge', () => {
    const narrow = editorCameraInfo(view({ perspective: true, fov: 30 }), 800, 600, []);
    const wide = editorCameraInfo(view({ perspective: true, fov: 90 }), 800, 600, []);
    // A wider field sees more world, so a given point sits closer to the centre.
    expect(Math.abs(ndc3(narrow.viewProjection, 100, 0, 0).x))
      .toBeGreaterThan(Math.abs(ndc3(wide.viewProjection, 100, 0, 0).x));
  });
});

// =============================================================================
// How much world the view SEES — the one extent the grid, the framing and the
// minimap all measure with. Read from the projection itself, so the helper
// cannot drift from the matrix it claims to describe.
// =============================================================================

describe('editorViewHalfHeight', () => {
  // What "half-height" has to mean, under either projection: the world y that
  // lands exactly on the top edge of the frame on the z = 0 plane.
  const seenHalfHeight = (v: typeof DEFAULT_EDITOR_VIEW): number => {
    const cam = editorCameraInfo(v, 800, 600, []);
    let lo = 0;
    let hi = 1e6;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (ndc3(cam.viewProjection, v.x, v.y + mid, 0).y <= 1) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  it('is orthoSize orthographically', () => {
    const v = view({ orthoSize: 300 });
    expect(editorViewHalfHeight(v)).toBe(300);
    expect(seenHalfHeight(v)).toBeCloseTo(300, 1);
  });

  it('is the frustum cross-section at z = 0 in perspective — NOT the distance', () => {
    const v = view({ perspective: true, fov: 60, distance: 1000 });
    const expected = Math.tan((60 * Math.PI) / 180 / 2) * 1000; // ≈ 577.35
    expect(editorViewHalfHeight(v)).toBeCloseTo(expected, 4);
    expect(editorViewHalfHeight(v)).not.toBeCloseTo(1000, 0);
    expect(seenHalfHeight(v)).toBeCloseTo(expected, 0);
  });

  it('scales with aspect on the horizontal, like an ortho box does', () => {
    const v = view({ perspective: true, fov: 60, distance: 1000 });
    const { halfW, halfH } = editorViewHalfExtent(v, 800 / 600);
    expect(halfW).toBeCloseTo(halfH * (800 / 600), 4);
  });

  // Framing writes an extent; zooming reads one. If the two disagree, "frame
  // selection" lands on a different zoom than it asked for — which is what
  // writing orthoSize under a perspective view did (it did nothing at all).
  it('round-trips through setEditorViewHalfHeight in both projections', () => {
    for (const perspective of [false, true]) {
      const v = view({ perspective, fov: 60, distance: 1000, orthoSize: 300 });
      setEditorViewHalfHeight(v, 420);
      expect(editorViewHalfHeight(v)).toBeCloseTo(420, 6);
      expect(seenHalfHeight(v)).toBeCloseTo(420, 0);
    }
  });

  it('moves the camera in perspective and the box orthographically', () => {
    const p = view({ perspective: true, fov: 60, distance: 1000, orthoSize: 300 });
    setEditorViewHalfHeight(p, 1154.7);
    expect(p.distance).toBeCloseTo(2000, 0);
    expect(p.orthoSize).toBe(300); // untouched — not the field this view renders through

    const o = view({ orthoSize: 300, distance: 1000 });
    setEditorViewHalfHeight(o, 500);
    expect(o.orthoSize).toBe(500);
    expect(o.distance).toBe(1000);
  });
});

// =============================================================================
// The view's own basis, the plane it works on, and moving the focus through
// both. A 2D editor can assume the world plane is the screen plane; a view that
// turns cannot, and every navigation that assumed it moved somewhere else.
// =============================================================================

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

describe('the editor view basis', () => {
  it('is the 2D one head-on: right +x, up +y, forward -z', () => {
    const b = editorViewBasis(view({}));
    expect(b.right.x).toBeCloseTo(1, 6);
    expect(b.up.y).toBeCloseTo(1, 6);
    expect(b.forward.z).toBeCloseTo(-1, 6);
  });

  it('stays orthonormal at every angle, poles included', () => {
    for (const [yaw, pitch] of [[0, 0], [30, 25], [-115, 60], [0, 90], [180, -45]]) {
      const b = editorViewBasis(view({ yaw, pitch }));
      for (const a of [b.right, b.up, b.forward]) expect(len(a)).toBeCloseTo(1, 6);
      expect(dot(b.right, b.up)).toBeCloseTo(0, 6);
      expect(dot(b.right, b.forward)).toBeCloseTo(0, 6);
      expect(dot(b.up, b.forward)).toBeCloseTo(0, 6);
    }
  });

  // Two readings of one rotation. A second copy is how the axis ball and the
  // thing it claims to describe drift apart.
  it('agrees with the axis indicator', () => {
    const v = view({ yaw: 37, pitch: 21 });
    const b = editorViewBasis(v);
    const axes = editorViewAxes(v);
    expect(axes.x.dx).toBeCloseTo(b.right.x, 6);
    expect(axes.x.dy).toBeCloseTo(-b.up.x, 6);
    expect(axes.y.dx).toBeCloseTo(b.right.y, 6);
    expect(axes.z.depth).toBeCloseTo(-b.forward.z, 6);
  });

  it('stands the eye off the focus by the distance, in every direction', () => {
    const flat = editorViewEye(view({ x: 3, y: 4 }));
    expect(flat.z).toBeCloseTo(0, 6); // head-on 2D: nothing depends on where it stands

    expect(editorViewEye(view({ perspective: true, distance: 1000 })).z).toBeCloseTo(1000, 4);

    const focus = { x: 10, y: 20, z: 30 };
    const e = editorViewEye(view({ ...focus, yaw: 47, pitch: 33, distance: 500 }));
    expect(Math.hypot(e.x - focus.x, e.y - focus.y, e.z - focus.z)).toBeCloseTo(500, 4);
  });
});

describe('the work plane', () => {
  it('is the plane 2D content lives on while the view is the 2D one', () => {
    const p = editorViewWorkPlane(view({}));
    expect(worldAxisVector(p.normal)).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('is the ground once the view is a 3D one', () => {
    const p = editorViewWorkPlane(view({ perspective: true }));
    expect(worldAxisVector(p.normal)).toEqual({ x: 0, y: 1, z: 0 });
    expect(new Set([p.u, p.v, p.normal]).size).toBe(3);
  });
});

describe('moving the focus', () => {
  it('is world x / y head-on, which is the 2D editor exactly as it was', () => {
    const v = view({ x: 5, y: 7 });
    moveEditorViewFocus(v, 10, 20);
    expect(v.x).toBeCloseTo(15, 6);
    expect(v.y).toBeCloseTo(27, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  // Looking straight down, the screen's up runs along the floor. A pan that took
  // the world y axis instead would fly the focus up out of the scene.
  it('walks over the ground from a top-down eye, not through it', () => {
    const v = view({ perspective: true, distance: 1000, pitch: 90 });
    moveEditorViewFocus(v, 0, 100);
    expect(v.y).toBeCloseTo(0, 6);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(100, 6);
  });

  it('dollies along forward, which is the only way depth moves head-on', () => {
    const v = view({});
    moveEditorViewFocus(v, 0, 0, 250);
    expect(v.z).toBeCloseTo(-250, 6);
  });
});

describe('fitting a box in the frame', () => {
  it('costs nothing for the depth an eye is looking along', () => {
    const e = editorViewBoxExtent(view({}), { x: 30, y: 40, z: 500 });
    expect(e.right).toBeCloseTo(30, 6);
    expect(e.up).toBeCloseTo(40, 6);
  });

  it('turns depth into screen width once the eye is turned onto it', () => {
    const e = editorViewBoxExtent(view({ yaw: 90 }), { x: 0, y: 0, z: 500 });
    expect(e.right).toBeCloseTo(500, 4);
    expect(e.up).toBeCloseTo(0, 6);
  });
});

describe('the focus the view turns around', () => {
  // The focus is the centre of the frame by definition. It was pinned to z = 0,
  // so an orbit of a 3D scene swung around a plane the content was not on.
  it('is the centre of the frame at any depth', () => {
    const v = view({ x: 100, y: 50, z: -400, perspective: true, distance: 1000, yaw: 30, pitch: 25 });
    const cam = editorCameraInfo(v, 800, 600, []);

    const focus = ndc3(cam.viewProjection, 100, 50, -400);
    expect(focus.x).toBeCloseTo(0, 5);
    expect(focus.y).toBeCloseTo(0, 5);

    // ...and the same x/y on the 2D plane is not, or the depth reached nothing.
    const onPlane = ndc3(cam.viewProjection, 100, 50, 0);
    expect(Math.abs(onPlane.x) + Math.abs(onPlane.y)).toBeGreaterThan(0.05);
  });
});
