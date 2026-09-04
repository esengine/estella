// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-sdk-test-types.mjs — the test corpus is inside a type checker.
 *
 * `sdk/tsconfig.json` compiles `src/**` and emits `dist/`, so the 478 test files
 * beside it were never in any checker's scope; vitest strips types and never
 * looks. A fixture could go stale against the API it tests and stay green — one
 * did, three commits ago: literal schemas missing a field the handshake had
 * gained, running fine because both sides read `undefined`.
 *
 * This is not a demand for zero. There are 220 diagnostics of history here and
 * clearing them is not this gate's job. It is a RATCHET: no new debt, and debt
 * that gets paid is banked so it cannot come back.
 *
 * Identity is (file, error code, message) with a COUNT — never line and column,
 * or inserting two lines would churn the whole baseline.
 *
 *   node tools/check-sdk-test-types.mjs            # check
 *   node tools/check-sdk-test-types.mjs --update   # bank the current state
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = path.join(ROOT, 'sdk');
const TSC = path.join(SDK, 'node_modules', 'typescript', 'bin', 'tsc');
const CONFIG = path.join(SDK, 'tsconfig.tests.json');
const BASELINE = path.join(ROOT, 'tools', 'baselines', 'sdk-test-types.json');

/**
 * Areas held to zero. The networking suites are becoming certification-grade,
 * and a mechanism experiment run on fixtures that no longer type-check against
 * the API is worse than one that fails. (Flat file names rather than a `net/`
 * directory: sdk/tests has no subdirectories.)
 */
const ZERO_DEBT = {
  label: 'sdk/tests/{net-*,replication*,websocket}',
  match: (file) => /^tests\/(net-|replication|websocket)/.test(file),
};

const UPDATE = process.argv.includes('--update');

function fail(message, detail) {
  console.error(`check-sdk-test-types: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

const run = spawnSync(process.execPath, [TSC, '-p', CONFIG], { encoding: 'utf8', cwd: SDK });
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
if (run.status !== 0 && !/error TS\d+/.test(output)) {
  fail('tsc did not run.', output.slice(0, 2000));
}

const ROOT_POSIX = ROOT.split(path.sep).join('/');

/**
 * The checkout's own location, out of the message text. TS7016 and friends name
 * the resolved module by ABSOLUTE path, so an identity built from the raw
 * message is per-machine: a baseline banked on one checkout reported three
 * phantom "new" diagnostics on every other one, including CI, where the same
 * three were already banked under a different prefix.
 */
const unroot = (msg) => msg.split(`${ROOT_POSIX}/`).join('').split(ROOT_POSIX).join('');

/** file → "TSxxxx|message" → count. Continuation lines are indented; skip them. */
const current = {};
const LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
for (const line of output.split(/\r?\n/)) {
  const m = LINE.exec(line);
  if (!m) continue;
  const file = m[1].split(path.sep).join('/');
  const key = `${m[4]}|${unroot(m[5])}`;
  (current[file] ??= {});
  current[file][key] = (current[file][key] ?? 0) + 1;
}

const total = (map) => Object.values(map).reduce((n, per) => n + Object.values(per).reduce((a, b) => a + b, 0), 0);

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

if (UPDATE) {
  const offenders = Object.keys(current).filter(ZERO_DEBT.match).sort();
  if (offenders.length > 0) {
    fail(`refusing to bank debt under ${ZERO_DEBT.label} — it is held to zero.`,
      offenders.map((f) => `  ${f}`).join('\n'));
  }
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(current).sort().map((f) => [
    f, Object.fromEntries(Object.keys(current[f]).sort().map((k) => [k, current[f][k]])),
  ]));
  writeFileSync(BASELINE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`check-sdk-test-types: banked ${total(current)} diagnostic(s) in ${Object.keys(current).length} file(s).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

if (!existsSync(BASELINE)) fail(`no baseline at ${BASELINE} — run with --update once to create it.`);
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

const added = [];
const resolved = [];
for (const [file, per] of Object.entries(current)) {
  for (const [key, count] of Object.entries(per)) {
    const known = baseline[file]?.[key] ?? 0;
    if (count > known) added.push({ file, key, delta: count - known });
  }
}
for (const [file, per] of Object.entries(baseline)) {
  for (const [key, count] of Object.entries(per)) {
    const now = current[file]?.[key] ?? 0;
    if (now < count) resolved.push({ file, key, delta: count - now });
  }
}

// Held-to-zero areas answer for themselves, baseline or not.
const zeroBreaches = Object.keys(current).filter(ZERO_DEBT.match).sort();
if (zeroBreaches.length > 0) {
  fail(`${ZERO_DEBT.label} is held to zero type debt; ${zeroBreaches.length} file(s) have some.`,
    zeroBreaches.map((f) => `  ${f}: ${Object.keys(current[f]).join('; ')}`).join('\n'));
}

if (added.length > 0) {
  fail(`${added.reduce((n, a) => n + a.delta, 0)} new type diagnostic(s) in the SDK test corpus.`
    + ' vitest strips types, so nothing else would have told you.',
    added.map((a) => `  ${a.file}  (+${a.delta})  ${a.key}`).join('\n'));
}

if (resolved.length > 0) {
  fail(`${resolved.reduce((n, r) => n + r.delta, 0)} diagnostic(s) were FIXED — good, but the baseline`
    + ' still allows them back. Bank it: node tools/check-sdk-test-types.mjs --update',
    resolved.map((r) => `  ${r.file}  (-${r.delta})  ${r.key}`).join('\n'));
}

console.log(`check-sdk-test-types: known debt ${total(baseline)} in ${Object.keys(baseline).length} file(s),`
  + ` new 0, resolved 0 — and ${ZERO_DEBT.label} carries none.`);
