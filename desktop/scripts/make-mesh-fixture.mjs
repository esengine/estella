// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Imports the glTF fixtures behind the mesh render gates.
 *
 * Through the shipped importer (`estella import-gltf`), not a copy of it: the
 * fixture is then a product of the path a user takes, so the gate that asserts
 * points of the frame is asserting the importer as well — get an accessor, a
 * byte stride or a colour conversion wrong and the pixels move. The glTF holds
 * the geometry scenes/mesh2d.esscene inlines, which is why those points hold.
 *
 *   node scripts/make-mesh-fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scenes = path.join(HERE, '..', 'public', 'scenes');
const cli = path.join(HERE, '..', '..', 'pipeline', 'bin', 'estella.mjs');

// two-triangles: the mesh2d geometry, so a file drawing what the scene draws is
// the claim. lit-triangles: the same shape with per-face NORMALS and one white
// colour. textured-quad: an inline image and a baseColor factor. node-tree: a
// parent and two placed children, one of them scaled.
//
// public/ stands in for the project root, so the prefab's refs read `scenes/…`
// — the spelling a component carries, resolved from the served root.
for (const name of ['two-triangles.gltf', 'lit-triangles.gltf', 'white-triangles.gltf',
                    'textured-quad.gltf', 'node-tree.gltf']) {
  const run = spawnSync(process.execPath,
    [cli, 'import-gltf', path.join(scenes, name), '--project', path.join(HERE, '..', 'public')], {
      stdio: 'inherit',
      cwd: path.join(HERE, '..', '..'),
    });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
