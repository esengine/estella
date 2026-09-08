// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  run-gates.mjs — run the static gates a scope pays for.
 *
 * Stops at the first failure on purpose: the gates are ordered, and a later one
 * reading a build an earlier one failed to produce reports a second, invented
 * problem on top of the real one.
 *
 * That is right for a gate and wrong for a SURVEY. One red hides the hundred
 * gates behind it, so "fix it and re-run" discovers the next red one at a time
 * and a release never learns how many it has. `--keep-going` runs the whole list
 * and prints the matrix — a scan, not a verdict: every red after the first is
 * marked `after-red`, because it may be the invented problem the ordering exists
 * to prevent, and only re-running it on a green tree settles which.
 *
 *   node tools/run-gates.mjs --scope local
 *   node tools/run-gates.mjs --scope ci
 *   node tools/run-gates.mjs --scope local --suites owed    (the pre-push hook)
 *   node tools/run-gates.mjs --scope local --keep-going --matrix out.json
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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
 * Survey the whole list instead of gating on it. A gate run answers "may this
 * push go out"; a scan answers "how many reds does this release have", and the
 * second question cannot be answered one re-run at a time.
 */
const SCAN = argv.includes('--keep-going');
/** Where to write the matrix, for a reader that is not a terminal. */
const MATRIX = (() => {
  const i = argv.indexOf('--matrix');
  return i >= 0 ? argv[i + 1] : null;
})();
if (MATRIX && !SCAN) {
  console.error('run-gates: --matrix only has something to write under --keep-going.');
  process.exit(2);
}

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
/**
 * Narrow to named gates. A scan finds ten reds at once and then each fix wants
 * ONE of them re-run; without this the only way to re-check a gate is to pay for
 * the hundred in front of it, which is how a fix goes unverified.
 */
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(',').map((x) => x.trim()).filter(Boolean) : null;
})();
const gates = gatesFor(SCOPE, HAS_EDITOR, { suites: SUITES })
  .filter((g) => !ONLY || ONLY.includes(g.id));
if (ONLY) {
  // "Complete" is a claim about the whole declared list; a narrowed run cannot
  // make it, and letting it try is how 69/69 got read as an answer about 80.
  if (COMPLETE) {
    console.error('run-gates: --only cannot be --complete — a narrowed run answers for the gates it named.');
    process.exit(2);
  }
  const missing = ONLY.filter((id) => !gates.some((g) => g.id === id));
  // A typo'd id silently running nothing is a green run that answered nothing —
  // the exact shape every gate in this repo exists to refuse.
  if (missing.length) {
    console.error(`run-gates: --only named ${missing.length} gate(s) this scope does not run:`
      + ` ${missing.join(', ')}`);
    process.exit(2);
  }
}
const skipped = GATES.filter((g) => g.where && g.where !== SCOPE);
/** Suites this run is not paying for — named, never silently absent. */
const unpaid = gatesFor(SCOPE, HAS_EDITOR)
  .filter((g) => g.covers?.length && !gates.includes(g));
/** Everything --only left out, suites included: a narrowed run answers for the
 *  gates it named and nothing else, and must not read as a list that went green. */
const narrowed = ONLY ? gatesFor(SCOPE, HAS_EDITOR).filter((g) => !gates.includes(g)) : [];
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
  if (unpaid.length && !ONLY) {
    const why = SUITE_MODE === 'owed'
      ? 'nothing changed under what they answer for; CI runs them all'
      : `--suites ${SUITE_MODE}; CI runs them`;
    console.log(`  test suites NOT run: ${unpaid.map((g) => g.id).join(', ')} — ${why}`);
  }
  if (narrowed.length) {
    console.log(`  --only: ${narrowed.length} gate(s) in this scope were NOT run, so this says`
      + ' nothing about them');
  }
}

/** What each gate cost, so the expensive ones are a measurement rather than a
 *  hunch — this list is ordered by hand and nothing was timing it. */
const spent = [];

/**
 * A gate that exits 2 said it could not answer, which is the runner's problem
 * and not the engine's — counted apart from a failure, and never as a pass.
 */
const CANNOT_ANSWER = 2;
/** Gates that answered nothing here. A hole, so `--complete` refuses on them. */
const unanswered = [];

/**
 * The line a reader wants out of a red gate's output. Gates print their own
 * verdict in their own shape, so this is a net over the shapes they use rather
 * than a parser for one — and the whole output is kept beside it, because a
 * guess at the interesting line is not a substitute for the log.
 */
const ASSERTION = /(^|\s)(✗|FAIL|FAILED|error|Error:|AssertionError|error TS\d+|✘|×)/;
function firstFailingLine(text) {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t && ASSERTION.test(t)) return t.slice(0, 300);
  }
  // Some gates say nothing and just exit non-zero; the last thing they said is
  // still more use than an empty cell.
  const said = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return said.length ? said[said.length - 1].slice(0, 300) : '(no output)';
}

/** What each gate answered, in scan mode. Ordered as the list is. */
const matrix = [];
let firstRed = null;

for (const gate of gates) {
  const began = Date.now();
  if (SCAN) process.stdout.write(`\n=== ${gate.id}\n    ${gate.run}\n`);
  // A scan keeps the output so the matrix can carry the failing line; a gate run
  // streams it, because a person is watching one command and wants it live.
  const r = SCAN
    ? spawnSync('sh', ['-c', gate.run], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    : spawnSync('sh', ['-c', gate.run], { cwd: ROOT, stdio: 'inherit' });
  const ms = Date.now() - began;
  spent.push({ id: gate.id, ms });
  // A shell that would not start is not a gate that failed. Reported as one it
  // sends the reader after the first gate's subject, which said nothing at all.
  if (r.error && !SCAN) {
    console.error(`\n✗ could not run the gates: ${r.error.message}`);
    console.error('  they are shell commands — run this from a shell that has `sh` on PATH.');
    process.exit(2);
  }
  if (SCAN) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(out);
    const status = r.error ? 'would-not-start'
      // Exit 2 is "this machine could not answer it", which is a hole and not a
      // verdict — counted apart, per check-unanswered-exits, so a scan does not
      // report a missing toolchain as a broken subject.
      : r.status === 2 ? 'unanswered'
        : r.status === 0 ? 'pass' : 'fail';
    if (status !== 'pass' && status !== 'unanswered' && !firstRed) firstRed = gate.id;
    matrix.push({
      id: gate.id,
      run: gate.run,
      status,
      exit: r.error ? null : r.status,
      secs: +(ms / 1000).toFixed(1),
      suite: !!gate.covers?.length,
      // Ordering is load-bearing here, so a red behind another red is a
      // candidate for the invented problem the short-circuit exists to avoid.
      afterRed: status !== 'pass' && status !== 'unanswered' && firstRed !== gate.id,
      firstFailingLine: status === 'pass' ? null
        : r.error ? r.error.message : firstFailingLine(out),
    });
    console.log(status === 'pass' ? `✓ ${gate.id} (${(ms / 1000).toFixed(0)}s)`
      // Three marks for three states: a gate that could not answer is not a red
      // one, and a scan that draws them the same makes the survey unreadable.
      : status === 'unanswered' ? `— ${gate.id} — answered nothing (${(ms / 1000).toFixed(0)}s)`
        : `✗ ${gate.id} — ${status} (${(ms / 1000).toFixed(0)}s)`);
    continue;
  }
  // Eight gates already exit 2 for "could not answer" and this runner heard it as
  // "the subject is broken", reporting a missing Python as a red gate and
  // stopping the sixty behind it. run-release-gate's convention, here too.
  if (r.status === CANNOT_ANSWER) {
    console.error(`\n— ${gate.id} UNANSWERED — nothing here could answer it (see its output above)`);
    unanswered.push(gate.id);
    continue;
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

if (SCAN) {
  // Unanswered is neither: counted apart so a survey does not read a missing
  // toolchain as a broken subject, and never folded into the green count.
  const blank = matrix.filter((m) => m.status === 'unanswered');
  const red = matrix.filter((m) => m.status !== 'pass' && m.status !== 'unanswered');
  console.log(`\ngates ${SCOPE} SCAN: ${matrix.length - red.length - blank.length}/${matrix.length} green`
    + ` in ${(spent.reduce((t, g) => t + g.ms, 0) / 1000).toFixed(0)}s`);
  for (const m of red) {
    console.log(`  ✗ ${m.id} — ${m.status}${m.exit === null ? '' : ` (exit ${m.exit})`}`
      + `${m.afterRed ? ' [after-red: may be downstream]' : ''}`);
    console.log(`      ${m.firstFailingLine}`);
  }
  for (const m of blank) {
    console.log(`  — ${m.id} — answered nothing here`);
    console.log(`      ${m.firstFailingLine}`);
  }
  if (noEditor.length) {
    console.log(`  ${noEditor.length} editor gate(s) had no checkout: ${noEditor.map((g) => g.id).join(', ')}`);
  }
  reportSuites();
  for (const g of skipped) console.log(`  not in this scope: ${g.id} — ${g.why}`);
  // A scan is not a verdict, and saying so is the whole reason it is a separate
  // mode: reds after the first may be the ordering's invented problem.
  if (red.some((m) => m.afterRed)) {
    console.log('\n  reds marked [after-red] ran on a tree an earlier gate said was broken —'
      + ' re-run them once the earlier ones are green before believing them.');
  }
  if (MATRIX) {
    writeFileSync(MATRIX, `${JSON.stringify({
      scope: SCOPE, host: process.platform, at: new Date().toISOString(),
      declared: GATES.length, ran: matrix.length,
      noEditor: noEditor.map((g) => g.id),
      notInScope: skipped.map((g) => g.id),
      gates: matrix,
    }, null, 2)}\n`);
    console.log(`  matrix written to ${MATRIX}`);
  }
  // A survey that could not answer some of the list has not said the list is
  // green; 2 rather than 1, because the fix is the runner's and not the engine's.
  process.exit(red.length ? 1 : blank.length ? CANNOT_ANSWER : 0);
}

console.log(`\ngates ${SCOPE}: ${gates.length - unanswered.length}/${gates.length} green`
  + ` in ${(spent.reduce((t, g) => t + g.ms, 0) / 1000).toFixed(0)}s`
  + (noEditor.length ? ` (${noEditor.length} editor gate(s) had no checkout to run against)` : ''));
// Said at the top of the summary, not buried: a count that reads as the whole
// list is exactly how a skip becomes a green light.
if (unanswered.length) {
  console.log(`  ${unanswered.length} gate(s) answered nothing here: ${unanswered.join(', ')}`);
}
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
    // A gate that ran and could not answer is the same hole as one that never
    // ran. `static-gates` read 118/118 green while check-native-build built
    // nothing, because only the text said so.
    ...unanswered,
  ];
  if (holes.length) {
    console.error(`\n${holes.length} declared gate(s) or capability gap(s) never ran here: ${holes.join(', ')}`);
    console.error('  --complete was asked for, so this cannot say the list is green.');
    process.exit(2);
  }
}
