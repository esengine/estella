// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  light-aim — a light's aim arrow is drawn through the view, like every arrow.
 *
 * A light points along its entity's forward, which is a direction in space. The
 * arrow for it has to be that direction PROJECTED, and taking the world x and y as
 * if they were the screen's is right only from the head-on eye.
 *
 * An unrotated light aims into the screen. Head-on that projects to nothing and
 * there is no arrow to draw — the honest picture. Turn the eye and the same aim
 * becomes a direction on screen, so an arrow must appear. Both claims are made: a
 * gizmo built from world x/y draws no arrow either way and fails the second.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, originIn, viewportRegion, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** One directional light at the origin, unrotated: it aims along −Z, into the screen. */
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Sun', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        {
          type: 'Light2D',
          data: { type: 1, intensity: 1, enabled: true, color: { r: 1, g: 1, b: 1, a: 1 } },
        },
      ],
    },
  ],
}, null, 1);

export const name = 'light-aim';
export const describes = "a light's aim is drawn as the view sees that direction";

/** How far from `c` the gizmo toggle painted anything, in pixels. */
function reach(a, b, c, limit, tol = 25) {
  let far = 0;
  const x0 = Math.max(0, c.x - limit);
  const x1 = Math.min(Math.min(a.w, b.w), c.x + limit);
  const y0 = Math.max(0, c.y - limit);
  const y1 = Math.min(Math.min(a.h, b.h), c.y + limit);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
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

  /** How far the light's chrome reaches from `at`, for the current eye. */
  const measure = async (label, at) => {
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const off = await ed.screenshot(`${label}-off`);
    await ed.call('run_editor_command', { id: 'view.toggleGizmos' }, 30000);
    await ed.sleep(700);
    const on = await ed.screenshot(`${label}-on`);
    return { reach: reach(off, on, at ?? originIn(on, viewportRegion(on)), 70), shot: on };
  };

  const first = await ed.screenshot('light-aim-locate');
  // The light is at the origin, which is the view's focus, and the eye turns ABOUT
  // the focus — so this point serves both eyes, and only the head-on grid has the
  // straight axis lines it is read from.
  const origin = originIn(first, viewportRegion(first));
  if (!check(origin != null, "the grid's axis lines were not found — the light is at the origin")) {
    return check.failures;
  }
  const flat = (await measure('light-aim-flat', origin)).reach;
  // Head-on the light aims at the eye: an icon and nothing else.
  check(flat < 20, `head-on the light's chrome reaches ${flat.toFixed(0)}px, past its own icon — `
    + 'an aim pointing at the eye is being drawn as a direction it does not have');

  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.sleep(1200);
  const turned = (await measure('light-aim-turned', origin)).reach;
  // The arrow is drawn a fixed 38px long, so from a turned eye the chrome reaches
  // well past the icon it reached to before.
  check(turned > 25, `from a turned eye the light's chrome reaches only ${turned.toFixed(0)}px — `
    + 'the aim is not being projected, so a direction into the screen stays invisible');

  return check.failures;
}
