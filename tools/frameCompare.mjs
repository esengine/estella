// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  frameCompare.mjs — is this the same picture, coarsely?
 *
 * For asking whether a packaged game shows what the editor showed. Both sides
 * must be captured at the SAME surface size — the caller's job, and an exact
 * one, since the editor reports the size of its play surface and a package can
 * be opened at any size. Given that, comparison is a resample and a score.
 *
 * Coarse on purpose: the failures worth catching (wrong scene, missing assets,
 * lost configuration, wrong design resolution) move whole regions of the image,
 * while drift between two independently-timed runs moves a few pixels.
 */
import { readPNG } from '../desktop/scripts/lib/editorDriver.mjs';

export { readPNG };

/** Fraction of each edge dropped before comparing — the editor draws a play
 *  border around its surface, and it is chrome, not game. */
export const DEFAULT_INSET = 0.02;

/**
 * Box-average `img` onto a `cols × rows` grid as a flat RGB array, ignoring an
 * `inset` fraction of every edge. Resampling is what lets two captures be
 * compared at all; averaging is what makes the score ignore edge shimmer.
 */
export function downsample(img, cols, rows, inset = 0) {
  const mx = Math.floor(img.w * inset);
  const my = Math.floor(img.h * inset);
  const x0 = mx, y0 = my;
  const bw = Math.max(1, img.w - mx * 2);
  const bh = Math.max(1, img.h - my * 2);
  const out = new Float64Array(cols * rows * 3);
  for (let cy = 0; cy < rows; cy++) {
    const yA = y0 + Math.floor((cy * bh) / rows);
    const yB = y0 + Math.max(Math.floor((cy * bh) / rows) + 1, Math.floor(((cy + 1) * bh) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const xA = x0 + Math.floor((cx * bw) / cols);
      const xB = x0 + Math.max(Math.floor((cx * bw) / cols) + 1, Math.floor(((cx + 1) * bw) / cols));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = yA; y < yB && y < y0 + bh; y++) {
        for (let x = xA; x < xB && x < x0 + bw; x++) {
          const p = img.px(x, y);
          r += p[0]; g += p[1]; b += p[2]; n++;
        }
      }
      const i = (cy * cols + cx) * 3;
      out[i] = n ? r / n : 0;
      out[i + 1] = n ? g / n : 0;
      out[i + 2] = n ? b / n : 0;
    }
  }
  return out;
}

/** Mean per-channel difference of two same-length grids, normalised to 0..1. */
export function gridDistance(a, b) {
  if (a.length !== b.length) throw new Error(`grid size mismatch: ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}

/**
 * How different two captures are, 0 (identical) to 1. Refuses different sizes
 * rather than stretching: two shapes letterbox differently and put screen-space
 * UI elsewhere, so the score would measure the harness, not the game.
 */
export function frameDistance(pngA, pngB, { cols = 48, rows = 27, inset = DEFAULT_INSET } = {}) {
  const a = readPNG(pngA);
  const b = readPNG(pngB);
  if (a.w !== b.w || a.h !== b.h) {
    throw new Error(`captures differ in size (${a.w}x${a.h} vs ${b.w}x${b.h}) — compare like for like`);
  }
  return gridDistance(downsample(a, cols, rows, inset), downsample(b, cols, rows, inset));
}
