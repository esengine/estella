// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    minimapFit.ts
 * @brief   Projection between world space and the viewport minimap's fixed
 *          coordinate box: the letterbox fit, world→map rects, and map→world
 *          for click-to-navigate.
 */
import type { MinimapBounds } from './ViewportController';

/** Scale + centring offsets that fit `bounds` into a `w × h` map, aspect preserved. */
export interface MinimapFit {
  b: MinimapBounds;
  scale: number;
  offX: number;
  offY: number;
}

export function minimapFit(
  bounds: MinimapBounds | null, w: number, h: number, pad: number,
): MinimapFit | null {
  if (!bounds) return null;
  const worldW = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const worldH = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const scale = Math.min((w - 2 * pad) / worldW, (h - 2 * pad) / worldH);
  return { b: bounds, scale, offX: (w - worldW * scale) / 2, offY: (h - worldH * scale) / 2 };
}

/** A world AABB in map coordinates (y flips: world +y is up, map +y is down). */
export function minimapBox(
  fit: MinimapFit, x0: number, y0: number, x1: number, y1: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: fit.offX + (x0 - fit.b.minX) * fit.scale,
    y: fit.offY + (fit.b.maxY - y1) * fit.scale,
    w: Math.max(1, (x1 - x0) * fit.scale),
    h: Math.max(1, (y1 - y0) * fit.scale),
  };
}

/** Thinnest camera frame that still reads as a frame. */
const CAM_MIN = 2;

/** `[lo, hi]` of `v`, then a `CAM_MIN`-wide span that cannot leave `[0, size]` —
 *  a view panned clean off the scene pins to the edge it left by. */
function span(lo: number, hi: number, size: number): [number, number] {
  const a = Math.min(Math.max(lo, 0), size);
  const b = Math.min(Math.max(hi, 0), size);
  return [Math.min(a, Math.max(0, size - CAM_MIN)), Math.max(CAM_MIN, b - a)];
}

/**
 * The camera's world rect as a map rect CLAMPED to the map.
 *
 * A view wider than the scene projects past the map, and the SVG clips whatever
 * leaves it — leaving two stray lines where a frame should be. Clamped, the same
 * state says what it means: the frame covers the map because you see everything.
 */
export function minimapCamRect(
  fit: MinimapFit, view: { cx: number; cy: number; halfW: number; halfH: number }, w: number, h: number,
): { x: number; y: number; w: number; h: number } {
  const [x, width] = span(
    fit.offX + (view.cx - view.halfW - fit.b.minX) * fit.scale,
    fit.offX + (view.cx + view.halfW - fit.b.minX) * fit.scale,
    w,
  );
  const [y, height] = span(
    fit.offY + (fit.b.maxY - (view.cy + view.halfH)) * fit.scale,
    fit.offY + (fit.b.maxY - (view.cy - view.halfH)) * fit.scale,
    h,
  );
  return { x, y, w: width, h: height };
}

/** Map coordinates back to world — the click/drag navigation door. */
export function minimapToWorld(fit: MinimapFit, mx: number, my: number): { x: number; y: number } {
  return {
    x: fit.b.minX + (mx - fit.offX) / fit.scale,
    y: fit.b.maxY - (my - fit.offY) / fit.scale,
  };
}
