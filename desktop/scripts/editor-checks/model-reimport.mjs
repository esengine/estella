// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  model-reimport — a model that lands in the project becomes assets, and
 *        keeps doing so when it changes.
 *
 * The import ran once, at the moment a file was dropped: a `.gltf` copied in by
 * git or a re-export from Blender produced nothing, and an import setting had no
 * way to reach the products it decides. Registering the model import as an
 * ordinary importer is what connects the watcher, the Reimport row and the
 * settings to it — none of which a unit test can exercise, because every one of
 * them lives on the other side of the editor's own file plumbing.
 *
 * The `.fbx` half is here for one more reason: its reader is a wasm module
 * loaded from disk beside the app, which only the real, bundled editor can
 * prove it can still find.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker, DESKTOP } from '../lib/editorDriver.mjs';
import { skinnedBar } from '../lib/fbxFixtures.mjs';

const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'sprite-rendering');

const SCENE = JSON.stringify({ version: 1, name: 'Main', entities: [] }, null, 1);

/** One triangle, one unit across — small enough that the import says so. */
function gltf() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
  const indices = new Uint16Array([0, 1, 2]);
  const bytes = Buffer.concat([
    Buffer.from(positions.buffer), Buffer.from(uvs.buffer), Buffer.from(indices.buffer),
  ]);
  return JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${bytes.toString('base64')}` }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, mode: 4 }] }],
    nodes: [{ name: 'Body', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}

export const name = 'model-reimport';
export const describes = 'a model in the project imports itself, and re-imports when it changes';

/** Poll until `test()` of the file's content passes, up to `ms`. */
async function until(ed, file, test, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        if (test(JSON.parse(await readFile(file, 'utf8')))) return true;
      } catch { /* half-written or not JSON yet */ }
    }
    await ed.sleep(250);
  }
  return false;
}

export async function run(ed) {
  const root = await makeProject({ 'assets/scenes/main.esscene': SCENE });
  await cp(path.join(EXAMPLE, 'project.esproject'), path.join(root, 'project.esproject'));
  await cp(path.join(EXAMPLE, 'src'), path.join(root, 'src'), { recursive: true });
  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');

  // Arriving the way a checkout or a Blender re-export does: written into the
  // project with the editor already open, never through the import dialog.
  const source = path.join(root, 'assets/models/robot.gltf');
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, gltf());

  const prefab = path.join(root, 'assets/models/robot.esprefab');
  if (!check(await until(ed, prefab, (p) => p.entities?.length > 0),
             'a model written into the project produced no prefab — nothing imported it')) {
    return check.failures;
  }
  check(existsSync(path.join(root, 'assets/models/robot.esmesh')),
        'the prefab exists but the mesh it references does not');

  // Its `.meta` carries the import settings, minted from the schema — without
  // them there is nothing for a user to edit.
  const meta = `${source}.meta`;
  if (!check(await until(ed, meta, (m) => m.importer?.scale === 1),
             'the source has no `scale` import setting, so its size cannot be authored')) {
    return check.failures;
  }

  // An FBX arrives the same way and through the same importer; what it proves
  // that the glTF cannot is that the bundled editor still reaches its reader.
  const fbx = path.join(root, 'assets/models/rig.fbx');
  await writeFile(fbx, skinnedBar());
  const rig = path.join(root, 'assets/models/rig.esprefab');
  if (check(await until(ed, rig, (p) => p.entities?.length > 0),
            'an .fbx written into the project produced no prefab — its reader never ran')) {
    check(existsSync(path.join(root, 'assets/models/rig.esmesh')),
          'the .fbx prefab exists but the mesh it references does not');
    const clip = path.join(root, 'assets/models/rig_Take_001.estimeline');
    check(await until(ed, clip, (c) => c.tracks?.length > 0),
          'the .fbx animation produced no clip — its curves were never baked');
  }

  // Set the way the inspector sets it — the setting decides a product, so
  // writing it has to remake that product with no further prompting.
  await ed.call('set_import_settings',
                { path: 'assets/models/robot.gltf', patch: { scale: 64 } }, 60000);
  check(
    await until(ed, prefab, (p) => p.entities?.[0]?.components?.[0]?.data?.scale?.x === 64),
    'the edited scale never reached the prefab — saving a setting does not remake its product',
  );

  return check.failures;
}
