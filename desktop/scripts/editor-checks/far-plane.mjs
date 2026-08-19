// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  far-plane — the editor's eye can see the scene it is framed on.
 *
 * The perspective far plane is measured from the EYE, and a perspective eye stands
 * off the thing it looks at. Framed on a large scene that stand-off is tens of
 * thousands of units, all of it spent before the scene begins — so a reach that
 * does not account for it cuts away the far half of what the view was framed on.
 *
 * The orthographic eye of the same framing is the control: it shows the same
 * content, so anything the perspective one loses it lost to its own volume rather
 * than to being off-screen or too small to see.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** Framed on this, the eye stands far enough back for the stand-off to matter. */
const PROJECT = JSON.stringify({
  formatVersion: '1',
  name: 'Far Plane',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 120000, height: 90000 },
  spineVersion: 'none',
}, null, 2);

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 1, name: 'OnPlane', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: -30000, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 30000, y: 30000 }, color: { r: 0, g: 1, b: 0, a: 1 } } },
      ],
    },
    {
      id: 2, name: 'FarBack', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 30000, y: 0, z: -50000 } } },
        { type: 'Sprite', data: { size: { x: 60000, y: 60000 }, color: { r: 1, g: 0, b: 1, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'far-plane';
export const describes = "the 3D eye keeps the scene its framing put in front of it";

/** Pixels of a colour, sampled every other row and column. */
function count(png, want, tol = 60) {
  let n = 0;
  for (let y = 0; y < png.h; y += 2) {
    for (let x = 0; x < png.w; x += 2) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol
          && Math.abs(p[2] - want[2]) <= tol) n += 1;
    }
  }
  return n;
}

const GREEN = [0, 255, 0];
const MAGENTA = [255, 0, 255];

export async function run(ed) {
  const root = await makeProject({
    'assets/scenes/main.esscene': SCENE,
    'project.esproject': PROJECT,
  });
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.sleep(1000);

  const ortho = await ed.capture('far-plane-ortho');
  const orthoNear = count(ortho, GREEN);
  const orthoFar = count(ortho, MAGENTA);
  if (!check(orthoNear > 200 && orthoFar > 200,
      `the orthographic view shows ${orthoNear}px on the plane and ${orthoFar}px behind it — `
      + 'the scene is not framed the way this check needs')) {
    return check.failures;
  }

  // Held head-on, so the projection is the only thing that changed.
  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.call('run_editor_command', { id: 'view.resetOrbit' }, 30000);
  await ed.sleep(1200);
  const persp = await ed.capture('far-plane-persp');

  // On the plane the two projections agree, which is what says the framing held.
  const perspNear = count(persp, GREEN);
  check(
    Math.abs(perspNear - orthoNear) < orthoNear * 0.25,
    `the content ON the plane went from ${orthoNear}px to ${perspNear}px — the toggle changed `
    + 'the framing, so nothing below is about the far plane',
  );

  const perspFar = count(persp, MAGENTA);
  check(
    perspFar > orthoFar * 0.2,
    `the content 50000 units behind the plane went from ${orthoFar}px to ${perspFar}px — the far `
    + "plane is being measured from the eye, and the eye's stand-off has eaten it",
  );

  return check.failures;
}
