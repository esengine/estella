// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT as root } from './lib/repo.mjs';
const out = path.resolve(process.argv[2] ?? path.join(root, 'output/cache-budget/render'));
const channel = process.argv[3];
if (!channel) throw Error('usage: node tools/cache-budget-render-fixture.mjs <output> <debug-channel-url>');
await mkdir(path.join(root, 'pipeline/src'), { recursive: true });
const scratch = await mkdtemp(path.join(root, 'pipeline/src/.build-cache-render-'));
try {
    const bundle = path.join(scratch, 'fixture.mjs');
    await build({ entryPoints: [path.join(root, 'tools/fixtures/cache-budget-render-fixture.ts')], outfile: bundle,
        bundle: true, format: 'esm', platform: 'node', packages: 'external' });
    const { run } = await import(pathToFileURL(bundle).href);
    console.log(JSON.stringify(await run(root, out, channel)));
} finally { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
