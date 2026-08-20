// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  depth-precision — a nearer surface hides a further one, at any zoom.
 *
 * Depth resolution goes as the distance squared over the near plane, so a near
 * plane fixed close to the eye spends the whole buffer on the first few units and
 * leaves the far half unable to tell surfaces apart. The editor's eye stands off
 * what it looks at, and that stand-off is the distance — so how close the near
 * plane may sit is a question about the zoom, not a constant.
 *
 * Two opaque quads in the same place, the further one submitted LAST so it wins
 * whenever depth cannot separate them, framed on a large scene and 200 units apart.
 * Both directions are asked, so a viewport that simply always drew the first one
 * would fail the control.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** Framed on this, the eye stands tens of thousands of units back. */
const PROJECT = JSON.stringify({
  formatVersion: '1',
  name: 'Depth Precision',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 120000, height: 90000 },
  spineVersion: 'none',
}, null, 2);

const quad = (id, name, z, colour) => ({
  id, name, parent: null, children: [], visible: true,
  components: [
    { type: 'Transform', data: { position: { x: 0, y: 0, z }, scale: { x: 300, y: 300, z: 1 } } },
    {
      type: 'Mesh2D',
      data: { mesh: 'builtin:quad', lit: false, opaque: true, cullBackfaces: false, color: colour },
    },
  ],
});

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    quad(1, 'Front', 0, { r: 1, g: 0, b: 0, a: 1 }),
    quad(2, 'Mover', -200, { r: 0, g: 0, b: 1, a: 1 }),
  ],
}, null, 1);

export const name = 'depth-precision';
export const describes = 'a nearer surface hides a further one even when the view is far out';

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

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

export async function run(ed) {
  const root = await makeProject({
    'assets/scenes/main.esscene': SCENE,
    'project.esproject': PROJECT,
  });
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.call('run_editor_command', { id: 'view.resetOrbit' }, 30000);
  await ed.sleep(1500);

  const behind = await ed.capture('depth-precision-behind');
  const front = count(behind, RED);
  const back = count(behind, BLUE);
  // Whether the pair is on screen at all, asked of BOTH: which one covers the other
  // is the question, and a guard on one of them answers it by accident.
  if (!check(front + back > 200, 'neither quad is on screen — the scene is not framed the way this check needs')) {
    return check.failures;
  }
  check(
    back === 0,
    `${back}px of a quad 200 units BEHIND another came through it, leaving ${front}px of the `
    + 'front one — at this stand-off the depth buffer cannot tell them apart',
  );

  // The control: move it in front and it must win, or the claim above would hold
  // for a viewport that simply always drew the first quad.
  await ed.call('set_field', {
    entity: 2, component: 'Transform', key: 'position', type: 'vec3', value: [0, 0, 200],
  }, 30000);
  await ed.sleep(1200);
  const ahead = await ed.capture('depth-precision-ahead');
  check(
    count(ahead, BLUE) > 200 && count(ahead, RED) === 0,
    `moved 200 units IN FRONT, the same quad covers ${count(ahead, BLUE)}px and leaves `
    + `${count(ahead, RED)}px of the other — depth is not what decided the first claim`,
  );

  return check.failures;
}
