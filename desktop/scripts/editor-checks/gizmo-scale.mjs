// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  gizmo-scale — a world-sized gizmo is drawn at the size it is.
 *
 * A light's reach, a collider circle, a particle spawn disk: each is a LENGTH in the
 * world, and how long that is on screen depends only on where it stands. Turning it
 * into pixels by projecting an offset along one world axis instead measures that
 * axis's foreshortening — the same length shrinks as the eye turns to look down it,
 * and vanishes when it looks straight down it.
 *
 * A point light at the view's focus, measured head-on and again from the eye the 3D
 * toggle parks: the reach it is drawn at must not have moved, because neither the
 * light nor the zoom did.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, originIn, viewportRegion, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** One point light at the origin, with a reach big enough to measure. */
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Lamp', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        {
          type: 'Light2D',
          data: { type: 0, radius: 220, intensity: 1, enabled: true, color: { r: 1, g: 1, b: 1, a: 1 } },
        },
      ],
    },
  ],
}, null, 1);

export const name = 'gizmo-scale';
export const describes = 'a world-sized gizmo keeps its size when the eye turns';

/** How far from `c` the gizmo toggle painted anything. */
function reach(a, b, c, limit, tol = 25) {
  let far = 0;
  const x1 = Math.min(Math.min(a.w, b.w), c.x + limit);
  const y1 = Math.min(Math.min(a.h, b.h), c.y + limit);
  for (let y = Math.max(0, c.y - limit); y < y1; y++) {
    for (let x = Math.max(0, c.x - limit); x < x1; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > tol || Math.abs(p[1] - q[1]) > tol || Math.abs(p[2] - q[2]) > tol) {
        far = Math.max(far, Math.hypot(x - c.x, y - c.y));
      }
    }
  }
  return far;
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  // The design overlay belongs to UI mode, and the editor remembers its mode.
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(800);

  const measure = async (label, at) => {
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const off = await ed.screenshot(`${label}-off`);
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const on = await ed.screenshot(`${label}-on`);
    return reach(off, on, at, 260);
  };

  const first = await ed.screenshot('gizmo-scale-locate');
  // The light is at the origin, which is the view's focus, and the eye turns ABOUT
  // the focus — so one point serves both eyes, and only the head-on grid has the
  // straight axis lines it is read from.
  const origin = originIn(first, viewportRegion(first));
  if (!check(origin != null, "the grid's axis lines were not found — the light is at the origin")) {
    return check.failures;
  }

  const flat = await measure('gizmo-scale-flat', origin);
  if (!check(flat > 60, `head-on the light's reach is drawn ${flat.toFixed(0)}px across — it is not `
      + 'being drawn at all, so there is no size to compare')) {
    return check.failures;
  }

  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.sleep(1200);
  const turned = await measure('gizmo-scale-turned', origin);

  // Neither the light nor the zoom moved, so neither did the length.
  const drift = Math.abs(turned - flat) / flat;
  check(
    drift < 0.03,
    `the same reach measures ${flat.toFixed(0)}px head-on and ${turned.toFixed(0)}px from the `
    + `turned eye (${(drift * 100).toFixed(1)}% apart) — the length is being measured through one `
    + 'world axis, so it carries that axis\'s foreshortening',
  );

  return check.failures;
}
