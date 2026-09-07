#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-suite-ownership.mjs — every suite says what SOURCE it answers for,
 *        and that claim resolves.
 *
 * `covers` made "the gate list is green" mean something by naming the tests a
 * suite runs. `owns` is the other direction — the source whose direct unit-test
 * owner that suite IS — and it is what `--suites owed` reads to decide which
 * suites a push has to pay for. A stale root there owns nothing, silently, and
 * the hole it leaves looks exactly like a clean diff: no suite owed, push green,
 * the double that stands in for the changed tool never compared against it.
 *
 * So the claim is checked rather than trusted: the roots exist, the tests a
 * suite runs live inside the source it answers for, and the mapping actually
 * resolves — a file under a suite's own corpus must owe that suite.
 *
 * Run: node tools/check-suite-ownership.mjs
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES, owedSuites } from './gates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAS_EDITOR = existsSync(path.join(ROOT, 'desktop', 'package.json'));

const findings = [];
const suites = GATES.filter((g) => g.covers?.length);
let roots = 0;
let skipped = 0;

for (const gate of suites) {
  // A suite that answers for nothing can never be owed, so a push would never
  // run it and nothing would say why. That is the shape this file exists for.
  if (!gate.owns?.length) {
    findings.push(`${gate.id} runs a suite but declares no \`owns\` — no change can ever owe it`);
    continue;
  }
  for (const root of gate.owns) {
    // The editor is an optional submodule; an absent checkout is not a stale root.
    if (!HAS_EDITOR && root === 'desktop') { skipped++; continue; }
    roots++;
    if (!existsSync(path.join(ROOT, root))) {
      findings.push(`${gate.id} owns "${root}", which is not in the tree — it owns nothing`);
    }
  }
  for (const dir of gate.covers) {
    if (!HAS_EDITOR && dir.startsWith('desktop/')) continue;
    if (!gate.owns.some((r) => dir === r || dir.startsWith(`${r}/`))) {
      findings.push(`${gate.id} runs ${dir}, which is outside everything it says it answers for `
        + `(${gate.owns.join(', ')}) — one of the two has been moved`);
    }
    // The table is only worth having if it resolves. A file inside a suite's own
    // corpus is the one path that must owe it.
    const probe = `${dir}/probe.test.ts`;
    if (!owedSuites([probe]).has(gate.id)) {
      findings.push(`${gate.id} is not owed by ${probe}, a file in the corpus it runs — `
        + 'the ownership lookup does not reach it');
    }
  }
}

if (findings.length === 0) {
  console.log(`check-suite-ownership: ${suites.length} suite(s) answer for ${roots} source root(s)`
    + `${skipped ? `, ${skipped} not checked without an editor checkout` : ''}; every corpus resolves.`);
  process.exit(0);
}
for (const f of findings) console.error(`  - ${f}`);
console.error(`\ncheck-suite-ownership: ${findings.length} finding(s).`);
process.exit(1);
