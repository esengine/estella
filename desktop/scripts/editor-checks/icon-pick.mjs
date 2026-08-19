// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  icon-pick — clicking the icon an entity is drawn as selects it.
 *
 * A camera, a light and an empty draw nothing of their own; the editor draws an
 * icon for them, and that icon is a fixed number of pixels wherever it stands. The
 * box a click hits has to be the same size, and a world size can only match it at
 * one zoom.
 *
 * The project is framed on a very large design rect, so the world is many units per
 * pixel — where a world-sized target has shrunk to under a pixel while the icon on
 * screen has not moved. The icon locates itself: the camera is at the origin and
 * its gizmo is the only thing the gizmo toggle paints, so that ink's centre is where
 * the camera projects.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, originIn, viewportRegion, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** A design rect big enough that one pixel is tens of world units once framed. */
const PROJECT = JSON.stringify({
  formatVersion: '1',
  name: 'Icon Pick',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 16000, height: 12000 },
  spineVersion: 'none',
}, null, 2);

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
  ],
}, null, 1);

export const name = 'icon-pick';
export const describes = 'an entity drawn as an icon is clickable where the icon is';

export async function run(ed) {
  const root = await makeProject({
    'assets/scenes/main.esscene': SCENE,
    'project.esproject': PROJECT,
  });
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  // Scene mode: the design overlay belongs to UI mode, and the editor remembers
  // the mode across sessions — with it on, its frame is the ink the toggle paints.
  await ed.call('run_editor_command', { id: 'mode.scene' }, 30000);
  await ed.call('run_editor_command', { id: 'tool.select' }, 30000);
  await ed.call('select', { id: null }, 30000);
  await ed.sleep(800);

  const shot = await ed.screenshot('icon-pick');
  const origin = originIn(shot, viewportRegion(shot));
  if (!check(origin != null, "the grid's axis lines were not found — the camera is at the origin")) {
    return check.failures;
  }
  const { x: cx, y: cy } = origin;

  const at = async (dx, dy) => ed.json('pick', { clientX: cx + dx, clientY: cy + dy }, 30000);
  const centre = await at(0, 0);
  if (!check(centre === 0, `a click on the icon picked ${JSON.stringify(centre)}, not the camera`)) {
    return check.failures;
  }

  // How far from the icon a click still selects it. The icon is drawn 15px across,
  // so its target is about that; a world-sized one at this zoom is under a pixel.
  let reach = 0;
  while (reach < 40 && (await at(reach + 1, 0)) === 0) reach += 1;
  check(
    reach >= 6 && reach <= 20,
    `a click selects the camera up to ${reach}px from its icon, which is drawn 15px across — `
    + 'the target is not the size of the thing it is a target for',
  );

  return check.failures;
}
