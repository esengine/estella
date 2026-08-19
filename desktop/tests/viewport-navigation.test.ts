// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Panning and zooming the editor view, which move a focus in three
 *        dimensions through the view's own axes.
 *
 * The SDK owns what those axes are; this is the wiring above it — the pixel
 * scale a drag is measured in, and which way the focus goes. A sign or a scale
 * wrong here is a viewport that fights the cursor, and no unit test of the basis
 * would say so.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_EDITOR_VIEW, editorViewHalfExtent, type EditorViewData } from 'esengine';

const host = vi.hoisted(() => ({
  view: null as EditorViewData | null,
  canvas: null as unknown,
  /** The ray a screen point names, when a test wants to ask where it lands. */
  ray: null as unknown,
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: {
    getResource: (r: unknown) =>
      ((r as { _name?: string })?._name === 'CameraView' ? { screenRay: () => host.ray } : host.view),
    get canvas() { return host.canvas; },
    get world() { return null; },
  },
}));

import { ViewportController } from '@/engine/ViewportController';

const W = 800;
const H = 600;
const ASPECT = W / H;

// 600 CSS pixels of height over 2 × 300 world units: one world unit per pixel,
// so every expectation below is the drag in pixels.
const view = (over: Partial<EditorViewData>): EditorViewData =>
  ({ ...DEFAULT_EDITOR_VIEW, active: true, orthoSize: 300, ...over });

/** A perspective view that sees the same 300 world units of half-height. */
const perspectiveView = (over: Partial<EditorViewData>): EditorViewData =>
  view({ perspective: true, fov: 60, distance: 300 / Math.tan(Math.PI / 6), ...over });

/** Where a normalized screen point lands at the focus, from the view's own extent. */
function under(v: EditorViewData, nx: number, ny: number): { x: number; y: number } {
  const { halfW, halfH } = editorViewHalfExtent(v, ASPECT);
  return { x: v.x + nx * halfW, y: v.y + ny * halfH };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  host.canvas = {
    width: W,
    height: H,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }),
  };
});

describe('panning the editor view', () => {
  it('is the 2D pan it always was, head-on', () => {
    const v = view({});
    host.view = v;
    ViewportController.panByClient(100, 100, 150, 130);
    // The world follows the cursor: right and down by the drag.
    expect(v.x).toBeCloseTo(-50, 6);
    expect(v.y).toBeCloseTo(30, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  // The 2D plane is edge-on from up here. A pan measured against it would slide
  // the focus along a plane the eye cannot see, or nowhere at all.
  it('walks over the ground from a top-down eye', () => {
    const v = perspectiveView({ pitch: 90 });
    host.view = v;
    ViewportController.panByClient(0, 0, 0, 30);
    expect(v.y).toBeCloseTo(0, 6);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(30, 6);
  });

  it('takes the drag at the zoom it is drawn at', () => {
    const v = view({ orthoSize: 600 }); // half as zoomed in ⇒ twice the world per pixel
    host.view = v;
    ViewportController.panByClient(0, 0, 50, 0);
    expect(v.x).toBeCloseTo(-100, 6);
  });
});

describe('zooming about the cursor', () => {
  it('leaves the world point under the cursor where it was', () => {
    const v = view({});
    host.view = v;
    const nx = 0.75;
    const ny = 0.5;
    const before = under(v, nx, ny);

    ViewportController.zoomAtClient(((nx + 1) / 2) * W, ((1 - ny) / 2) * H, 0.5);

    expect(v.orthoSize).toBeCloseTo(150, 6);
    const after = under(v, nx, ny);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('keeps the focus on the ground plane from a top-down eye', () => {
    const v = perspectiveView({ pitch: 90 });
    host.view = v;
    ViewportController.zoomAtClient(W * 0.9, H * 0.1, 0.5);
    expect(v.y).toBeCloseTo(0, 6);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(1);
  });
});

describe('the plane the view authors on', () => {
  // Straight down the −z axis from a point above the origin: it meets the 2D
  // plane at (12, 5, 0) and the ground at (12, 0, 5).
  const downAndBack = { origin: { x: 12, y: 5, z: 100 }, dir: { x: 0, y: -1, z: -1 } };

  it('orthographic is the 2D plane, which is where every 2D drop always landed', () => {
    host.view = view({});
    host.ray = downAndBack;
    const p = ViewportController.canvasToWorkPlane(400, 300);
    expect(p).not.toBeNull();
    expect(p!.z).toBeCloseTo(0, 6);
    expect(p!.x).toBeCloseTo(12, 6);
    expect(p!.y).toBeCloseTo(-95, 6);
    expect(ViewportController.workPlaneAxes()).toEqual(['x', 'y']);
  });

  // A 3D scene stands on the ground, and that is the surface a dropped thing
  // belongs on — not the wall at z = 0 the cursor happens to cross.
  it('perspective is the ground, and says so in the axes it names', () => {
    host.view = perspectiveView({ pitch: 40 });
    host.ray = downAndBack;
    const p = ViewportController.canvasToWorkPlane(400, 300);
    expect(p).not.toBeNull();
    expect(p!.y).toBeCloseTo(0, 6);
    expect(p!.x).toBeCloseTo(12, 6);
    expect(p!.z).toBeCloseTo(95, 6);
    expect(ViewportController.workPlaneAxes()).toEqual(['x', 'z']);
  });

  // A perspective eye held head-on looks ALONG the ground: every ray meets it
  // where nobody pointed. The plane through the focus facing the eye is what a
  // screen point means there — and head-on that is the 2D plane, unchanged.
  // A ray can lie along a plane the VIEW is square enough on: half a wide fov at
  // the frame's edge is a long way off the view axis.
  it('falls back to the focus plane when the ray itself lies in the plane', () => {
    host.view = perspectiveView({ pitch: 8, z: -25 });
    host.ray = { origin: { x: 3, y: 4, z: 900 }, dir: { x: 0, y: 0.0005, z: -1 } };
    const p = ViewportController.canvasToWorkPlane(400, 300);
    expect(p).not.toBeNull();
    // Near the focus, on the plane facing the eye — not the thousands of units
    // away the ground would have answered.
    expect(Math.abs(p!.z + 25)).toBeLessThan(5);
    expect(p!.x).toBeCloseTo(3, 4);
  });
});

describe('the arrow-key nudge', () => {
  it('is +X right and +Y up head-on, which is the 2D nudge', () => {
    host.view = view({});
    const d = ViewportController.nudgeVector(10, 4);
    expect(d.x).toBeCloseTo(10, 6);
    expect(d.y).toBeCloseTo(4, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  // From straight above, world +Y is the axis the eye looks down: adding to it
  // lifts the thing off the ground instead of sliding it up the screen.
  it('slides over the ground from a top-down eye', () => {
    host.view = perspectiveView({ pitch: 90 });
    const d = ViewportController.nudgeVector(10, 4);
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.x).toBeCloseTo(10, 6);
    expect(d.z).toBeCloseTo(-4, 6);
  });

  // A perspective eye that has not been turned yet looks ALONG the ground, whose
  // second axis then points into the picture. The 2D pair is what the keys name.
  it('is the 2D nudge again when the ground is edge-on', () => {
    host.view = perspectiveView({});  // head-on: the eye looks ALONG the ground
    const d = ViewportController.nudgeVector(10, 4);
    expect(d.x).toBeCloseTo(10, 6);
    expect(d.y).toBeCloseTo(4, 6);
    expect(d.z).toBeCloseTo(0, 6);
  });

  // Turned a quarter turn about Y, screen-right is world Z and the ground's other
  // axis takes the vertical key — never the same axis twice.
  it('follows the eye round, and never names one axis twice', () => {
    host.view = perspectiveView({ yaw: 90, pitch: 45 });
    const d = ViewportController.nudgeVector(10, 4);
    expect(d.y).toBeCloseTo(0, 6);
    expect(Math.abs(d.z)).toBeCloseTo(10, 6);
    expect(Math.abs(d.x)).toBeCloseTo(4, 6);
  });
});

describe('the minimap plots the plane the view works on', () => {
  it('is the 2D plane orthographically, and the map round-trips', () => {
    const v = view({ x: 5, y: 7, z: 3 });
    host.view = v;
    const r = ViewportController.editorViewRect()!;
    expect(r.cx).toBeCloseTo(5, 6);
    expect(r.cy).toBeCloseTo(7, 6);
    ViewportController.centerViewOn(10, 20);
    expect(v.x).toBeCloseTo(10, 6);
    expect(v.y).toBeCloseTo(20, 6);
    expect(v.z).toBeCloseTo(3, 6); // the axis the map looks along is left alone
  });

  // Looking down at the ground, +Z runs AWAY from the eye — down the map, the way
  // a plan drawn from above reads. Plotting it as +y up would mirror the scene.
  it('is the ground under a 3D eye, drawn as looking down reads', () => {
    const v = perspectiveView({ x: 5, y: 1, z: 7, pitch: 40 });
    host.view = v;
    const r = ViewportController.editorViewRect()!;
    expect(r.cx).toBeCloseTo(5, 6);
    expect(r.cy).toBeCloseTo(-7, 6);
    ViewportController.centerViewOn(10, 20);
    expect(v.x).toBeCloseTo(10, 6);
    expect(v.z).toBeCloseTo(-20, 6);
    expect(v.y).toBeCloseTo(1, 6);
  });
});
