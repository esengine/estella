#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = path.join(ROOT, 'sdk');
const pkg = JSON.parse(readFileSync(path.join(SDK, 'package.json'), 'utf8'));
const declared = new Set((pkg.sideEffects ?? []).map((p) => path.resolve(SDK, p)));

if (declared.size === 0) {
  console.error('check-dist-side-effect-chunks: sdk/package.json declares no side-effectful file.');
  process.exit(1);
}

const problems = [];
let checked = 0;
for (const file of declared) {
  if (!existsSync(file)) {
    problems.push(`${path.relative(ROOT, file)} is declared in sideEffects and was not built (run the SDK build first)`);
    continue;
  }
  checked++;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^import\s+["']([^"']+)["'];?\s*$/gm)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (declared.has(target) || !existsSync(target)) continue;
    if (readFileSync(target, 'utf8').trim() === '') continue;
    problems.push(`${path.relative(ROOT, file)} runs ${path.relative(ROOT, target)} only by importing it bare, `
      + 'and that file is not in sideEffects: a consumer bundler drops it, and whatever it registers never runs');
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-dist-side-effect-chunks: ${problems.length} published entr(y/ies) lose code to the bundler.`);
  process.exit(1);
}
console.log(`check-dist-side-effect-chunks: ${checked} side-effectful file(s), none runs code through an undeclared chunk.`);
