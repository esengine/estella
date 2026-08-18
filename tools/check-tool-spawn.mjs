// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-tool-spawn.mjs — a tool that shells out to pnpm or npx runs on
 *        every OS the repo is developed on.
 *
 * Windows installs both as `.cmd` shims, which node will not spawn directly: the
 * bare name is ENOENT and the suffixed one EINVAL. Six release-gate tools did it
 * anyway, so on Windows they never started a process at all — and each reported
 * the absence as whatever it had been about to measure. `verify-golden` said the
 * editor never produced a play frame. That is the shape this forbids: the launch
 * failure has one spelling, in lib/runTool.mjs, and it says which it was.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCANNED = ['tools', 'build-tools'];
const HELPER = 'tools/lib/runTool.mjs';

/** The shims. `node`, `git`, `cmake` and friends are real executables and fine. */
const SHIMS = ['pnpm', 'npx', 'npm', 'yarn'];
const SPAWNS = new RegExp(String.raw`\b(?:spawnSync|spawn|execFileSync|execFile)\(\s*['"\`](${SHIMS.join('|')})['"\`]`, 'g');

function scripts(dir, into = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) scripts(full, into);
    else if (/\.(mjs|js|cjs)$/.test(name)) into.push(full);
  }
  return into;
}

const violations = [];
for (const dir of SCANNED) {
  for (const file of scripts(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel === HELPER) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPAWNS)) {
      violations.push({
        rel,
        line: text.slice(0, m.index).split('\n').length,
        what: m[0],
        shim: m[1],
      });
    }
  }
}

if (violations.length > 0) {
  console.error(`\n✗ ${violations.length} site(s) spawn a package-manager shim directly:\n`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  ${v.what}…`);
    console.error(`    node cannot spawn ${v.shim} on windows without a shell\n`);
  }
  console.error(`Use \`runTool\` from ${HELPER}, which picks the launch for the OS and`);
  console.error('reports a process that never started as one.\n');
  process.exit(1);
}

const users = scripts(path.join(ROOT, 'tools'))
  .filter((f) => path.relative(ROOT, f).split(path.sep).join('/') !== HELPER)
  .filter((f) => /\brunTool\(/.test(readFileSync(f, 'utf8')))
  .length;
console.log(`check-tool-spawn: ${users} tool(s) launch pnpm/npx through ${HELPER} — none does it by hand.`);
