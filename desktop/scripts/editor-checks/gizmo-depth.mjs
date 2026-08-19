// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gizmo-depth — the transform gizmo stands on the entity, not on its shadow.
 *
 * The pivot is a Vec3 and it is projected through its own z; unit tests can say
 * both of those and neither reaches the screen. Between them sit the selection
 * read, the live transform, the projection and a DOM overlay the viewport capture
 * cannot even see — so this drives a real editor and looks at the composited
 * window.
 *
 * The measurement is self-calibrating. Orthographically a screen point's x/y do
 * not vary with depth, so the marker's position in an orthographic capture IS
 * where its z = 0 shadow projects. Switch to perspective, holding the eye
 * head-on, and the same marker moves — that is the divide. The gizmo has to
 * follow it. Which of the two candidate places the overlay sits at is the whole
 * question, and the check knows both without being told either.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** A camera to seed the framing, and one marker well behind the 2D plane. */
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
      ],
    },
    {
      id: 1, name: 'Marker', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 250, z: -1400 } } },
        { type: 'Sprite', data: { size: { x: 140, y: 140 }, color: { r: 1, g: 0, b: 1, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'gizmo-depth';
export const describes = 'the transform gizmo is drawn on the selection, at the depth it is at';

/** Centroid of the pixels matching `want`, or null when none are lit. */
function centroid(png, want, tol = 50) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol
          && Math.abs(p[2] - want[2]) <= tol) { sx += x; sy += y; n++; }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : null;
}

/**
 * Centroid of the pixels that differ between two shots, inside `box`.
 *
 * Selecting also repaints the outliner row, the details panel and the minimap,
 * which are most of the window's ink and none of the question. The box holds both
 * places the gizmo could be and nothing else, so it favours neither answer.
 */
function changedCentroid(a, b, box, tol = 10) {
  let sx = 0, sy = 0, n = 0;
  const w = Math.floor(Math.min(a.w, b.w, box.x1));
  const h = Math.floor(Math.min(a.h, b.h, box.y1));
  for (let y = Math.max(0, Math.ceil(box.y0)); y < h; y++) {
    for (let x = Math.max(0, Math.ceil(box.x0)); x < w; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol || Math.abs(p[2] - q[2]) > tol) {
        sx += x; sy += y; n++;
      }
    }
  }
  return n > 0 ? { x: sx / n, y: sy / n, n } : null;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  await ed.call('run_editor_command', { id: 'tool.move' }, 30000);
  await ed.call('run_editor_command', { id: 'view.resetOrbit' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(800);

  // Orthographically, depth does not move a screen point: this is where the
  // marker's z = 0 shadow lands, and the place a plane-bound gizmo would sit.
  const shadowShot = await ed.screenshot('gizmo-depth-ortho');
  const shadow = centroid(shadowShot, [255, 0, 255]);
  if (!check(shadow != null, 'the orthographic shot does not show the marker at all')) {
    return check.failures;
  }

  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.call('run_editor_command', { id: 'view.resetOrbit' }, 30000);
  await ed.sleep(800);
  const bare = await ed.screenshot('gizmo-depth-persp');
  const marker = centroid(bare, [255, 0, 255]);
  if (!check(marker != null, 'the perspective shot does not show the marker at all')) {
    return check.failures;
  }

  // Without this the two answers coincide and everything below passes for free.
  const spread = dist(shadow, marker);
  if (!check(spread > 60, `the marker moved only ${spread.toFixed(0)}px between the projections — `
      + 'the two places a gizmo could sit are the same place, so this proves nothing')) {
    return check.failures;
  }

  await ed.call('select', { id: 1 }, 30000);
  await ed.sleep(800);
  const selected = await ed.screenshot('gizmo-depth-selected');

  // What selecting drew: the outline and the gizmo, whose ink dominates. The box
  // is wide enough for a gizmo drawn at either candidate — one axis length.
  const reach = 90;
  const overlay = changedCentroid(bare, selected, {
    x0: Math.min(shadow.x, marker.x) - reach, x1: Math.max(shadow.x, marker.x) + reach,
    y0: Math.min(shadow.y, marker.y) - reach, y1: Math.max(shadow.y, marker.y) + reach,
  });
  if (!check(overlay != null && overlay.n > 200,
      `selecting the marker changed ${overlay?.n ?? 0} pixels — no gizmo was drawn`)) {
    return check.failures;
  }

  const onEntity = dist(overlay, marker);
  const onShadow = dist(overlay, shadow);
  check(
    onEntity < onShadow / 2,
    `the selection overlay landed ${onEntity.toFixed(0)}px from the marker and `
    + `${onShadow.toFixed(0)}px from its z = 0 shadow (${spread.toFixed(0)}px apart) — `
    + 'the gizmo is being projected on a plane its entity is not on',
  );

  return check.failures;
}
