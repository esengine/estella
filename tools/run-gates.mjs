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
 *   node tools/run-gates.mjs --scope local --suites owed    (the pre-push hook)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPES, GATES, gatesFor, owedSuites } from './gates.mjs';

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
/**
 * Which suite gates this caller pays for: `all` (default, and CI), `owed` (those
 * whose `owns` this change touched — the pre-push hook), or `none`.
 *
 * @details A machine that cannot run an owed suite is not silently excused: it
 *          says what it needs and the push stops, per check-suite-preconditions.
 */
const SUITE_MODES = ['all', 'owed', 'none'];
if (argv.includes('--no-suites')) {
  console.error('run-gates: --no-suites is now --suites none (or --suites owed, which the'
    + ' pre-push hook uses).');
  process.exit(2);
}
const SUITE_MODE = flag('suites', 'all');
if (!SUITE_MODES.includes(SUITE_MODE)) {
  console.error(`run-gates: unknown --suites "${SUITE_MODE}" (have: ${SUITE_MODES.join(', ')})`);
  process.exit(2);
}

/**
 * What this push would ADD to the remote: COMMITTED work since the branch left
 * it. Not the working tree — what is uncommitted is not going out, and on a
 * checkout two lines of work share it would owe suites for someone else's
 * half-finished edit and block this push on their red.
 */
function changedPaths() {
  const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  let base = '';
  for (const ref of ['origin/master', 'master']) {
    try { base = git(['merge-base', 'HEAD', ref]).trim(); break; } catch { /* no such ref here */ }
  }
  // No remote to compare against is not "nothing changed": the last commit is
  // the smallest honest answer, and it is what a fresh clone's first push has.
  const out = git(base ? ['diff', '--name-only', base, 'HEAD'] : ['diff', '--name-only', 'HEAD~1', 'HEAD']);
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))];
}

const changed = SUITE_MODE === 'owed' ? changedPaths() : [];
const SUITES = SUITE_MODE === 'owed' ? owedSuites(changed) : SUITE_MODE;
/**
 * Whether every DECLARED gate has to have run, not just every gate that could.
 *
 * The release criterion took this list's exit code for "the contracts hold", and
 * a checkout without the editor drops eleven gates and a whole suite while still
 * leaving 0 — so the nightly read 69/69 green as an answer about 80.
 */
const COMPLETE = argv.includes('--complete');

/**
 * What a caller has DECLARED this run cannot cover. Declaring is the honest way
 * to run without a capability — the suite refuses to start otherwise — but it is
 * still a hole, and one only the summary knew about.
 */
const GAPS = [
  { env: 'SDK_TEST_MODE', value: 'no-wasm', says: 'sdk-tests did NOT cover the engine boundary' },
  {
    env: 'ESTELLA_NO_HOST_CC',
    value: '1',
    says: 'no C compiler — the emitted C was NOT compared against the interpreter,'
      + ' and the ABI struct checks were not compiled',
  },
  {
    env: 'ESTELLA_NO_EMCC',
    value: '1',
    says: 'no emsdk — nothing was compiled to wasm, so nothing was compared against a module',
  },
];
const declared = GAPS.filter((g) => process.env[g.env] === g.value);
const gates = gatesFor(SCOPE, HAS_EDITOR, { suites: SUITES });
const skipped = GATES.filter((g) => g.where && g.where !== SCOPE);
/** Suites this run is not paying for — named, never silently absent. */
const unpaid = gatesFor(SCOPE, HAS_EDITOR)
  .filter((g) => g.covers?.length && !gates.includes(g));
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
  for (const g of declared) console.log(`  ${g.env}=${g.value} — ${g.says}`);
  const unrun = noEditor.filter((g) => g.covers?.length);
  if (unrun.length) {
    console.log(`  test suites NOT run: ${unrun.map((g) => g.id).join(', ')} — no editor checkout`);
  }
  // The whole point of not paying for a suite is that it is CHEAP, not that it
  // is quiet. Under `owed` the count of paths is part of the claim: "no suite was
  // owed" means nothing unless it is attached to a diff that was actually read.
  if (SUITE_MODE === 'owed') {
    console.log(`  ${changed.length} changed path(s) read for suite ownership`
      + `${SUITES.size ? '' : ' — none of them under a suite\'s `owns`'}`);
  }
  if (unpaid.length) {
    const why = SUITE_MODE === 'owed'
      ? 'nothing changed under what they answer for; CI runs them all'
      : `--suites ${SUITE_MODE}; CI runs them`;
    console.log(`  test suites NOT run: ${unpaid.map((g) => g.id).join(', ')} — ${why}`);
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

// A gate narrowed to another scope is owned there and is not this run's hole;
// one dropped for a missing checkout or an unpaid minute is exactly that.
if (COMPLETE) {
  // A declaration is not permission: it is the same hole as a missing checkout,
  // said out loud instead of found. Printing it while exiting 0 is the shape
  // check-unanswered-exits refuses of every verifier but this one.
  const holes = [
    ...[...noEditor, ...unpaid].map((g) => g.id),
    ...declared.map((g) => `${g.env}=${g.value}`),
  ];
  if (holes.length) {
    console.error(`\n${holes.length} declared gate(s) or capability gap(s) never ran here: ${holes.join(', ')}`);
    console.error('  --complete was asked for, so this cannot say the list is green.');
    process.exit(2);
  }
}
