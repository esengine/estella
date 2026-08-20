// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  selection-outline — the outline is the shape of the thing, not a box round it.
 *
 * A selected entity is drawn as the convex hull of its projected corners. The hull
 * itself is unit-tested; what no unit test reaches is the overlay — the shape lives
 * in DOM over the canvas, which `capture_viewport` cannot see at all.
 *
 * A square turned 45° is what makes the claim measurable: its outline is a diamond
 * whose vertices sit at the MIDPOINTS of its bounding box's edges, and whose bounding
 * box CORNERS are empty. An outline drawn as that bounding box has exactly the
 * opposite ink. Head-on and in 2D on purpose: the loose box was never a 3D-only
 * problem, a turned sprite always had one.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** An eighth turn about Z (45°), as the quaternion a scene file stores. A quarter
 *  turn would leave the square axis-aligned and the two shapes identical. */
const EIGHTH = Math.PI / 4;
const SIN = Math.sin(EIGHTH / 2);
const COS = Math.cos(EIGHTH / 2);

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
      id: 1, name: 'Turned', parent: null, children: [], visible: true,
      components: [
        {
          type: 'Transform',
          data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: SIN, w: COS } },
        },
        { type: 'Sprite', data: { size: { x: 220, y: 220 }, color: { r: 1, g: 0, b: 1, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'selection-outline';
export const describes = 'a selected entity is outlined by its own shape, not by a box around it';

/** Every pixel that differs between two shots, inside `box`. */
function changed(a, b, box, tol = 10) {
  const pts = [];
  const x1 = Math.floor(Math.min(a.w, b.w, box.x1));
  const y1 = Math.floor(Math.min(a.h, b.h, box.y1));
  for (let y = Math.max(0, Math.ceil(box.y0)); y < y1; y++) {
    for (let x = Math.max(0, Math.ceil(box.x0)); x < x1; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol || Math.abs(p[2] - q[2]) > tol) {
        pts.push({ x, y });
      }
    }
  }
  return pts;
}

/** Bounding box of a point set. */
function bounds(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** How many of `pts` fall within `r` of `c`. */
const near = (pts, c, r) => pts.filter((p) => Math.hypot(p.x - c.x, p.y - c.y) <= r).length;

/** Pixels matching `want`, as a point set. */
function match(png, want, tol = 50) {
  const pts = [];
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol
          && Math.abs(p[2] - want[2]) <= tol) pts.push({ x, y });
    }
  }
  return pts;
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  // The mode is remembered across sessions: say which one this is measured in.
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  // The select tool draws no transform gizmo, so the only ink selecting adds around
  // the entity is the outline itself (and the pivot dot, at the centre).
  await ed.call('run_editor_command', { id: 'tool.select' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(800);
  const bare = await ed.screenshot('outline-bare');

  const body = match(bare, [255, 0, 255]);
  if (!check(body.length > 500, `the shot shows ${body.length} pixels of the sprite — it is not on screen`)) {
    return check.failures;
  }
  const b = bounds(body);
  const half = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;

  await ed.call('select', { id: 1 }, 30000);
  await ed.sleep(800);
  const selected = await ed.screenshot('outline-selected');

  // Around the sprite and nothing else: selecting repaints the outliner and the
  // details panel too, which is most of the window's ink and none of the question.
  const pad = Math.max(12, half * 0.25);
  const ink = changed(bare, selected, {
    x0: b.x0 - pad, x1: b.x1 + pad + 1, y0: b.y0 - pad, y1: b.y1 + pad + 1,
  });
  if (!check(ink.length > 100, `selecting drew ${ink.length} pixels around the sprite — no outline`)) {
    return check.failures;
  }

  const o = bounds(ink);
  const r = Math.max(6, half * 0.12);
  const corners = [
    { x: o.x0, y: o.y0 }, { x: o.x1, y: o.y0 }, { x: o.x1, y: o.y1 }, { x: o.x0, y: o.y1 },
  ];
  const mids = [
    { x: (o.x0 + o.x1) / 2, y: o.y0 }, { x: o.x1, y: (o.y0 + o.y1) / 2 },
    { x: (o.x0 + o.x1) / 2, y: o.y1 }, { x: o.x0, y: (o.y0 + o.y1) / 2 },
  ];
  const atCorners = corners.map((c) => near(ink, c, r)).reduce((a, n) => a + n, 0);
  const atMids = mids.map((c) => near(ink, c, r)).reduce((a, n) => a + n, 0);

  // A diamond's own vertices are the midpoints; a box round it has its ink at the
  // corners instead. Both are measured from the SAME bounding box, so the claim
  // needs no expected pixel count of its own.
  check(
    atMids > 4 * atCorners,
    `the outline has ${atMids} pixels at its bounding box's edge midpoints and ${atCorners} at `
    + 'its corners — a turned square is a diamond, and this is the box around it',
  );

  return check.failures;
}
