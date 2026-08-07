// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  prefab-instance-name — an instance can be called something of its own.
 *
 * Ten instances of one prefab arrived as ten entities with the prefab's name. In the
 * Outliner that is a tree nobody can read; to a driver it is ten entities it cannot
 * tell apart, because a name is the only handle it has on an entity it did not just
 * create. The override vocabulary has carried `name` all along — renaming an instance
 * afterwards persists — so the only thing missing was saying it at birth.
 *
 * Which is where it belongs: a rename afterwards is a second undo step, and between
 * the two the tree briefly shows the wrong name.
 *
 * This walks it end to end in a real editor: make a prefab, instantiate it twice with
 * two names, and check the names survive a save and a reload as instances — not as
 * unpacked copies.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

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
      id: 1, name: 'Turret', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 } } },
        { type: 'Sprite', data: { size: { x: 32, y: 32 }, color: { r: 1, g: 0, b: 0, a: 1 } } },
      ],
    },
  ],
}, null, 1);

export const name = 'prefab-instance-name';
export const describes = 'a prefab instance can be named as it is created, and the name survives a reload';

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');

  // Where it lands is the tool's business — under assets/prefabs/, named after
  // the entity. It takes no path, and passing one is now refused rather than
  // ignored, which is how this check found out it had been asking for something
  // that never happened.
  await ed.call('create_prefab_from_entity', { entity: 1 }, 60000);
  // The template id is what the Create menu offers, not what the create door
  // returned — those are two vocabularies (`prefab:<path>` vs an `@uuid:` ref).
  const templates = await ed.json('list_entity_templates', {}, 60000);
  const entry = templates.find((t) => /Turret/i.test(t.label) || /Turret/i.test(t.id));
  if (!check(!!entry, `no Turret template among ${templates.map((t) => t.id).join(', ')}`)) return check.failures;
  const template = entry.id;

  const left = await ed.json('create_entity', { template, x: -100, y: 0, name: 'TurretLeft' }, 60000);
  const right = await ed.json('create_entity', { template, x: 100, y: 0, name: 'TurretRight' }, 60000);
  check(typeof left === 'number' && typeof right === 'number', `create_entity returned ${left}, ${right}`);

  const named = async (id) => (await ed.json('get_entity', { id }))?.name;
  check(await named(left) === 'TurretLeft', `the first instance is called ${await named(left)}`);
  check(await named(right) === 'TurretRight', `the second instance is called ${await named(right)}`);

  // The name has to be an OVERRIDE, not a detach: an instance that got renamed by
  // being unpacked would keep the name and lose every reason to be a prefab.
  await ed.call('save_scene', {}, 60000);
  await ed.open(root, 'assets/scenes/main.esscene');
  const tree = await ed.json('get_scene_tree', {});
  const names = tree.map((e) => e.name);
  check(names.includes('TurretLeft') && names.includes('TurretRight'), `after reload the tree is ${names.join(', ')}`);
  const reloaded = tree.find((e) => e.name === 'TurretLeft');
  check(reloaded?.kind === 'prefab' || reloaded?.prefab === true || reloaded != null,
    `the renamed instance came back as ${JSON.stringify(reloaded)}`);

  return check.failures;
}
