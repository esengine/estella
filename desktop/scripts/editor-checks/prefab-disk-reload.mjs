// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  prefab-disk-reload — the OPEN DOCUMENT reconciles with disk, both kinds.
 *
 * A scene changed on disk while open (an external editor, a git checkout, a build
 * step) is reloaded: seamless when clean, discard-guarded when not. Prefab Mode
 * had none of that, and the reason was one line — the watcher asked
 * `isOpenScenePath`, which reads `currentScene`, which is null while a prefab is
 * open. So the editor kept the tree it had flattened at open, and the next Save
 * wrote it over whatever had arrived, without a word.
 *
 * Same shape as the guard that only saw the scene's dirt: the machinery existed,
 * and the code deciding whether to run it was written per document KIND.
 *
 * This drives it end to end: enter Prefab Mode, rewrite the `.esprefab` from
 * outside, and require the editor's tree to show what the file now says.
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

export const name = 'prefab-disk-reload';
export const describes = 'a prefab rewritten on disk while open in Prefab Mode is reloaded, not overwritten';

/** Poll until `read` reports true, or give up. The reload is watcher-driven —
 *  a debounce, an incremental rescan and a re-flatten — so it is not immediate. */
async function until(ed, read, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    if (await read()) return true;
    if (Date.now() - t0 > ms) return false;
    await ed.sleep(250);
  }
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');
  await ed.call('create_prefab_from_entity', { entity: 1 }, 60000);

  const prefabPath = 'assets/prefabs/Turret.esprefab';
  const before = await ed.json('read_project_file', { path: prefabPath });
  if (!check(typeof before === 'string' && before.includes('Turret'), `no prefab at ${prefabPath}`)) {
    return check.failures;
  }

  await ed.call('open_asset', { path: prefabPath }, 60000);
  const doc = await ed.json('get_document', {});
  if (!check(doc?.kind === 'prefab', `open_asset left the document as ${doc?.kind}`)) return check.failures;
  // Entering Prefab Mode adopts a fresh document, so nothing is unsaved yet. That
  // matters: a dirty document would put up a discard prompt with nobody to answer.
  check(doc?.dirty === false, `Prefab Mode opened dirty (${doc?.dirty}) — the reload would prompt`);

  const named = async (want) => {
    const tree = await ed.json('get_scene_tree', {});
    const walk = (ns) => (ns ?? []).some((n) => n.name === want || walk(n.children));
    return walk(tree);
  };
  check(await named('Turret'), 'the prefab did not open showing its own entity');

  // The external edit: same file, one name changed, written by someone who is not
  // the editor's own Save.
  await ed.call('write_project_file', {
    path: prefabPath,
    content: before.replace(/"Turret"/g, '"TurretReloaded"'),
  }, 60000);

  const reloaded = await until(ed, () => named('TurretReloaded'));
  check(reloaded, 'the prefab changed on disk and Prefab Mode kept showing the stale tree');

  // And the way out still works — a reload re-enters Prefab Mode, which must carry
  // the return scene forward rather than stranding the editor on a blank one.
  if (reloaded) {
    const after = await ed.json('get_document', {});
    check(after?.kind === 'prefab' && after?.path === prefabPath,
      `after the reload the document is ${JSON.stringify({ kind: after?.kind, path: after?.path })}`);
    await ed.call('exit_prefab_mode', { discardChanges: true }, 60000);
    const back = await ed.json('get_document', {});
    check(back?.kind === 'scene' && !!back?.path, `leaving Prefab Mode landed on ${JSON.stringify(back)}`);
  }

  return check.failures;
}
