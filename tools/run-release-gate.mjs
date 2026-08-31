// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  run-release-gate — run the exit criteria, and say what they answered.
 *
 * releaseGate.mjs ends with "this says the criteria are OWNED; whether they PASS
 * is what running them says" — and nothing ran them. The list had the half that
 * check-release-gate polices (every criterion still has a command) and not the
 * half that reports a verdict, so the only runner was a person typing 27
 * commands. hot-update-lands-or-rolls-back was deterministically broken for
 * days behind that gap.
 *
 * This is run-gates.mjs for the release list, and deliberately its twin: one
 * ordered list, a runner over it, and everything it did NOT run said out loud.
 *
 *   node tools/run-release-gate.mjs           # run them
 *   node tools/run-release-gate.mjs --plan    # what would run, and what cannot
 *   node tools/run-release-gate.mjs --only golden,aot
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE, CRITERIA } from './releaseGate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const ONLY = flag('only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

const automated = CRITERIA.filter((c) => c.answeredBy)
  .filter((c) => !ONLY || ONLY.some((o) => c.id.includes(o)));
const manual = CRITERIA.filter((c) => c.manual);

/**
 * One run per COMMAND, not per criterion: five criteria name
 * `verify-golden --tier release` and three name the AOT frame bench, and paying
 * for each of them separately would say the same thing five times and cost five
 * times as much. The verdict is attributed back to every criterion that asked.
 */
const jobs = [];
for (const c of automated) {
  const at = jobs.find((j) => j.run === c.answeredBy);
  if (at) at.ids.push(c.id);
  else jobs.push({ run: c.answeredBy, ids: [c.id] });
}

console.log(`release gate ${RELEASE}: ${automated.length} criteria in ${jobs.length} command(s)`
  + (ONLY ? ` (--only ${ONLY.join(',')})` : ''));

if (argv.includes('--plan')) {
  for (const j of jobs) console.log(`  ${j.ids.join(', ')}\n      ${j.run}`);
  for (const m of manual) console.log(`  BY HAND  ${m.id} — ${m.manual}`);
  process.exit(0);
}

// Every criterion, not the first failure: which of them a release is short of is
// the useful answer, and stopping early turns the rest into silence — the same
// reason verify-render reports its whole matrix.
const failed = [];
for (const j of jobs) {
  const began = Date.now();
  process.stdout.write(`\n=== ${j.ids.join(', ')}\n    ${j.run}\n`);
  const r = spawnSync('sh', ['-c', j.run], { cwd: ROOT, stdio: 'inherit' });
  const secs = ((Date.now() - began) / 1000).toFixed(0);
  if (r.error) {
    console.error(`✗ could not run it: ${r.error.message}`);
    failed.push({ ...j, secs, why: 'would not start' });
  } else if (r.status !== 0) {
    console.error(`✗ FAIL (${secs}s)`);
    failed.push({ ...j, secs, why: `exit ${r.status}` });
  } else {
    console.log(`✓ PASS (${secs}s)`);
  }
}

const short = failed.flatMap((j) => j.ids);
console.log(`\nrelease gate ${RELEASE}: ${automated.length - short.length}/${automated.length} criteria answered`);
for (const j of failed) console.log(`  ✗ ${j.ids.join(', ')} — ${j.why}`);
// Named, always: a release is not ready because 27 commands went green, and a
// summary that omits the four nobody can automate reads as though it is.
console.log(`  ${manual.length} criteria are BY HAND and this cannot answer them:`);
for (const m of manual) console.log(`      ${m.id} — ${m.manual}`);
process.exit(short.length ? 1 : 0);
