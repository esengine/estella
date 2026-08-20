// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  physics3d-play — a 3D character falls in the RUNNING game.
 *
 * check-physics3d proves the solver and the unit test proves the wiring, both
 * against a module handed to them. This is the only place that answers whether a
 * scene carrying 3D components actually gets the world: the play realm is what
 * loads a side module and installs a plugin, and the editor's own scene path
 * never does either. Something could be right everywhere else and a project
 * would still open with a character hanging in the air.
 */
import { makeProject, checker } from '../lib/editorDriver.mjs';

export const name = 'physics3d-play';
export const describes = 'a scene with 3D physics components gets the 3D world when it runs';

/** A floor and a character above it, in world units (100 to the metre). */
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
      id: 1, name: 'Ground', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: -100, z: 0 } } },
        { type: 'RigidBody3D', data: { bodyType: 0 } },
        { type: 'BoxCollider3D', data: { halfExtents: { x: 300, y: 10, z: 100 } } },
      ],
    },
    {
      id: 2, name: 'Hero', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 200, z: 0 } } },
        { type: 'CharacterController3D', data: { radius: 30, halfHeight: 50 } },
      ],
    },
  ],
}, null, 1);

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Physics3D', version: '1.0' }, null, 2),
    'assets/scenes/main.esscene': SCENE,
  });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.play();

  const hero = async () => (await ed.json('play_probe', {
    code: 'const c = find("CharacterController3D")[0];'
        + ' if (!c) return null;'
        + ' const t = get(c.entity, "Transform");'
        + ' const s = get(c.entity, "CharacterController3D");'
        + ' return { y: t.position.y, onFloor: s.isOnFloor };',
  }, 60000));

  const start = await hero();
  if (!check(start != null, 'the running world has no CharacterController3D')) {
    return check.failures;
  }

  // Two seconds is far more than the 0.65s the drop takes, so this is "it has
  // settled", not "it is partway down".
  for (let i = 0; i < 12 && !(await hero())?.onFloor; i++) await ed.sleep(250);
  const landed = await hero();

  // The floor's top is at -90 and the character's own half-height is 80, so it
  // comes to rest at -10. A world that never loaded leaves it at the 200 the
  // scene put it at — the two are not near each other.
  check(landed?.onFloor === true, `the character never reached the ground (y=${landed?.y})`);
  check(Math.abs((landed?.y ?? 0) + 10) < 12,
        `it rests at y=${landed?.y?.toFixed(2)}, want -10 (floor top -90 + half-height 80)`);
  return check.failures;
}
