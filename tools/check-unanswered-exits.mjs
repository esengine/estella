// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-unanswered-exits.mjs — a checker that did nothing must not exit 0.
 *
 * verify-aot-native and the AOT frame bench printed "did NOT run" and exited 0.
 * Both comments said the saying was the point — "loud, not silent" — but the
 * release runner reads a status, so four criteria were recorded as answered on
 * a machine that never had a runtime template to measure. 11/27 was reported as
 * 15/27, and three compiled-system ceilings had been green for as long as the
 * runner existed.
 *
 * 2 is the convention for "this machine cannot answer", which run-release-gate
 * counts apart from a pass and apart from a failure. This refuses the shape that
 * made the lie: a verifier a criterion depends on, announcing that it skipped,
 * and then leaving with the status of a verifier that did the work.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRITERIA } from './releaseGate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** What a checker says when it is about to report on work it did not do. */
const ANNOUNCES_A_SKIP = /(did NOT run|SKIP\b|— skipped|nothing was checked|was not scanned|could not configure here)/;

/** Every script a criterion's command names, which is the surface this covers:
 *  a tool nothing depends on may exit however it likes. */
const named = new Set();
for (const c of CRITERIA) {
  for (const m of (c.answeredBy ?? '').matchAll(/(?:^|\s)((?:tools|bench)\/[\w./-]+\.mjs)/g)) named.add(m[1]);
}

const problems = [];
for (const rel of [...named].sort()) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/process\.exit\(0\)/.test(line)) return;
    // The announcement is in the console call just above the exit it belongs to.
    const said = lines.slice(Math.max(0, i - 8), i).join('\n');
    if (!/console\.(log|error)/.test(said) || !ANNOUNCES_A_SKIP.test(said)) return;
    // A skip a CALLER asked for is a different thing, and the criterion is not
    // that caller. Declared beside the exit, so the next reader sees the reason
    // rather than trusting that someone checked.
    if (/caller-asked-to-skip:/.test(said)) return;
    problems.push(`${rel}:${i + 1} — announces a skip, then exits 0 (a criterion reads that as answered)`);
  });
}

if (!named.size) {
  console.error('check-unanswered-exits: no criterion names a script — this scan is broken.');
  process.exit(1);
}
if (problems.length) {
  console.error('check-unanswered-exits: exit 2 means "this machine cannot answer"; 0 means answered.');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-unanswered-exits: ${named.size} script(s) answer criteria; none reports a skip as a pass.`);
