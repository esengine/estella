// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-mutator-parity.mjs — automation may not reach a project setting a
 *        person cannot.
 *
 * The editor has a built-in agent, and every project mutator is exposed to it
 * through one facade. That is the right shape until a mutator has ONLY that
 * caller: `setAudio` writes bus volumes, effects and duck rules, is reachable
 * from the automation surface, and has no button, row or panel anywhere — so an
 * agent can author the project mixer and the person who owns the project cannot.
 * `setSpineVersion` decides which Spine runtime ships, with the same asymmetry.
 *
 * Neither was a decision. Both were a UI nobody got to, behind a facade that
 * reaches everything by construction — which is why this is discovered rather
 * than declared: the list of what a person can do is not one anybody maintains.
 *
 * The rule is one-directional on purpose. A person reaching something automation
 * cannot is fine; automation reaching what a person cannot is the product saying
 * the model is the creator.
 *
 *   node tools/check-mutator-parity.mjs [--list]
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDITOR = path.join(ROOT, 'desktop', 'src');
const STORE = path.join(EDITOR, 'project', 'ProjectStore.ts');
/** The automation facade and the surface behind it: a call from here is the AGENT's. */
const AUTOMATION = new Set([
  path.join(EDITOR, 'main.tsx'),
  path.join(EDITOR, 'engine', 'EditorControlSurface.ts'),
]);

/**
 * Mutators a person reaches through a DIFFERENT door, and which one. Not
 * exemptions: each names the sibling that carries the human path, and the gate
 * checks that sibling is itself reachable — an alias for a hole is a hole.
 */
const REACHED_VIA = {
  setImportSettings: 'setImportSettingsMany',
};

/**
 * The two that are violations, recorded as violations. Debt, not exemption: an
 * entry leaves this block by growing a human door, never by being explained, and
 * adding one is a visible diff — which is the only ratchet a discovered list can
 * have without becoming a place to put the next one.
 */
const OWED = {
  setAudio: 'bus volumes, effects and duck rules ship in every build and there is no Mixer panel '
    + 'and no project.audio.* row — Audio Authoring v1',
  setSpineVersion: 'which Spine runtime the project bundles, a size and compatibility decision with '
    + 'only a read-only diagnostics line in the UI',
};

if (!existsSync(EDITOR)) {
  console.log('check-mutator-parity: no editor checkout — no mutator was judged.');
  process.exit(0);
}

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const store = readFileSync(STORE, 'utf8');
// The public write door: every `set*`/`patch*` method the store declares.
const mutators = [...new Set([...store.matchAll(/^\s{2}(?:async\s+)?(set[A-Z]\w*|patch[A-Z]\w*)\s*[(<]/gm)]
  .map((m) => m[1]))];

const files = sources(EDITOR).filter((f) => f !== STORE);
/** Who calls each mutator, split by whose hand is on it. */
const callers = new Map(mutators.map((m) => [m, { agent: 0, human: 0 }]));
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const agent = AUTOMATION.has(file);
  for (const m of mutators) {
    const hits = (src.match(new RegExp(`ProjectStore\\.${m}\\s*\\(`, 'g')) ?? []).length;
    if (!hits) continue;
    callers.get(m)[agent ? 'agent' : 'human'] += hits;
  }
}

const problems = [];
// The fact first, the bookkeeping second: a mutator automation calls and no UI
// does is automation-only whether or not somebody has written a note about it.
const agentOnly = [...callers].filter(([, c]) => c.agent > 0 && c.human === 0).map(([m]) => m);
const onlyAgent = [];
for (const m of agentOnly) {
  const via = REACHED_VIA[m];
  if (!via) { onlyAgent.push(m); continue; }
  if (!callers.has(via)) {
    problems.push(`REACHED_VIA.${m} names "${via}", which ProjectStore does not declare`);
  } else if (callers.get(via).human === 0) {
    problems.push(`${m} is declared reachable through ${via}, and ${via} has no human caller either`
      + ' — the alias points at the same hole');
  }
}
const owed = [];
for (const m of onlyAgent) {
  if (OWED[m]) { owed.push(`  ${m} — ${OWED[m]}`); continue; }
  problems.push(`ProjectStore.${m} is called by the automation facade and by nothing a person can`
    + ' touch — an agent can change this project setting and its owner cannot. Give it a row, a'
    + ' button or a panel, or name the door a person uses in REACHED_VIA');
}
for (const m of Object.keys(OWED)) {
  if (!agentOnly.includes(m)) {
    problems.push(`OWED names ${m}, which a person can now reach — drop the entry rather than`
      + ' leaving a paid debt on the books');
  }
}
// A named door for a mutator that needs no door is a sentence nobody rereads,
// and the next reader takes it for a decision.
for (const m of Object.keys(REACHED_VIA)) {
  if (!agentOnly.includes(m)) {
    problems.push(`REACHED_VIA names ${m}, which is not automation-only — the entry answers a`
      + ' question nothing asks');
  }
}

if (process.argv.includes('--list')) {
  const width = Math.max(...mutators.map((m) => m.length));
  console.log(`${'mutator'.padEnd(width)} agent human`);
  for (const [m, c] of [...callers].sort((a, b) => a[1].human - b[1].human)) {
    console.log(`${m.padEnd(width)} ${String(c.agent).padStart(5)} ${String(c.human).padStart(5)}`
      + `${REACHED_VIA[m] ? `  via ${REACHED_VIA[m]}` : ''}`);
  }
}

if (problems.length) {
  console.error(`check-mutator-parity: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (owed.length) console.log(`check-mutator-parity: ${owed.length} owed a human door:\n${owed.join('\n')}`);
console.log(`check-mutator-parity: ${mutators.length} project mutator(s), `
  + `${Object.keys(REACHED_VIA).length} reached through a named sibling, ${owed.length} owed —`
  + ' no NEW setting automation can reach and a person cannot.');
