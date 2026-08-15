// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  meshopt-import — a compressed model, dropped into the real editor.
 *
 * A unit test can prove the importer decodes `EXT_meshopt_compression`; it runs
 * the module straight from source. The editor reaches it through a bundled main
 * process, and the decoder is a WebAssembly module carried as base64 inside that
 * bundle — a bundler can mangle it, and the failure is a model of vertices on the
 * origin rather than an error. So this drops both files through the real import
 * door and asks that the compressed one produce the very same `.esmesh`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker } from '../lib/editorDriver.mjs';
import { plainTriangle, meshoptTriangle } from '../lib/gltfFixtures.mjs';

export const name = 'meshopt-import';
export const describes = 'a meshopt-compressed glTF imports to the same mesh the plain one does';

export async function run(ed) {
  const root = await makeProject({
    'project.esproject': JSON.stringify({ name: 'Meshopt', version: '1.0' }, null, 2),
    'assets/scenes/main.esscene': JSON.stringify({
      version: '1.0', name: 'Main',
      entities: [{
        id: 0, name: 'Camera', parent: null, children: [], visible: true,
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
          { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
        ],
      }],
    }, null, 1),
  });
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const plain = path.join(root, 'assets', 'plain.gltf');
  const packed = path.join(root, 'assets', 'packed.gltf');
  await writeFile(plain, plainTriangle());
  await writeFile(packed, await meshoptTriangle());

  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  const result = await ed.json('import_assets', { destDir: 'assets', sources: [plain, packed] }, 120000);
  const wrote = (stem) => (result?.imported ?? []).includes(`assets/${stem}.esmesh`);
  if (!check(wrote('plain') && wrote('packed'), `import reported ${JSON.stringify(result)}`)) {
    return check.failures;
  }

  const mesh = async (stem) => {
    try {
      return await readFile(path.join(root, 'assets', `${stem}.esmesh`));
    } catch {
      return null;
    }
  };
  const a = await mesh('plain');
  const b = await mesh('packed');
  if (!check(a != null && b != null, 'one of the imports wrote no .esmesh')) return check.failures;

  // Byte-for-byte: the compression is a property of the file, not of the mesh
  // in it, so anything that survives into the product is a decode gone wrong.
  check(a.equals(b), `the compressed model produced a different .esmesh (${a.length} vs ${b.length} bytes)`);
  return check.failures;
}
