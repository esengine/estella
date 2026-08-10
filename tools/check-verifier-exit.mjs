// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-verifier-exit.mjs — an Electron verifier reports its verdict.
 *
 * `process.exitCode = ok ? 0 : 1` is the right thing in Node and a lie under
 * Electron: the process leaves with status 0 on quit whatever exitCode says. Six
 * scripts ended that way, so each printed FAIL and told its caller it had
 * passed — including the twelve scenes CI runs on every push, which therefore
 * could not fail a build.
 *
 * A verdict nothing can act on is worse than no verdict, so this refuses the
 * pattern rather than trusting everyone to remember. `app.exit(code)` is the
 * form that works.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = [path.join(ROOT, 'desktop', 'scripts'), path.join(ROOT, 'tools')];

function scripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...scripts(abs));
    else if (/\.(mjs|js)$/.test(entry.name) && statSync(abs).isFile()) out.push(abs);
  }
  return out;
}

const problems = [];
let electronScripts = 0;
for (const root of ROOTS) {
  for (const file of scripts(root)) {
    const src = readFileSync(file, 'utf8');
    if (!/from\s+['"]electron['"]|require\(['"]electron['"]\)/.test(src)) continue;
    electronScripts++;
    // The assignment is the defect; naming the pattern in a comment is how the
    // next reader learns why it is banned.
    const line = src.split('\n').findIndex((l) => /process\.exitCode\s*=/.test(l.replace(/\/\/.*$/, '')));
    if (line >= 0) problems.push(`${path.relative(ROOT, file)}:${line + 1}`);
  }
}

if (problems.length) {
  console.error('check-verifier-exit: an Electron script cannot report a failure that way.\n');
  for (const p of problems) {
    console.error(`  ${p} sets process.exitCode — Electron quits with status 0 regardless. Use app.exit(code).`);
  }
  process.exit(1);
}

console.log(`check-verifier-exit: ${electronScripts} Electron script(s) report their verdict through app.exit.`);
