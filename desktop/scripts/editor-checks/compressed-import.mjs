// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  compressed-import — a compressed model, dropped into the real editor.
 *
 * A unit test can prove the importer decodes meshopt and Draco; it runs the
 * module straight from source. The editor reaches it through a BUNDLED main
 * process, where one decoder's wasm rides along as base64 and the other is
 * loaded off disk beside its package — both of which a bundler can break, with
 * a model of vertices on the origin as the symptom rather than an error. So
 * this drops all three files through the real import door.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { makeProject, checker } from '../lib/editorDriver.mjs';
import { plainTriangle, meshoptTriangle, dracoTriangle } from '../lib/gltfFixtures.mjs';

export const name = 'compressed-import';
export const describes = 'a meshopt- or Draco-compressed glTF imports to the mesh the plain one does';

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
  const draco = path.join(root, 'assets', 'draco.gltf');
  await writeFile(plain, plainTriangle());
  await writeFile(packed, await meshoptTriangle());
  await writeFile(draco, await dracoTriangle());

  const check = checker();
  await ed.open(root, 'assets/scenes/main.esscene');
  const result = await ed.json('import_assets', { destDir: 'assets', sources: [plain, packed, draco] }, 120000);
  const wrote = (stem) => (result?.imported ?? []).includes(`assets/${stem}.esmesh`);
  if (!check(wrote('plain') && wrote('packed') && wrote('draco'),
             `import reported ${JSON.stringify(result)}`)) {
    return check.failures;
  }
  check(!result.warnings?.length, `import warned: ${JSON.stringify(result.warnings)}`);

  const mesh = async (stem) => {
    try {
      return await readFile(path.join(root, 'assets', `${stem}.esmesh`));
    } catch {
      return null;
    }
  };
  const a = await mesh('plain');
  const b = await mesh('packed');
  const c = await mesh('draco');
  if (!check(a != null && b != null && c != null, 'one of the imports wrote no .esmesh')) {
    return check.failures;
  }

  // meshopt is lossless, so byte-for-byte: anything of the compression that
  // survives into the product is a decode gone wrong. Draco quantizes and
  // reorders, so its claim here is the vertex count the same payload implies.
  check(a.equals(b), `the meshopt model produced a different .esmesh (${a.length} vs ${b.length} bytes)`);
  check(c.length === a.length, `the Draco model produced ${c.length} bytes, not ${a.length}`);
  return check.failures;
}
