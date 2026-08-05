// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  perspective — the editor's perspective eye, driven for real.
 *
 * Unit tests can prove editorCameraInfo builds a perspective matrix; they cannot
 * prove the toggle reaches the renderer. The store flag, the sync effect, the
 * engine resource and the renderer are four seams between the button and the
 * pixels, and every one of them can be wired wrong while every test stays green.
 *
 * So this opens a real editor against a copy of an example, captures the
 * viewport, runs the same command the toolbar button runs, and captures again.
 * "Different pixels" is necessary and not sufficient — a hidden panel would also
 * change them — so it also asks what only a projection can do: content off the
 * z = 0 plane moves, and content ON it does not, in the same frame.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** Two sprites, same size, one on the 2D plane and one well behind it. */
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
      id: 1, name: 'OnPlane', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: -200, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 120, y: 120 }, color: { r: 1, g: 0, b: 0, a: 1 } } },
      ],
    },
    {
      id: 2, name: 'Behind', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 200, y: 0, z: -400 } } },
        { type: 'Sprite', data: { size: { x: 120, y: 120 }, color: { r: 0, g: 1, b: 0, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'perspective';
export const describes = 'the 2D/3D toggle reaches the renderer, and only off-plane content moves';

/** Horizontal centre of the pixels matching `want`, or null when none are lit. */
function centroidX(png, want, tol = 60) {
  let sum = 0, n = 0;
  for (let y = 0; y < png.h; y += 2) {
    for (let x = 0; x < png.w; x += 2) {
      const p = png.px(x, y);
      if (Math.abs(p[0] - want[0]) <= tol && Math.abs(p[1] - want[1]) <= tol && Math.abs(p[2] - want[2]) <= tol) {
        sum += x; n++;
      }
    }
  }
  return n > 0 ? sum / n : null;
}

export async function run(ed) {
  // A real project (scripts, tsconfig, assets) with a scene of our own, so the
  // claim is about the projection rather than about one example's content.
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  const ortho = await ed.capture('perspective-ortho');
  const orthoOn = centroidX(ortho, [255, 0, 0]);
  const orthoBehind = centroidX(ortho, [0, 255, 0]);
  if (!check(orthoOn != null && orthoBehind != null, 'the orthographic capture shows neither sprite')) {
    return check.failures;
  }

  await ed.call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await ed.sleep(800);
  const persp = await ed.capture('perspective-3d');
  const perspOn = centroidX(persp, [255, 0, 0]);
  const perspBehind = centroidX(persp, [0, 255, 0]);
  if (!check(perspOn != null && perspBehind != null, 'the perspective capture shows neither sprite')) {
    return check.failures;
  }

  // The z = 0 sprite is where an orthographic view of the same framing puts it:
  // the editor view frames the scene camera, and on that plane the two
  // projections agree. A toggle that moved everything would be a zoom, not a
  // projection.
  check(
    Math.abs(perspOn - orthoOn) < ortho.w * 0.04,
    `the sprite ON the 2D plane moved from x=${orthoOn?.toFixed(0)} to ${perspOn?.toFixed(0)} — `
    + 'the toggle changed the framing rather than the projection',
  );

  // ...and the one at z = -400 is further from the centre of the frame under
  // perspective, because it is further away. That is the divide, and nothing
  // else in the editor can produce it.
  const centre = ortho.w / 2;
  check(
    Math.abs(perspBehind - centre) < Math.abs(orthoBehind - centre) * 0.95,
    `the sprite at z = -400 sits ${Math.abs(perspBehind - centre).toFixed(0)}px from the centre under `
    + `perspective and ${Math.abs(orthoBehind - centre).toFixed(0)}px orthographically — depth is not `
    + 'reaching the projection',
  );

  return check.failures;
}
