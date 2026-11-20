#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-editor-checks-load.mjs — every editor check, and the library they share, parses.
 *
 * Editor checks run on a machine with the editor, not in CI, so a check file that does not parse reached master unseen
 * (an unescaped quote in a `describes` line, 2026-11-20) and the next person to run any check found none would start.
 * Parsing needs no editor: each file is read as the ES module it is, and nothing is run.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { transformSync } from 'esbuild';
import { ROOT } from './lib/repo.mjs';

const DIRS = ['desktop/scripts/editor-checks', 'desktop/scripts/lib'];

if (!existsSync(path.join(ROOT, DIRS[0]))) {
  console.log('check-editor-checks-load: no editor checkout, nothing to read.');
  process.exit(0);
}

const broken = [];
let read = 0;
for (const dir of DIRS) {
  if (!existsSync(path.join(ROOT, dir))) continue;
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (!name.endsWith('.mjs')) continue;
    const rel = `${dir}/${name}`;
    read += 1;
    try {
      transformSync(readFileSync(path.join(ROOT, rel), 'utf8'), { loader: 'js', format: 'esm', sourcefile: rel, logLevel: 'silent' });
    } catch (error) {
      const first = error?.errors?.[0];
      broken.push(first ? `${rel}:${first.location?.line ?? '?'}  ${first.text}` : `${rel}  ${String(error)}`);
    }
  }
}

if (broken.length) {
  console.error(`✗ ${broken.length} editor check file(s) do not parse; the runner cannot load them:`);
  for (const line of broken) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`check-editor-checks-load: ${read} editor check and library file(s) parse.`);
