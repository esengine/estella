// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  joint3d-gizmo — a 3D joint shows what it holds, and about what axis.
 *
 * A joint has no shape to see. Which body it holds and which axis it is free
 * about are only in the numbers, and the axis is the half that no position on
 * screen can imply — which is why this measures the picture's HEIGHT: the link
 * is horizontal by construction, so everything tall in it is the axis marker.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

/** The bob is 150 to the right of the anchor; the hinge axis is upright. */
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
      id: 1, name: 'Anchor', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: -75, y: 0, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 10, y: 10, z: 10 } } },
      ],
    },
    {
      id: 2, name: 'Bob', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 75, y: 0, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 2 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 10, y: 10, z: 10 } } },
        {
          type: 'HingeJoint3D',
          data: { connectedEntity: 1, anchor: { x: 0, y: 0, z: 0 }, axis: { x: 0, y: 1, z: 0 } },
        },
      ],
    },
  ],
}, null, 1);

export const name = 'joint3d-gizmo';
export const describes = 'a 3D joint is drawn in the viewport, link and free axis both';

/** Pixels near the joint gizmo colour (--gizmo-joint #c58cff): violet, so red and
 *  blue both well above green — nothing else in the viewport is. */
function jointBox(png) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  const x0 = Math.round(png.w * 0.04), x1 = Math.round(png.w * 0.62);
  const y0 = Math.round(png.h * 0.12), y1 = Math.round(png.h * 0.88);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = png.px(x, y);
      if (p[2] < 120 || p[0] < 80 || p[2] - p[1] < 40 || p[0] - p[1] < 20) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1, count };
}

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Joint3DGizmo', version: '1.0' }, null, 2),
    'assets/scenes/main.esscene': SCENE,
  });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(1200);
  const shot = await ed.screenshot('joint3d-on');

  const box = jointBox(shot);
  if (!check(box != null, 'no joint gizmo anywhere in the viewport')) return check.failures;
  if (!check(box.count > 60, `only ${box.count} joint pixels — nothing that could be a link`)) {
    return check.failures;
  }

  // The link spans 150 world units horizontally; the axis marker spans 120
  // vertically. A gizmo that drew the link alone would be a flat line.
  const ratio = box.h / box.w;
  check(
    ratio > 0.45 && ratio < 1.1,
    `the gizmo is ${box.w}×${box.h} (${ratio.toFixed(2)}) — with the 120-unit axis marker `
    + 'over a 150-unit link it should be roughly 0.8 tall; a flat one means the axis is missing',
  );

  // And it is the JOINT that is drawn, not the bodies: pointing it at nothing
  // takes the whole gizmo away.
  await ed.call('set_field', {
    entity: 2, component: 'HingeJoint3D', key: 'connectedEntity', type: 'entity', value: -1,
  }, 30000);
  await ed.sleep(900);
  const gone = jointBox(await ed.screenshot('joint3d-off'));
  check(
    (gone?.count ?? 0) < box.count * 0.25,
    `a joint connected to nothing still drew ${gone?.count ?? 0} of ${box.count} pixels — the `
    + 'gizmo is not reading the joint it claims to draw',
  );

  return check.failures;
}
