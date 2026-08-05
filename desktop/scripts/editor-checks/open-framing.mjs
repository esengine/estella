// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  open-framing — opening a project shows you the game's own frame.
 *
 * The editor camera is a FREE camera whose default size is a constant that knows
 * nothing about the project, and no view is persisted — so every open started
 * there. On a viewport narrower than the design aspect that leaves the design
 * rect off screen: the scene reads as wrong in the editor and snaps right the
 * moment you press Play, which letterboxes. The two were never the same framing,
 * and nothing in a unit test can see that.
 *
 * So: open against a narrow viewport, and ask whether what the game will show is
 * inside what the editor is showing.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** One sprite the size of the 800×600 design rect, so "is the design rect
 *  visible" becomes "is the sprite whole". */
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
      id: 1, name: 'DesignRect', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 800, y: 600 }, color: { r: 1, g: 0, b: 0, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'open-framing';
export const describes = 'opening a project frames the design rect, on a viewport of any shape';

/** Bounding box of pixels near `want`, or null when none are lit. */
function bbox(png, want, tol = 60) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol && Math.abs(p[2] - want[2]) <= tol) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  // The viewport can only be resized once a render host exists, and an open
  // rebuilds the dock layout — so the order is: open (canvas appears), shape the
  // panel, then open AGAIN, which is the path under test.
  await ed.open(root, 'assets/scenes/main.esscene');
  // Portrait, and narrower than the 4:3 design — the shape that lost the frame.
  await ed.call('resize_viewport', { width: 420, height: 720 }, 30000);
  await ed.sleep(600);
  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(1200);

  const shot = await ed.capture('open-framing-narrow');
  const rect = bbox(shot, [255, 0, 0]);
  if (!check(rect != null, 'the design-sized sprite is not visible at all after opening')) {
    return check.failures;
  }

  // Whole, not merely present: clipping shows up as the sprite touching an edge
  // of the viewport, which is exactly what a fit-height framing produced.
  check(
    rect.minX > 0 && rect.maxX < shot.w - 1,
    `the design rect runs off the sides (x ${rect.minX}..${rect.maxX} of ${shot.w}) — the editor `
    + 'is framing to the viewport height, so the game\'s own frame is off screen until you press Play',
  );
  check(
    rect.minY > 0 && rect.maxY < shot.h - 1,
    `the design rect runs off the top or bottom (y ${rect.minY}..${rect.maxY} of ${shot.h})`,
  );
  // And it is not squashed on the way in: 800×600 stays 4:3 whatever the panel is.
  const ratio = rect.w / rect.h;
  check(
    Math.abs(ratio - 800 / 600) < 0.08,
    `the design rect came out ${rect.w}×${rect.h} (${ratio.toFixed(2)}) rather than 4:3 — the editor `
    + 'projection is stretching content to the panel',
  );
  return check.failures;
}
