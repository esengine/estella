// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  design-frame — the authored screen is drawn on the plane it is on.
 *
 * The design frame, the device frame, the scrim outside them and the safe area are
 * all rects on the 2D plane. Projected corner by corner they are quads, and only a
 * head-on eye sees them as rects. This drives a real editor and measures the shape.
 *
 * The measurement is the frame against itself. Toggling gizmos paints the frame, so
 * the span between its two side strokes on a row is its width there. Head-on that
 * width is the same near the top and near the bottom; from a turned eye a trapezoid's
 * two ends differ. Both claims are made, so a frame drawn as an axis-aligned box fails
 * the second while still passing the first.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  // No scene Camera: its own framing gizmo is a projected quad too, and it would be
  // the widest thing the gizmo toggle paints on most rows.
  entities: [
    {
      id: 1, name: 'Canvas', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Canvas', data: { designResolution: { x: 800, y: 600 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'design-frame';
export const describes = 'the authored screen is drawn as the shape it is, from any eye';

/**
 * How far apart the frame's two side strokes are, per row.
 *
 * The tolerance is high on purpose: the scrim outside the frame is a 32% wash over
 * an already-black viewport and moves a channel by three, while the frame's own
 * stroke is a bright accent over it. Only the strokes clear this bar.
 */
function frameWidths(a, b, tol = 40) {
  const w = Math.min(a.w, b.w);
  const h = Math.min(a.h, b.h);
  const rows = [];
  for (let y = 0; y < h; y++) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol || Math.abs(p[2] - q[2]) > tol) {
        if (first < 0) first = x;
        last = x;
      }
    }
    rows.push({ y, width: first < 0 ? 0 : last - first });
  }
  return rows;
}

/**
 * The frame's width a fraction of the way down it, over the rows where both side
 * strokes are present. The band excludes the ends, where the top and bottom strokes
 * and the resolution label run the full width and say nothing about the sides.
 */
function widthAt(rows, fraction) {
  const spanning = rows.filter((r) => r.width > 100);
  if (spanning.length < 40) return null;
  const lo = Math.round(spanning.length * 0.15);
  const band = spanning.slice(lo, spanning.length - lo);
  return band[Math.round((band.length - 1) * fraction)].width;
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('run_editor_command', { id: 'mode.ui' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(1000);

  /** The frame's width near its top and near its bottom, for the current eye. */
  const measure = async (label) => {
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const off = await ed.screenshot(`${label}-off`);
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const on = await ed.screenshot(`${label}-on`);
    const rows = frameWidths(off, on);
    return { near: widthAt(rows, 0.15), far: widthAt(rows, 0.85) };
  };

  const flat = await measure('design-frame-flat');
  if (!check(flat.near != null && flat.far != null,
      'the head-on shot has no frame to measure — it is not being drawn at all')) {
    return check.failures;
  }
  // Head-on the frame is a rect, and stays one: this is what says the measurement
  // reads the frame rather than some other thing the gizmo toggle repaints.
  check(
    Math.abs(flat.near - flat.far) <= Math.max(flat.near, flat.far) * 0.02,
    `head-on the frame measures ${flat.near}px near its top and ${flat.far}px near its bottom — `
    + 'a rect seen square-on has one width, so this is measuring something else',
  );

  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.sleep(1200);
  const turned = await measure('design-frame-turned');
  if (!check(turned.near != null && turned.far != null,
      'the turned shot has no frame to measure')) {
    return check.failures;
  }
  const spread = Math.abs(turned.near - turned.far) / Math.max(turned.near, turned.far);
  check(
    spread > 0.08,
    `from a turned eye the frame measures ${turned.near}px near its top and ${turned.far}px near `
    + `its bottom (${(spread * 100).toFixed(1)}% apart) — a rect on a plane seen at an angle is a `
    + 'trapezoid, and this is still being drawn as a box',
  );

  return check.failures;
}
