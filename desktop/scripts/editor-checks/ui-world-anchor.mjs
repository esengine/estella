// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ui-world-anchor — in the editor, UI is content in the world, not a decal
 *        on the viewport.
 *
 * The UI layout box has a place as well as a size. In play that place is the
 * camera, so a HUD travels with it. In the editor there is no game camera, and
 * taking the place from the navigation view instead pins UI to the middle of the
 * panel: pan away and the UI slides along, leaving the design-frame overlay —
 * which is drawn at a fixed world spot — behind. Two things claiming to be the
 * same screen, drawn in different places.
 *
 * So: put UI and a sprite at the same world spot, frame something far away, and
 * require that they went out of view together.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

// A red UI badge centred in the design box, a green sprite beside it at the same
// depth, and a blue sprite far off to the right to pan to.
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 540, isActive: true, priority: 0 } },
      ],
    },
    {
      id: 1, name: 'Canvas', parent: null, children: [2], visible: true,
      components: [
        { type: 'Transform', data: {} },
        { type: 'Canvas', data: { designResolution: { x: 1920, y: 1080 }, scaleMode: 1 } },
        { type: 'UINode', data: {} },
      ],
    },
    {
      id: 2, name: 'Badge', parent: 1, children: [], visible: true,
      components: [
        { type: 'Transform', data: {} },
        {
          type: 'UINode',
          data: {
            position: 1,
            insetLeft: { value: 810, unit: 0 },
            insetTop: { value: 390, unit: 0 },
            width: { value: 300, unit: 0 },
            height: { value: 300, unit: 0 },
          },
        },
        { type: 'UIVisual', data: { visualType: 1, color: { r: 1, g: 0, b: 0, a: 1 }, enabled: true } },
      ],
    },
    {
      id: 3, name: 'FarAway', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 12000, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 400, y: 400 }, color: { r: 0, g: 0, b: 1, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'ui-world-anchor';
export const describes = 'editor UI stays where it is in the world when the view pans away';

/** How many pixels match `want`. */
function count(png, want, tol = 60) {
  let n = 0;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol && Math.abs(p[2] - want[2]) <= tol) n++;
    }
  }
  return n;
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(1200);

  const before = await ed.capture('ui-world-anchor-before');
  const badgeBefore = count(before, [255, 0, 0]);
  if (!check(badgeBefore > 200, `the UI badge is not on screen to begin with (${badgeBefore} px)`)) {
    return check.failures;
  }

  // Frame the far-away sprite: the navigation view leaves the origin entirely.
  const tree = await ed.json('get_scene_tree', {}, 30000);
  const target = tree.find((e) => e.name === 'FarAway')?.id;
  if (!check(target != null, 'the scene tree does not report the FarAway sprite')) return check.failures;

  await ed.call('select', { id: target }, 20000);
  await ed.call('run_editor_command', { id: 'view.frameSelected' }, 20000);
  await ed.sleep(900);

  const after = await ed.capture('ui-world-anchor-after');
  const badgeAfter = count(after, [255, 0, 0]);

  check(
    badgeAfter < badgeBefore / 8,
    `the UI badge is still filling ${badgeAfter} px after the view panned 12000 units away `
    + `(was ${badgeBefore}) — UI is being laid out around the navigation view instead of at its `
    + 'place in the world, so it slides with every pan and leaves the design frame behind',
  );
  // The pan really did happen: the sprite it framed is what is on screen now.
  check(count(after, [0, 0, 255]) > 200, 'framing the far sprite did not bring it into view — the pan never happened');
  return check.failures;
}
