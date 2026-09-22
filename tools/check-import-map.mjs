#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every `esengine` specifier a game may write resolves to a file the SDK
 *        actually publishes.
 *
 * Two files said "mirrors sdk/package.json exports" and neither was held to it:
 * `esengine/factory` sat in both, pointing at `webAppFactory.js`, which the SDK
 * has never exported and `dist/` has never emitted at that path. A page whose
 * script imported it would get a bare-specifier error at load; nothing did, so
 * nothing said anything for a year.
 *
 * Both now derive from one list, and this holds that list against the package.
 *
 *   node tools/check-import-map.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESOLVE = 'pipeline/src/bundle/engineSubpaths.ts';

const src = readFileSync(path.join(ROOT, RESOLVE), 'utf8');
const block = /export const ESENGINE_SUBPATHS[^{]*\{([\s\S]*?)\n\};/.exec(src);
if (!block) {
  console.error(`check-import-map: no ESENGINE_SUBPATHS in ${RESOLVE} — the list moved.`);
  process.exit(1);
}

/** `'esengine/spine': 'spine/index.js',` — the specifier and what it resolves to. */
const listed = [...block[1].matchAll(/'(esengine\/[^']+)'\s*:\s*'([^']+)'/g)]
  .map(([, specifier, file]) => ({ specifier, file }));

if (listed.length === 0) {
  console.error(`check-import-map: ESENGINE_SUBPATHS is empty — a game could import no subpath.`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf8'));
const problems = [];

for (const { specifier, file } of listed) {
  const subpath = `.${specifier.slice('esengine'.length)}`;
  const entry = pkg.exports?.[subpath];
  if (!entry) {
    problems.push(`${specifier} is resolved, but sdk/package.json exports no "${subpath}" — `
      + 'a game writing it gets a bare-specifier error, and the exporter stages nothing for it');
    continue;
  }
  // The exporter stages dist/ as sdk/, so the export's own target is the answer.
  const target = (typeof entry === 'string' ? entry : entry.import ?? '').replace(/^\.\/dist\//, '');
  if (target !== file) {
    problems.push(`${specifier} resolves to "${file}" but "${subpath}" exports "${target}" — `
      + 'the staged file and the published one are different files');
  }
}

/**
 * The bare specifier is not in the list (every strategy names its own main
 * entry), so it is checked here: a page's import map points at `sdk/index.js`.
 */
const main = typeof pkg.exports?.['.'] === 'string' ? pkg.exports['.'] : pkg.exports?.['.']?.import;
if (main !== './dist/index.js') {
  problems.push(`sdk/package.json exports "." as "${main}", and the import map stages `
    + '"./sdk/index.js" — the page would fetch a file the package does not publish there');
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-import-map: ${problems.length} finding(s).`);
  process.exit(1);
}

console.log(`check-import-map: ${listed.length + 1} esengine specifier(s), each published by `
  + 'sdk/package.json and staged from the file it names.');
