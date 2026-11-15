// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { ROOT as root } from './lib/repo.mjs';

const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const args = process.argv.slice(2);
const referenceArg = args.find(a => a.startsWith('--search-reference='))?.slice('--search-reference='.length);
const reference = referenceArg ? execFileSync('git', ['rev-parse', '--verify', referenceArg + '^{commit}'],
  { cwd: root, encoding: 'utf8', windowsHide: true }).trim() : null;
const plugins = reference ? [{ name: 'reference-grid-search', setup(builder) {
  builder.onLoad({ filter: /[\\/]nav[\\/]pathfind\.ts$/ }, () => {
    let contents = execFileSync('git', ['show', reference + ':sdk/src/ai/nav/pathfind.ts'],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    if (!contents.includes('export function resolveEndpoint')) contents += '\nexport { resolveEndpoint };\n';
    return { contents, loader: 'ts', resolveDir: path.join(root, 'sdk/src/ai/nav') };
  });
} }] : [];
const bundle = await build({ entryPoints: [path.join(root, 'tools/fixtures/navigation-build-corpus.ts')],
  bundle: true, platform: 'browser', format: 'iife', globalName: 'NavBuildCorpus', write: false, plugins });
const code = bundle.outputFiles[0].text;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: code });
  const result = await page.evaluate(() => window.NavBuildCorpus.runNavigationBuildCorpus());
  const report = { recordedAt: new Date().toISOString(),
    source,
    bundleSha256: createHash('sha256').update(code).digest('hex'),
    searchReference: reference,
    searchReferenceScope: reference ? 'Only pathfind.ts comes from the reference; all other code, including dynamic-obstacle clearance, is current.' : null,
    sourceDirtyFiles: execFileSync('git', ['status', '--porcelain=1', '--untracked-files=all', '--', 'sdk/src/ai/nav'],
      { cwd: root, encoding: 'utf8', windowsHide: true }).split('\n').filter(Boolean).map(line => line.slice(3)),
    platform: process.platform, cpu: os.cpus()[0]?.model, browser: browser.version(),
    scope: 'Main-thread mesh rebuild or 2D grid obstacle marking plus 64 agent replans. Frame gaps include both. No editor, rendering, physics collection, avoidance or full game frame.',
    ...result };
  const destination = path.resolve(root, args.find(a => !a.startsWith('--')) ?? 'output/navigation-rebuild-baseline.json');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  for (const r of result.records) console.log(`${r.mode} ${r.size}x${r.size}: rebuild-p95=${r.p95Ms.toFixed(2)}ms replan64-p95=${r.queryP95Ms.toFixed(2)}ms total-p95=${r.updateP95Ms.toFixed(2)}ms over-budget=${r.updatesOverFrameBudget}/16 frame-gap-p95=${r.frameGapP95Ms.toFixed(2)}ms`);
  console.log(destination);
} finally {
  await browser.close();
}
