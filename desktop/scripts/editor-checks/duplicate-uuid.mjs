// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  duplicate-uuid — two files cannot be the same asset.
 *
 * A `.meta`'s uuid is the identity every stored reference is written against, and
 * nothing checked that two of them were not the same. Assets that arrive in bulk
 * are exactly where that happens: a folder copied in with its sidecars, a script
 * that stamped one uuid into every meta it wrote, a duplicated file.
 *
 * The failure is silent and looks like a rendering bug. `pathToUuid` is per-path so
 * a drag reads the right uuid; `uuidToPath` keeps one winner, so resolving it hands
 * back some OTHER file. The Content Browser preview reads the path it selected and
 * is right; the sprite in the scene reads the ref and is a different picture — which
 * is exactly how it was reported: "what I dropped is not what I see".
 */
import path from 'node:path';
import { cp, writeFile } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');
const SHARED_UUID = '11111111-2222-3333-4444-555555555555';

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [{
    id: 0, name: 'Camera', parent: null, children: [], visible: true,
    components: [
      { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
      { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
    ],
  }],
}, null, 1);

const meta = (uuid) => JSON.stringify({ uuid, version: '1.0', type: 'texture', importer: {} }, null, 2);

export const name = 'duplicate-uuid';
export const describes = 'two assets that carry the same uuid are caught, not silently merged';

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  // Two DIFFERENT pictures, stamped with one identity.
  await cp(path.join(EXAMPLE, 'assets', 'textures', 'star.png'), path.join(root, 'assets', 'dupA.png'));
  await cp(path.join(EXAMPLE, 'assets', 'textures', 'arrow.png'), path.join(root, 'assets', 'dupB.png'));
  await writeFile(path.join(root, 'assets', 'dupA.png.meta'), meta(SHARED_UUID));
  await writeFile(path.join(root, 'assets', 'dupB.png.meta'), meta(SHARED_UUID));
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');

  const listed = await ed.json('list_assets', { match: 'dup' }, 60000);
  const rows = listed?.assets ?? [];
  check(rows.length === 2, `expected both files in the registry, got ${JSON.stringify(rows)}`);
  const refs = new Set(rows.map((a) => a.ref));
  check(
    refs.size === rows.length,
    `${rows.length} files share ${refs.size} ref(s): ${rows.map((a) => `${a.path}=${a.ref}`).join(', ')} `
    + '— a ref that names two files resolves to whichever the scan saw last',
  );

  // And end to end: a sprite pointed at ONE of them must show that one.
  await ed.call('apply_scene_ops', {
    ops: [{
      op: 'create', ref: 'sprite', name: 'Dropped', components: ['Transform', 'Sprite'],
      fields: { 'Sprite.texture': 'assets/dupA.png' },
    }],
    label: 'drop dupA',
  }, 60000);
  const tree = await ed.json('get_scene_tree', {});
  const dropped = tree.find((e) => e.name === 'Dropped');
  if (!check(!!dropped, 'the sprite was not created')) return check.failures;

  const inspector = await ed.json('get_inspector', { entity: dropped.id }, 60000);
  const sprite = inspector.find((c) => c.name === 'Sprite');
  const texture = sprite?.fields?.find((f) => f.key === 'texture');
  const named = JSON.stringify(texture ?? null);
  check(
    !named.includes('dupB'),
    `the sprite was pointed at dupA and the editor reports ${named} — it resolved to the other file`,
  );

  return check.failures;
}
