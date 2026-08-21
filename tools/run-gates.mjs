// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  run-gates.mjs — run the static gates a scope pays for.
 *
 * Stops at the first failure on purpose: the gates are ordered, and a later one
 * reading a build an earlier one failed to produce reports a second, invented
 * problem on top of the real one.
 *
 *   node tools/run-gates.mjs --scope local
 *   node tools/run-gates.mjs --scope ci
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPES, GATES, gatesFor } from './gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const SCOPE = flag('scope', 'local');
if (!SCOPES.includes(SCOPE)) {
  console.error(`run-gates: unknown scope "${SCOPE}" (have: ${SCOPES.join(', ')})`);
  process.exit(2);
}

// The editor is an optional submodule; the gates whose subject IS the editor
// cannot run without it. Named below rather than silently dropped — a gate that
// disappears quietly is the same as one that always passes.
const HAS_EDITOR = existsSync(path.join(ROOT, 'desktop', 'package.json'));
const gates = gatesFor(SCOPE, HAS_EDITOR);
const skipped = GATES.filter((g) => g.where && g.where !== SCOPE);
const noEditor = HAS_EDITOR ? [] : GATES.filter((g) => g.needs === 'editor' && (!g.where || g.where === SCOPE));
console.log(`gates ${SCOPE}: ${gates.length} of ${GATES.length}`);
if (noEditor.length) {
  console.log(`  no editor checkout — not running ${noEditor.length} editor gate(s): ${noEditor.map((g) => g.id).join(', ')}`);
}

for (const gate of gates) {
  const r = spawnSync('sh', ['-c', gate.run], { cwd: ROOT, stdio: 'inherit' });
  // A shell that would not start is not a gate that failed. Reported as one it
  // sends the reader after the first gate's subject, which said nothing at all.
  if (r.error) {
    console.error(`\n✗ could not run the gates: ${r.error.message}`);
    console.error('  they are shell commands — run this from a shell that has `sh` on PATH.');
    process.exit(2);
  }
  if (r.status !== 0) {
    console.error(`\n✗ ${gate.id} — \`${gate.run}\``);
    // Naming what did NOT run matters at the moment of failure: the gates after
    // this one said nothing, and a reader should not take silence for green.
    const after = gates.slice(gates.indexOf(gate) + 1);
    if (after.length) console.error(`  ${after.length} later gate(s) did not run: ${after.map((g) => g.id).join(', ')}`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\ngates ${SCOPE}: ${gates.length}/${gates.length} green`
  + (noEditor.length ? ` (${noEditor.length} editor gate(s) had no checkout to run against)` : ''));
for (const g of skipped) console.log(`  not in this scope: ${g.id} — ${g.why}`);
