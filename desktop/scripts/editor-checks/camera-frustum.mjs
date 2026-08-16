// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  camera-frustum — a camera's view volume reaches the viewport.
 *
 * The geometry is unit-tested (frustumCornersWorld, cameraFrustumCorners,
 * frustumPlaneCrossings). What no unit test can say is whether the field, the
 * per-frame projection and the overlay's paths are still connected: the gizmo is
 * DOM over the canvas, so `capture_viewport` cannot see it and only the
 * composited window can.
 *
 * A perspective camera is what makes the claim testable — its near and far faces
 * are different sizes, so the volume is pixels the framing outline alone never
 * draws. Under an orthographic camera seen head-on they would coincide.
 */
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

/** One perspective camera, well off the content plane, plus something to look at. */
const SCENE = JSON.stringify({
  version: 1, name: 'Main',
  entities: [
    {
      id: 0, name: 'Cam', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 400 } } },
        {
          type: 'Camera',
          data: {
            projectionType: 0, fov: 60, nearPlane: 50, farPlane: 700,
            isActive: true, priority: 0,
          },
        },
      ],
    },
    {
      id: 1, name: 'Marker', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 60, y: 60 }, color: { r: 0.2, g: 0.6, b: 0.3, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'camera-frustum';
export const describes = "a camera's view volume is drawn when, and only when, the camera asks";

/**
 * Pixels that differ between two captures, counted over the viewport only — the
 * title bar, the panels and a toast all change on their own schedule, and a
 * whole-window count would drown a thin dashed outline in that.
 */
function changedPixels(a, b) {
  let n = 0;
  const y1 = Math.round(Math.min(a.h, b.h) * 0.7);
  const x1 = Math.round(Math.min(a.w, b.w) * 0.55);
  for (let y = Math.round(Math.min(a.h, b.h) * 0.18); y < y1; y++) {
    for (let x = Math.round(Math.min(a.w, b.w) * 0.05); x < x1; x++) {
      const p = a.px(x, y);
      const q = b.px(x, y);
      if (Math.abs(p[0] - q[0]) > 8 || Math.abs(p[1] - q[1]) > 8 || Math.abs(p[2] - q[2]) > 8) n++;
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

  const showFrustum = (on) =>
    ed.call('set_field', { entity: 0, component: 'Camera', key: 'showFrustum', type: 'bool', value: on }, 30000);

  const off = await ed.screenshot('frustum-off');
  await showFrustum(true);
  await ed.sleep(800);
  const on = await ed.screenshot('frustum-on');

  const drawn = changedPixels(off, on);
  if (!check(drawn > 200, `turning showFrustum on changed ${drawn} pixels — the volume is not being drawn`)) {
    return check.failures;
  }

  // ...and the field is what draws it. Without this a viewport that redrew
  // something else on every set_field would pass the first claim.
  await showFrustum(false);
  await ed.sleep(800);
  const back = await ed.screenshot('frustum-back');
  check(
    changedPixels(off, back) < drawn / 5,
    `turning showFrustum back off left ${changedPixels(off, back)} pixels changed against the `
    + `original ${drawn} — the volume is not what came and went`,
  );

  return check.failures;
}
