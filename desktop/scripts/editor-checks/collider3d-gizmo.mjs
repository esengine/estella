// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  collider3d-gizmo — a 3D collider can be seen, and it is seen in 3D.
 *
 * The geometry is unit-tested. What no unit test reaches is the rest of the
 * chain: the editor world carrying the 3D components, the per-frame projection,
 * and the overlay's paths. The gizmo is DOM over the canvas, so only the
 * composited window can see it at all.
 *
 * The scene is a box turned 90° about X, with three different half-extents. That
 * makes the picture answer more than "something was drawn": a correct projection
 * turns the 200-deep half into the tall one (400×200 on screen, a 2:1 box),
 * while the flattening this codebase has produced three times before — reading
 * the quaternion as one Z angle — would draw 40 wide and 200 tall instead.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

/** sin/cos of 45° — a quarter turn about X, so the box's depth becomes its height. */
const S = Math.SQRT1_2;

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
      id: 1, name: 'Block', parent: null, children: [], visible: true,
      components: [
        {
          type: 'Transform',
          data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: S, y: 0, z: 0, w: S } },
        },
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 50, y: 10, z: 100 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'collider3d-gizmo';
export const describes = 'a 3D collider is drawn in the viewport, turned the way the entity is';

/** The gizmo colour (--gizmo-collider #00dc82) over the viewport's dark ground:
 *  strongly green, and green far above both other channels. */
function greenBox(png, minGreen) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < png.h; y++) {
    for (let x = 0; x < png.w; x++) {
      const p = png.px(x, y);
      if (p[1] < minGreen || p[1] - p[0] < 60 || p[1] - p[2] < 25) continue;
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
    'project.esproject': JSON.stringify({ name: 'Collider3D', version: '1.0' }, null, 2),
    'assets/scenes/main.esscene': SCENE,
  });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.sleep(1200);
  const drawn = await ed.screenshot('collider3d-on', { crop: 'game' });

  const box = greenBox(drawn, 110);
  if (!check(box != null, 'no collider wireframe anywhere in the viewport')) return check.failures;
  // Low enough that a wrongly-projected box still gets measured below: "it drew
  // something" is not the claim, "it drew this shape" is.
  if (!check(box.count > 40,
    `only ${box.count} wireframe pixels — nothing that could be a box outline`)) {
    return check.failures;
  }

  // A ratio taken over a handful of pixels is quantisation, not a shape: at 14px
  // wide one pixel of edge is 0.15 of the answer. Said outright, because the
  // measurement that follows would otherwise report a made-up number.
  if (!check(box.w >= 24,
    `the wireframe is ${box.w}x${box.h} in a ${drawn.w}x${drawn.h} viewport — too few `
    + 'pixels across to measure a shape')) {
    return check.failures;
  }

  // 100 wide × 200 tall in world units once the quarter turn about X is applied.
  const ratio = box.h / box.w;
  check(
    Math.abs(ratio - 2) < 0.3,
    `the wireframe came out ${box.w}×${box.h} (${ratio.toFixed(2)}:1) rather than 2:1 — the `
    + 'entity rotation is not reaching the shape in three axes',
  );

  // The same shape with no body behind it is drawn as authored-but-absent: still
  // visible to edit, unmistakably not what the world will collide with. Without
  // this, `active` could be computed and thrown away.
  await ed.call('set_field', {
    entity: 1, component: 'RigidBody3D', key: 'enabled', type: 'bool', value: false,
  }, 30000);
  await ed.sleep(900);
  const off = await ed.screenshot('collider3d-inactive', { crop: 'game' });
  const dim = greenBox(off, 110);
  const dimCount = dim?.count ?? 0;
  check(
    dimCount < box.count * 0.5,
    `disabling the rigid body left ${dimCount} of ${box.count} solid wireframe pixels — a shape `
    + 'the world does not build is being drawn as if it does',
  );
  // ...and it did not simply vanish: the geometry is still there to author.
  const faint = greenBox(off, 55);
  check(
    (faint?.count ?? 0) > 60,
    `the wireframe disappeared entirely (${faint?.count ?? 0} faint pixels) — a disabled body `
    + 'should dim its shape, not hide it',
  );

  return check.failures;
}
