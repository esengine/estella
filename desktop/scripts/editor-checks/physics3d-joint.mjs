// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  physics3d-joint — a joint authored in a scene holds in the running game.
 *
 * The module's own checks prove the solver builds constraints and the unit tests
 * prove the wiring converts units. Neither answers whether a joint SURVIVES the
 * trip: the joint components are TypeScript ones, so a scene has to carry them
 * through load, entity-reference remapping and the plugin's per-step sync before
 * anything holds. Everything else could be right and a door would still fall off.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

/** A static anchor and a bob hung 150 units to its right by a hinge. */
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
        { type: 'Transform', data: { position: { x: 0, y: 200, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 20, y: 20, z: 20 } } },
      ],
    },
    {
      id: 2, name: 'Bob', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 150, y: 200, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 2, linearDamping: 0.4, angularDamping: 0.4 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 20, y: 20, z: 20 } } },
        {
          type: 'HingeJoint3D',
          data: {
            connectedEntity: 1,
            anchor: { x: -150, y: 0, z: 0 },   // the anchor's position, in Bob's frame
            axis: { x: 0, y: 0, z: 1 },
          },
        },
      ],
    },
  ],
}, null, 1);

export const name = 'physics3d-joint';
export const describes = 'a 3D joint authored in a scene holds two bodies together when it runs';

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Joint3D', version: '1.0' }, null, 2),
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

  const bob = async () => (await ed.json('play_probe', {
    code: 'const e = find("HingeJoint3D")[0];'
        + ' if (!e) return null;'
        + ' const t = get(e.entity, "Transform");'
        + ' const j = get(e.entity, "HingeJoint3D");'
        + ' return { x: t.position.x, y: t.position.y, z: t.position.z, angle: j.angle };',
  }, 60000));

  const start = await bob();
  if (!check(start != null, 'the running world has no HingeJoint3D')) return check.failures;

  // Three seconds: far past the swing, and far past the two metres a free body
  // falls in that time.
  await ed.sleep(3000);
  const now = await bob();
  if (!check(now != null, 'the jointed entity went missing while it ran')) return check.failures;

  const reach = Math.hypot(now.x - 0, now.y - 200, now.z - 0);
  check(
    Math.abs(reach - 150) < 20,
    `the bob is ${reach.toFixed(1)} units from the anchor rather than 150 — the joint is not `
    + 'holding it (a body in free fall keeps going)',
  );
  check(now.y < 150, `the bob never swung down (y=${now.y.toFixed(1)} of 200)`);
  // The hinge reports where it is, which is the readback half of the same wiring.
  check(
    Math.abs(now.angle) > 0.5,
    `the hinge reports an angle of ${now.angle.toFixed(3)} after swinging a quarter turn`,
  );

  return check.failures;
}
