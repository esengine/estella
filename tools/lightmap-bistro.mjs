// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
// Prepare or measure the licensed ORCA Bistro with the production import and bake.
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT as root } from './lib/repo.mjs';
const [mode, file, out, original] = process.argv.slice(2);
if (!['prepare', 'measure'].includes(mode) || !file || !out) {
  throw Error('usage: node tools/lightmap-bistro.mjs prepare <BistroExterior.fbx> <directory> | measure <input.json> <report-directory> [original-kernel.mjs]');
}
const scratch = await mkdtemp(path.join(root, 'pipeline/src/.build-bistro-'));
try {
  const bundle = path.join(scratch, 'run.mjs');
  await build({ entryPoints: [path.join(root, 'tools/fixtures/lightmap-bistro.ts')], outfile: bundle,
    bundle: true, format: 'esm', platform: 'node', packages: 'external',
    plugins: [{ name: 'kernel-binaries', setup(b) {
      b.onResolve({ filter: /[\\/]build-tools[\\/](ufbx|lightmap)[\\/]/ }, args =>
        ({ path: pathToFileURL(path.resolve(args.resolveDir, args.path)).href, external: true }));
    } }],
  });
  await mkdir(path.resolve(out), { recursive: true });
  const { prepare, measure } = await import(pathToFileURL(bundle).href);
  if (mode === 'prepare') await prepare(path.resolve(file), path.resolve(out));
  else await measure(path.resolve(file), path.resolve(out), original ? path.resolve(original) : undefined);
} finally { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
