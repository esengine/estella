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
}));

vi.mock('@/engine/EngineHost', () => ({
  EngineHost: {
    getResource: () => host.view,
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
