// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-decision-inventory.mjs — the declared runtime decisions still say
 *        something true, and the debt between their three surfaces is counted.
 *
 * runtimeDecisions.mjs names, for each choice the engine makes on a creator's
 * behalf, whether the runtime records WHY, whether the editor shows it, and
 * whether the automation surface answers the same question. This holds those
 * claims against the tree: a probe that no longer finds its subject is a finding,
 * not documentation, and an `owed` that has quietly been paid is bookkeeping that
 * stopped being true.
 *
 * It reports rather than ratchets. The debt here is a roadmap, not a regression:
 * failing on its size would only invite entries to be deleted. What it FAILS on
 * is a lie — a citation pointing nowhere, or a surface claimed and unfindable.
 *
 *   node tools/check-decision-inventory.mjs [--list]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECISIONS } from './lib/runtimeDecisions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SURFACES = ['runtime', 'editor', 'agent'];

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Every file under a directory, so a directory citation can be probed. */
function filesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else out.push(full);
  }
  return out;
}

/** Null when the citation still finds what it says, else why not. */
function probeHolds(cite) {
  const full = path.join(ROOT, cite.path);
  if (!existsSync(full)) return 'does not exist';
  if (cite.dir) {
    for (const f of filesUnder(full)) {
      if (cite.probe.test(readFileSync(f, 'utf8'))) return null;
    }
    return `no file under it matches ${cite.probe}`;
  }
  return cite.probe.test(read(cite.path)) ? null : `does not match ${cite.probe}`;
}

// The editor is an optional submodule; a citation into it cannot be judged
// without one. Named, never rounded down to a pass.
const HAS_EDITOR = existsSync(path.join(ROOT, 'desktop', 'src'));

const problems = [];
const skipped = [];
const owed = [];
let claimed = 0;

for (const d of DECISIONS) {
  const cites = [['owner', d.owner], ...SURFACES.map((s) => [s, d[s]?.has ? d[s].cite : null])];
  for (const [role, cite] of cites) {
    if (!cite) continue;
    if (!HAS_EDITOR && cite.path.startsWith('desktop/')) { skipped.push(`${d.id} → ${role}`); continue; }
    claimed++;
    const why = probeHolds(cite);
    if (why) problems.push(`${d.id} → ${role}: ${cite.path} ${why}`);
  }
  for (const s of SURFACES) {
    const surface = d[s];
    if (!surface) { problems.push(`${d.id} says nothing about its ${s} surface`); continue; }
    if (!surface.has && !surface.owed && !surface.unavailable) {
      problems.push(`${d.id} → ${s} is absent with no reason`);
    }
    if (surface.has && (surface.owed || surface.unavailable)) {
      problems.push(`${d.id} → ${s} both claims a surface and explains its absence`);
    }
    // Two defects, counted apart: one is a reader nobody wrote, the other is a
    // fact this realm never produces. Only the first is a panel.
    if (!surface.has) {
      owed.push({
        id: d.id, surface: s, why: surface.owed ?? surface.unavailable,
        kind: surface.unavailable ? 'unavailable' : 'owed',
      });
    }
  }
}

/**
 * The shapes worth naming apart, in the order they are worth fixing.
 *
 * `realm prerequisite` comes first because it makes the others meaningless: a
 * surface can only owe a READER where the decision is actually taken.
 * residency.cellDemand read as "runtime > editor" for a whole pass while no
 * editor realm instantiated streaming at all — a panel built on that label would
 * have shown zeros for ever, and passed any gate that asked only whether a panel
 * existed.
 *
 * `human > agent` is last: it breaks no principle — automation is not owed more
 * than a person — and is still a surface that is not finished.
 */
const imbalance = (d) => {
  if (SURFACES.some((s) => d[s]?.unavailable)) return 'realm prerequisite';
  if (!d.runtime?.has) return 'decision > explanation';
  if (d.agent?.has && !d.editor?.has) return 'agent > human';
  if (!d.editor?.has) return 'runtime > editor';
  if (!d.agent?.has) return 'human > agent';
  return null;
};

if (process.argv.includes('--list')) {
  const width = Math.max(...DECISIONS.map((d) => d.id.length));
  console.log(`${'decision'.padEnd(width)}  runtime editor agent  imbalance`);
  for (const d of DECISIONS) {
    const mark = (s) => (d[s]?.has ? '  ok   ' : ' owed  ');
    console.log(`${d.id.padEnd(width)} ${mark('runtime')}${mark('editor')}${mark('agent')} ${imbalance(d) ?? 'complete'}`);
  }
  for (const kind of ['owed', 'unavailable']) {
    const rows = owed.filter((o) => o.kind === kind);
    if (!rows.length) continue;
    console.log(`\n${kind} (${rows.length}):`);
    for (const o of rows) console.log(`  ${o.id} → ${o.surface}: ${o.why}`);
  }
}

if (skipped.length) {
  console.log(`check-decision-inventory: no editor checkout — ${skipped.length} citation(s) not judged:`
    + ` ${skipped.join(', ')}`);
}
if (problems.length) {
  console.error(`check-decision-inventory: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\n  A citation that no longer finds its subject is a finding: either the decision moved'
    + '\n  and the entry follows it, or the entry was never true.');
  process.exit(1);
}
const counts = {};
for (const d of DECISIONS) counts[imbalance(d) ?? 'complete'] = (counts[imbalance(d) ?? 'complete'] ?? 0) + 1;
console.log(`check-decision-inventory: ${DECISIONS.length} decision(s), ${claimed} citation(s) hold — `
  + Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')
  + ` (${owed.length} owed surface(s); --list names them).`);
