// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-golden.mjs — the certification corpus says what it covers, or says why not.
 *
 * The Golden Project Suite is an argument that a release ships working games. An
 * argument with a silent hole in it is worse than no argument: "the suite is
 * green" then means "the suite is green about the things it happens to run".
 *
 * So every capability the suite claims must have a project behind it, every
 * project must exist and be packageable, and every target must be a real export
 * target. A capability nothing covers is allowed — declared in KNOWN_GAPS, with
 * a reason, so the hole is a sentence somebody wrote.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GOLDEN, CAPABILITIES, KNOWN_GAPS, TIERS, TARGETS,
  atTier, uncoveredCapabilities, nonGoldenExamples, projectDir, parityFor, interactFor,
} from './goldenProjects.mjs';

const problems = [];
const fail = (msg) => problems.push(msg);

// 1. Every golden id is a project that exists and declares a scene to open.
const seen = new Set();
for (const g of GOLDEN) {
  if (seen.has(g.id)) fail(`"${g.id}" is listed twice`);
  seen.add(g.id);

  const manifest = path.join(projectDir(g.id), 'project.esproject');
  if (!existsSync(manifest)) {
    fail(`"${g.id}" has no examples/${g.id}/project.esproject — a golden project must be packageable`);
    continue;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch (e) {
    fail(`"${g.id}" has an unreadable manifest: ${e.message}`);
    continue;
  }
  // Every stage after "open" needs a scene to open; an export with no entry
  // scene packages an empty game and still exits 0.
  const scene = parsed.defaultScene;
  if (!scene) fail(`"${g.id}" declares no defaultScene — the chain has nothing to open`);
  else if (!existsSync(path.join(projectDir(g.id), scene))) {
    fail(`"${g.id}" names a defaultScene that is not there: ${scene}`);
  }

  if (!TIERS.includes(g.tier)) fail(`"${g.id}" has tier "${g.tier}" (have: ${TIERS.join(', ')})`);
  if (!g.targets?.length) fail(`"${g.id}" names no targets — then nothing packages it`);
  for (const t of g.targets ?? []) {
    if (!TARGETS.includes(t)) fail(`"${g.id}" names target "${t}" (have: ${TARGETS.join(', ')})`);
  }
  // Parity is the release's own claim, so opting out of it is a sentence, not a flag.
  if (g.parityGap !== undefined && !(typeof g.parityGap === 'string' && g.parityGap.trim())) {
    fail(`"${g.id}" sets parityGap without a reason — say why its frames cannot be compared`);
  }
  if (g.parity !== undefined && !(typeof g.parity === 'number' && g.parity > 0 && g.parity < 1)) {
    fail(`"${g.id}" has parity ${g.parity} — expected a tolerance between 0 and 1`);
  }
  if (g.parity !== undefined && g.parityGap) fail(`"${g.id}" both sets a parity tolerance and opts out`);
  // Same bargain as parity: a project that cannot be driven says why.
  if (g.interactGap !== undefined && !(typeof g.interactGap === 'string' && g.interactGap.trim())) {
    fail(`"${g.id}" sets interactGap without a reason — say why nothing can be pressed`);
  }
  if (g.interact && g.interactGap) fail(`"${g.id}" both declares input and opts out of it`);
  if (!g.interact && !g.interactGap) {
    fail(`"${g.id}" neither declares input nor says why it has none — the chain has no interact step for it`);
  }
  if (g.interact && !(g.interact.keys?.length > 0)) fail(`"${g.id}" declares input with no keys to hold`);
  if (!g.certifies?.length) fail(`"${g.id}" certifies nothing — say what it is in the suite for`);
  for (const c of g.certifies ?? []) {
    if (!CAPABILITIES.includes(c)) fail(`"${g.id}" certifies "${c}", which is not a declared capability`);
  }
}

// 2. No capability is claimed by the suite and covered by nobody.
for (const c of uncoveredCapabilities()) {
  fail(`nothing certifies "${c}" — add a project, or declare the gap in KNOWN_GAPS with a reason`);
}

// 3. A declared gap that something now covers is stale bookkeeping.
const covered = new Set(GOLDEN.flatMap((g) => g.certifies));
for (const c of Object.keys(KNOWN_GAPS)) {
  if (!CAPABILITIES.includes(c)) fail(`KNOWN_GAPS names "${c}", which is not a declared capability`);
  else if (covered.has(c)) fail(`"${c}" is declared a gap but ${[...covered].includes(c) ? 'a project certifies it' : ''} — drop the entry`);
}

// 4. Every tier can actually run something.
for (const tier of TIERS) {
  if (atTier(tier).length === 0) fail(`tier "${tier}" selects no projects`);
}

if (problems.length) {
  console.error('check-golden: the certification corpus does not hold up.\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const noParity = GOLDEN.filter((g) => parityFor(g) === null);
const driven = GOLDEN.filter((g) => interactFor(g) !== null);
const gaps = Object.keys(KNOWN_GAPS).length;
const pairs = TIERS.map((t) => `${t} ${atTier(t).length}`).join(' / ');
console.log(
  `check-golden: ${GOLDEN.length} golden project(s) certify ${covered.size}/${CAPABILITIES.length} capabilities`
  + `, ${gaps} declared gap(s) — ok (${pairs})`,
);
console.log(`  ${driven.length} project(s) drive their package with input; ${GOLDEN.length - driven.length} say why they cannot`);
for (const g of noParity) console.log(`  no editor/package comparison for ${g.id}: ${g.parityGap}`);
const rest = nonGoldenExamples();
if (rest.length) console.log(`  ${rest.length} example(s) outside the corpus (smoke-tested, not certified)`);
