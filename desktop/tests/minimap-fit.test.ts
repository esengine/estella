// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The viewport minimap's world↔map projection. The camera frame is the
 *        part that has to stay inside the map: what leaves it is clipped away by
 *        the SVG, and a frame reduced to its top and bottom edges reads as two
 *        stray lines rather than as "you are looking at all of this".
 */
import { describe, it, expect } from 'vitest';
import { minimapFit, minimapBox, minimapCamRect, minimapToWorld } from '@/engine/minimapFit';

const W = 200, H = 128, PAD = 8;
// 800 × 700 of world — wider than the map's aspect, so height is the binding axis.
const BOUNDS = { minX: -400, minY: -350, maxX: 400, maxY: 350 };
const fit = minimapFit(BOUNDS, W, H, PAD)!;

describe('minimapFit', () => {
  it('has no fit without bounds', () => {
    expect(minimapFit(null, W, H, PAD)).toBeNull();
  });

  it('letterboxes on the binding axis and centres the other', () => {
    expect(fit.scale).toBeCloseTo((H - 2 * PAD) / 700);
    expect(fit.offY).toBeCloseTo(PAD);
    expect(fit.offX).toBeGreaterThan(PAD);
  });

  it('survives a degenerate (zero-extent) scene', () => {
    const f = minimapFit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, W, H, PAD)!;
    expect(Number.isFinite(f.scale)).toBe(true);
    expect(Number.isFinite(f.offX)).toBe(true);
  });
});

describe('minimapBox', () => {
  it('places distinct world heights at distinct map heights', () => {
    const low = minimapBox(fit, -80, -132, 80, -108);
    const high = minimapBox(fit, -80, 168, 80, 192);
    expect(high.y).toBeLessThan(low.y); // world +y is up, map +y is down
    expect(high.y).not.toBeCloseTo(low.y);
  });

  it('keeps a hairline entity visible instead of collapsing it', () => {
    expect(minimapBox(fit, 0, 0, 0.01, 0.01).w).toBeGreaterThanOrEqual(1);
  });

  it('maps the full bounds onto the padded box', () => {
    const all = minimapBox(fit, BOUNDS.minX, BOUNDS.minY, BOUNDS.maxX, BOUNDS.maxY);
    expect(all.y).toBeCloseTo(PAD);
    expect(all.h).toBeCloseTo(H - 2 * PAD);
  });
});

describe('minimapCamRect', () => {
  const inside = (r: { x: number; y: number; w: number; h: number }) =>
    r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-6 && r.y + r.h <= H + 1e-6;

  it('stays inside the map when the view is far wider than the scene', () => {
    const r = minimapCamRect(fit, { cx: 0, cy: 0, halfW: 4000, halfH: 350 }, W, H);
    expect(inside(r)).toBe(true);
  });

  it('stays inside the map when the view is panned right off the scene', () => {
    const r = minimapCamRect(fit, { cx: 9000, cy: 0, halfW: 500, halfH: 300 }, W, H);
    expect(inside(r)).toBe(true);
  });

  it('stays inside the map when the view is panned above the scene', () => {
    const r = minimapCamRect(fit, { cx: 0, cy: 9000, halfW: 500, halfH: 300 }, W, H);
    expect(inside(r)).toBe(true);
  });

  it('tracks a sub-view rather than always filling the map', () => {
    const r = minimapCamRect(fit, { cx: 0, cy: 0, halfW: 100, halfH: 75 }, W, H);
    expect(inside(r)).toBe(true);
    expect(r.w).toBeLessThan(W / 2);
    expect(r.x).toBeGreaterThan(0);
  });

  it('moves with the camera', () => {
    const v = { halfW: 100, halfH: 75 };
    const left = minimapCamRect(fit, { cx: -200, cy: 0, ...v }, W, H);
    const right = minimapCamRect(fit, { cx: 200, cy: 0, ...v }, W, H);
    expect(right.x).toBeGreaterThan(left.x);
  });
});

describe('minimapToWorld', () => {
  it('inverts the box projection', () => {
    const r = minimapBox(fit, -80, -132, 80, -108);
    const p = minimapToWorld(fit, r.x, r.y);
    expect(p.x).toBeCloseTo(-80);
    expect(p.y).toBeCloseTo(-108);
  });
});
