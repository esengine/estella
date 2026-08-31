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
// --no-suites drops the gates that RUN a suite (the `covers` ones), for a caller
// that is not paying minutes right now — the pre-push hook. Everything else,
// including the builds the later gates read, still runs.
const SUITES = !argv.includes('--no-suites');
const gates = gatesFor(SCOPE, HAS_EDITOR, { suites: SUITES });
const skipped = GATES.filter((g) => g.where && g.where !== SCOPE);
/** Suites this run is not paying for — named, never silently absent. */
const unpaid = SUITES ? [] : gatesFor(SCOPE, HAS_EDITOR).filter((g) => g.covers?.length);
const noEditor = HAS_EDITOR ? [] : GATES.filter((g) => g.needs === 'editor' && (!g.where || g.where === SCOPE));
console.log(`gates ${SCOPE}: ${gates.length} of ${GATES.length}`);
if (noEditor.length) {
  console.log(`  no editor checkout — not running ${noEditor.length} editor gate(s): ${noEditor.map((g) => g.id).join(', ')}`);
}

/** What this scope WOULD run, without running it — so the plan can be inspected
 *  (and checked) without paying for the suite. */
if (argv.includes('--plan')) {
  for (const gate of gates) console.log(`  ${gate.id}`);
  reportSuites();
  for (const g of skipped) console.log(`  not in this scope: ${g.id} — ${g.why}`);
  process.exit(0);
}

/**
 * Name the SUITES, not just the count. A line reading "76/76 gates" is heard as
 * static checks — which is how four broken SDK suites sat behind a green run for
 * as long as no gate invoked them (see check-verification-authority).
 */
function reportSuites() {
  const suites = gates.filter((g) => g.covers?.length);
  if (suites.length) console.log(`  test suites run: ${suites.map((g) => g.id).join(', ')}`);
  // A declared profile narrows what a suite covered, and the summary is where
  // that has to be said — otherwise "green" quietly means "green minus 300".
  if (process.env.SDK_TEST_MODE === 'no-wasm') {
    console.log('  SDK_TEST_MODE=no-wasm — sdk-tests did NOT cover the engine boundary');
  }
  const unrun = noEditor.filter((g) => g.covers?.length);
  if (unrun.length) {
    console.log(`  test suites NOT run: ${unrun.map((g) => g.id).join(', ')} — no editor checkout`);
  }
  // The whole point of --no-suites is that it is CHEAP, not that it is quiet.
  if (unpaid.length) {
    console.log(`  test suites NOT run: ${unpaid.map((g) => g.id).join(', ')} — --no-suites; CI runs them`);
  }
}

/** What each gate cost, so the expensive ones are a measurement rather than a
 *  hunch — this list is ordered by hand and nothing was timing it. */
const spent = [];

for (const gate of gates) {
  const began = Date.now();
  const r = spawnSync('sh', ['-c', gate.run], { cwd: ROOT, stdio: 'inherit' });
  spent.push({ id: gate.id, ms: Date.now() - began });
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
  + ` in ${(spent.reduce((t, g) => t + g.ms, 0) / 1000).toFixed(0)}s`
  + (noEditor.length ? ` (${noEditor.length} editor gate(s) had no checkout to run against)` : ''));
// Name the costliest: "the gates are slow" is not something anyone can act on,
// and "sdk-tests took 78 of the 210 seconds" is.
const dear = [...spent].sort((x, y) => y.ms - x.ms).slice(0, 5);
console.log(`  costliest: ${dear.map((g) => `${g.id} ${(g.ms / 1000).toFixed(0)}s`).join(', ')}`);
reportSuites();
for (const g of skipped) console.log(`  not in this scope: ${g.id} — ${g.why}`);
