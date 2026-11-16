// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  sdkSource.mjs — import a module of the SDK's TypeScript source from a repo tool.
 *
 * A tool that needs what the SDK computes (the WGSL transpiler, say) uses the SDK's own code, not a copy of it: a second copy is a
 * second answer waiting to disagree. The module is bundled on the fly with the pipeline's esbuild — no SDK build, no dist — and
 * imported from a temporary file.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT } from './repo.mjs';

const esbuild = createRequire(join(ROOT, 'pipeline', '/'))('esbuild');

/** The exports of `sdk/src/<rel>` (a .ts path relative to sdk/src). */
export async function importSdkSource(rel) {
  const out = esbuild.buildSync({
    entryPoints: [join(ROOT, 'sdk', 'src', rel)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'sdk-source-'));
  try {
    const file = join(dir, 'module.mjs');
    writeFileSync(file, out.outputFiles[0].text);
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
