// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  physics3d-debug-draw — the RUNNING game can show its own 3D shapes.
 *
 * The editor gizmo answers "is this box the size I meant"; this answers "why did
 * the player get stuck there", which only the running game can be asked. The
 * editor hides every one of its overlays in play, so a wireframe on screen here
 * can only have been drawn by the engine — which is what makes the picture worth
 * measuring rather than merely counting.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

/** One static box seen through a PERSPECTIVE camera, which is what makes the
 *  picture answer whether the lines carry depth: the near face draws wider than
 *  the far one, so a scan across the middle crosses FOUR uprights. Drop the z
 *  and the faces coincide, leaving every other measure unchanged. */
const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 600 } } },
        {
          type: 'Camera',
          data: {
            projectionType: 0, fov: 60, nearPlane: 10, farPlane: 2000,
            isActive: true, priority: 0,
          },
        },
      ],
    },
    {
      id: 1, name: 'Wall', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 100, y: 25, z: 100 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'physics3d-debug-draw';
export const describes = 'a running 3D game draws its own collider shapes when asked';

/** Pixels near the static-body colour (0.2, 0.4, 1.0) — blue, well above both
 *  other channels. Nothing else in a play viewport of an empty scene is. */
function shapeBox(png) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (p[2] < 140 || p[2] - p[0] < 90 || p[2] - p[1] < 60) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

/** Runs of shape-coloured pixels along one row — how many uprights it crosses. */
function runsAcross(png, y, x0, x1) {
  let runs = 0;
  let inside = false;
  for (let x = x0; x <= x1; x++) {
    const p = png.px(x, y);
    const lit = p[2] >= 140 && p[2] - p[0] >= 90 && p[2] - p[1] >= 60;
    if (lit && !inside) runs++;
    inside = lit;
  }
  return runs;
}

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'DebugDraw3D', version: '1.0' }, null, 2),
    'assets/scenes/main.esscene': SCENE,
  });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('set_play', { state: 'playing' }, 120000);

  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    ready = (await ed.json('get_play_state', {}))?.ready === true;
    if (!ready) await ed.sleep(500);
  }
  if (!check(ready, 'the play realm never reported ready')) return check.failures;

  await ed.call('play_probe', { code: 'await step(3); return true;' }, 60000);
  await ed.sleep(600);
  const before = shapeBox(await ed.screenshot('debug3d-off', { crop: 'game' }));
  if (!check((before?.count ?? 0) < 40,
    `${before?.count} shape-coloured pixels before anything asked for them — the overlay `
    + 'is drawing itself, or an editor gizmo is still on screen in play')) {
    return check.failures;
  }

  const on = await ed.json('play_probe', {
    code: 'setResource("Physics3DDebugDraw", { enabled: true });'
        + ' await step(3);'
        + ' return resource("Physics3DDebugDraw");',
  }, 60000);
  if (!check(on?.enabled === true, `the resource did not take the write: ${JSON.stringify(on)}`)) {
    return check.failures;
  }
  await ed.sleep(600);

  const shot = await ed.screenshot('debug3d-on', { crop: 'game' });
  const box = shapeBox(shot);
  if (!check(box != null && box.count > 100,
    `only ${box?.count ?? 0} wireframe pixels after turning the overlay on`)) {
    return check.failures;
  }

  // ★ Four uprights across the middle: the near face and the far one, drawn at
  // the different sizes perspective gives them. Two would mean the lines reached
  // the GPU without their depth and the box collapsed into a rectangle.
  const uprights = runsAcross(shot, Math.round((box.minY + box.maxY) / 2),
                              box.minX - 2, box.maxX + 2);
  check(
    uprights === 4,
    `a scan across the middle crossed ${uprights} uprights rather than 4 — the near and far `
    + 'faces are not being drawn at different sizes, so the lines carry no depth',
  );

  return check.failures;
}
