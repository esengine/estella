// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-release-gate — every exit criterion still has something answering it.
 *
 * The failure this exists for is quiet: a verifier gets renamed or dropped, the
 * criterion it settled stays on the list, and the release ships against a rule
 * nothing was checking. Holding the two together is the only way the list means
 * anything a month after it was written.
 *
 *   node tools/check-release-gate.mjs            # hold the list together
 *   node tools/check-release-gate.mjs --report   # print it, to run or to paste
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE, CRITERIA } from './releaseGate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (m) => problems.push(m);
const HAS_EDITOR = existsSync(path.join(ROOT, 'desktop', 'package.json'));
const unanswerable = new Set();

const seen = new Set();
for (const c of CRITERIA) {
  if (!c.id) { fail('a criterion has no id'); continue; }
  if (seen.has(c.id)) fail(`"${c.id}" is listed twice`);
  seen.add(c.id);

  if (!c.says?.trim()) fail(`"${c.id}" does not say what it requires`);
  if (!c.answeredBy && !c.manual) {
    fail(`"${c.id}" has neither a command nor a named owner — it is a wish, not a criterion`);
  }
  if (c.answeredBy && c.manual) fail(`"${c.id}" is both automated and manual — pick one`);
  if (c.manual !== undefined && !(typeof c.manual === 'string' && c.manual.trim())) {
    fail(`"${c.id}" is manual without saying who does it and why a machine cannot`);
  }
  // The point of `needs`: a verifier that is deleted or renamed fails HERE,
  // loudly, rather than at whatever moment somebody trusts the list next.
  if (c.answeredBy && !c.needs?.length) fail(`"${c.id}" names a command but no file it lives in`);
  for (const rel of c.needs ?? []) {
    if (existsSync(path.join(ROOT, rel))) continue;
    // A verifier that lives in the editor cannot be found from a checkout without
    // one. Counted and reported below rather than failed: it is a criterion this
    // checkout cannot answer, which is a different verdict from a broken one.
    if (!HAS_EDITOR && rel.startsWith('desktop/')) { unanswerable.add(c.id); continue; }
    fail(`"${c.id}" needs ${rel}, which is not there`);
  }
}
if (unanswerable.size) {
  console.log(`check-release-gate: no editor checkout — ${unanswerable.size} criterion(s) cannot be answered here:`
    + ` ${[...unanswerable].join(', ')}`);
}

if (problems.length) {
  console.error(`check-release-gate: the ${RELEASE} exit criteria do not hold together.\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

if (process.argv.includes('--report')) {
  const auto = CRITERIA.filter((c) => c.answeredBy);
  const manual = CRITERIA.filter((c) => c.manual);
  console.log(`# ${RELEASE} exit criteria\n`);
  console.log(`## Run (${auto.length})\n`);
  for (const c of auto) console.log(`- [ ] **${c.id}** — ${c.says}\n      \`${c.answeredBy}\``);
  console.log(`\n## By hand (${manual.length})\n`);
  for (const c of manual) console.log(`- [ ] **${c.id}** — ${c.says}\n      ${c.manual}`);
  process.exit(0);
}

const auto = CRITERIA.filter((c) => c.answeredBy).length;
console.log(
  `check-release-gate: ${CRITERIA.length} ${RELEASE} criteria — ${auto} have a command,`
  + ` ${CRITERIA.length - auto} are owned by a person — ok`,
);
