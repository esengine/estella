// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Imports public/scenes/two-triangles.gltf into the `.esmesh` behind the
 *        `mesh-asset` pixel gate.
 *
 * Through the shipped importer (`estella import-gltf`), not a copy of it: the
 * fixture is then a product of the path a user takes, so the gate that asserts
 * three points of the frame is asserting the importer as well — get an accessor,
 * a byte stride or a colour conversion wrong and the pixels move. The glTF holds
 * the geometry scenes/mesh2d.esscene inlines, which is why those points hold.
 *
 *   node scripts/make-mesh-fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(HERE, '..', 'public', 'scenes', 'two-triangles.gltf');
const cli = path.join(HERE, '..', '..', 'pipeline', 'bin', 'estella.mjs');

const run = spawnSync(process.execPath, [cli, 'import-gltf', source], {
  stdio: 'inherit',
  cwd: path.join(HERE, '..', '..'),
});
process.exit(run.status ?? 1);
