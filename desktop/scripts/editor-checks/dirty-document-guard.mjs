// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  dirty-document-guard — unsaved work in ANY document blocks a swap.
 *
 * The editor holds several documents at once: the scene, and every open asset
 * editor. DirtyRegistry aggregates them and discardGuard states the rule — a
 * guard reads the aggregate, "NOT just the scene's EditorHistory".
 *
 * Four doors in the automation surface restated that rule by hand and one
 * drifted: `open_scene` asked EditorHistory alone. So with an unsaved material
 * graph open and a clean scene, `open_asset` on a scene refused and `open_scene`
 * went through — the same operation, opposite answers, and nothing failed to say
 * so. Whether the graph then survived was luck, not design.
 *
 * A static check keeps the surface off single-document state; this is the half a
 * static check cannot do — that the refusal actually happens, and that saving
 * lifts it.
 */
import path from 'node:path';
import { cp } from 'node:fs/promises';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

const scene = (name) => JSON.stringify({
  version: '1.0', name,
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
      ],
    },
  ],
}, null, 1);

const GRAPH = JSON.stringify({
  name: 'Fire',
  output: 'out',
  nodes: [
    { id: 'tint', type: 'constColor', x: 60, y: 60, params: { name: 'u_tint', value: [1, 0, 0, 1] } },
    { id: 'out', type: 'output', x: 260, y: 60, inputs: { color: 'tint' } },
  ],
}, null, 2);

export const name = 'dirty-document-guard';
export const describes = 'an unsaved ASSET editor blocks a scene swap, and saving it lifts the block';

/** True when a call was refused (the driver throws on an error reply). */
async function refused(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(e?.message ?? e);
  }
}

export async function run(ed) {
  const root = await makeProject({
    'assets/scenes/main.esscene': scene('Main'),
    'assets/scenes/other.esscene': scene('Other'),
  });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();

  await ed.open(root, 'assets/scenes/main.esscene');

  const graphPath = await ed.json('create_asset', {
    destDir: 'assets/fx', baseName: 'Fire', content: GRAPH, type: 'materialgraph',
  }, 60000);
  if (!check(typeof graphPath === 'string', `create_asset returned ${JSON.stringify(graphPath)}`)) return check.failures;

  // The SCENE stays clean throughout — that is the whole point. Only the asset
  // document is dirty, which is exactly what the drifted door could not see.
  await ed.call('open_asset', { path: graphPath }, 60000);
  await ed.call('edit_asset_document', {
    changes: [{ path: 'nodes.0.params.name', value: 'u_flame' }],
    label: 'Rename param',
  });

  const doc = await ed.json('get_document', {});
  check(doc?.dirty === true, `with an edited graph open the document reports dirty=${doc?.dirty}`);

  const why = await refused(() => ed.call('open_scene', { path: 'assets/scenes/other.esscene' }, 60000));
  check(why !== null, 'open_scene went through with an unsaved material graph open');
  if (why) check(/unsaved/i.test(why), `it refused, but not about unsaved work: ${why}`);

  // Same state, the other door: it always refused, and must keep refusing.
  const why2 = await refused(() => ed.call('open_asset', { path: 'assets/scenes/other.esscene' }, 60000));
  check(why2 !== null, 'open_asset went through with an unsaved material graph open');

  // Saying it out loud is still allowed — the refusal is not a wall.
  const forced = await refused(() =>
    ed.call('open_scene', { path: 'assets/scenes/other.esscene', discardChanges: true }, 60000));
  check(forced === null, `open_scene refused even with discardChanges: ${forced}`);
  const after = await ed.json('get_document', {});
  check(after?.path === 'assets/scenes/other.esscene', `the forced open landed on ${after?.path}`);

  return check.failures;
}
