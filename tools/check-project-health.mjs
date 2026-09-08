// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-project-health.mjs — whether a project can ship has one author.
 *
 * Two implementations of "can this ship" agree until one is edited, and the one
 * anybody believes is whichever spoke last. So the checks live in one list,
 * every consumer reads the report, and the ways they could differ are refused.
 *
 *   node tools/check-project-health.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const has = (rel) => existsSync(path.join(ROOT, rel));

const CHECKS = 'desktop/src/project/projectHealth.ts';
const READER = 'desktop/src/project/projectHealthReader.ts';
/** Everyone who states a verdict about whether this project can ship. */
const CONSUMERS = {
  'desktop/src/components/BuildDialog.tsx': 'the build refuses to start past a blocker',
  'desktop/src/panels/HealthPanel.tsx': 'the panel shows the same verdict',
  'desktop/shared/toolCatalog.mjs': 'the agent asks the same question',
};

const problems = [];
const say = (file, what) => problems.push(`${file}: ${what}`);

// Every check below reads the editor, so without it this judges nothing — and 2
// is what makes the runner count a hole rather than a pass.
if (!has(CHECKS)) {
  console.log('check-project-health: no editor checkout — nothing was judged.');
  process.exit(2);
}

const checks = read(CHECKS);

// 1. The checks are a declared LIST. A body of ifs cannot be counted, and
//    "23 checks passed" is a claim about how many ran.
const list = /export const HEALTH_CHECKS: HealthCheck\[\] = \[([\s\S]*?)\n\];/.exec(checks);
if (!list) say(CHECKS, 'HEALTH_CHECKS is not a declared list any more — the tally means nothing');
const ids = [...(list?.[1] ?? '').matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]);
if (ids.length === 0) say(CHECKS, 'no checks are declared');
if (new Set(ids).size !== ids.length) say(CHECKS, 'two checks share an id — a consumer keying off one is ambiguous');

// 2. Every check declares a scope, and the ones about THIS MACHINE say so in
//    their own words. A current-device finding read as a target's is a verdict
//    about a build nobody has run.
for (const block of (list?.[1] ?? '').split(/\n  \},?/)) {
  const id = /id: '([^']+)'/.exec(block)?.[1];
  if (!id) continue;
  const scope = /scope: '([^']+)'/.exec(block)?.[1];
  if (!scope) { say(CHECKS, `check "${id}" declares no scope`); continue; }
  if (scope !== 'current-device') continue;
  if (!/this machine|this backend|this viewport/.test(block)) {
    say(CHECKS, `check "${id}" is about this machine and never says so — it reads as a target's verdict`);
  }
  // …and never speaks of the target. "MSAA is unavailable for this target" is
  // the sentence a device measurement must not produce, and saying "this
  // machine" elsewhere in the wording does not undo it.
  if (/\btargets?\b/.test(block.replace(/scope: '[^']*'/g, ''))) {
    say(CHECKS, `check "${id}" measures this machine and speaks about a build target`);
  }
}

// 3. The checks are PURE: they read facts handed to them. One that went and
//    measured a capability would be previewing itself, not the build.
for (const forbidden of ['EngineHost', 'window.estella', 'PlayRealm', 'ProjectStore']) {
  if (checks.includes(forbidden)) {
    say(CHECKS, `the checks reach for "${forbidden}" — they read facts, they do not gather them`);
  }
}

// 4. Nobody states a verdict without the report. This is the whole point: a
//    consumer with its own half of the answer is a second author of it.
for (const [file, why] of Object.entries(CONSUMERS)) {
  if (!has(file)) { say(file, `missing — ${why}`); continue; }
  const text = read(file);
  if (!/projectHealth|project_health/.test(text)) {
    say(file, `does not go through the report — ${why}`);
  }
  // …and does not re-derive one. Naming a check id outside the list is a
  // consumer that decided what that check means for itself.
  for (const id of ids) {
    if (new RegExp(`['"\`]${id.replace('.', '\\.')}['"\`]`).test(text)) {
      say(file, `names the check "${id}" itself — read the finding, do not re-decide it`);
    }
  }
}

// 5. A blocker STOPS the build, at EVERY door that can produce a package.
//    Packaging anyway is this stage's failure; so is a second door that never asks.
const STORE = 'desktop/src/project/ProjectStore.ts';
const DIALOG = 'desktop/src/components/BuildDialog.tsx';
const CATALOG = 'desktop/shared/toolCatalog.mjs';
const store = has(STORE) ? read(STORE) : '';

// 5a. The rule has ONE author, and it decides rather than reports.
const adjudicator = /async preflightBuild\([\s\S]{0,600}?\n  \}/.exec(store);
if (!adjudicator) say(STORE, 'no preflightBuild — the one place a build is adjudicated is gone');
else if (!/blockers\([^)]*\)\.length === 0/.test(adjudicator[0])) {
  say(STORE, 'preflightBuild no longer decides on blockers — it is an observation again');
}

// 5b. The store's export door REFUSES, before it calls the exporter. Order is
//     the claim: adjudicating after the cook leaves half a package behind.
const door = /async exportGame\([\s\S]*?\n  \}/.exec(store);
if (!door) say(STORE, 'no exportGame to check — the build door cannot be located');
else {
  const at = door[0].indexOf('preflightBuild');
  const exporter = door[0].indexOf('window.estella.project.exportGame');
  if (at < 0) say(STORE, 'exportGame does not preflight — the agent\'s build skips what the dialog refuses on');
  else if (exporter >= 0 && at > exporter) {
    say(STORE, 'exportGame preflights AFTER calling the exporter — a refusal that already wrote is not a refusal');
  }
  if (!/reason: 'preflight-blocked'/.test(door[0])) {
    say(STORE, 'a refused build is not distinguishable from a failed one — it owes reason: preflight-blocked');
  }
  // What a project's assets cook as is the PROJECT's, so the shared door has to
  // derive it. Left to each caller, an agent's build shipped a raw PNG and no
  // basis transcoder where the dialog's shipped a KTX2 and one — same project.
  if (!/cookOptionsOf\(/.test(door[0])) {
    say(STORE, 'exportGame does not derive the cook options from the project — a caller that'
      + ' says nothing gets `undefined`, which is not what the project asked for');
  }
}

// 5c. No door reaches around the store to the bridge: a tool naming the exporter
//     directly is a build nothing adjudicated. Having a get_project_health TOOL
//     is not enforcement — this is the check that tells them apart.
if (has(CATALOG)) {
  const catalog = read(CATALOG);
  // To the next entry or the end of the list: entries do not close on a line of
  // their own, so an indentation anchor finds nothing and reads as "no tool".
  const tool = /\{ name: 'export_game'[\s\S]*?(?=\n  \{ name: '|\n\];)/.exec(catalog);
  if (!tool) say(CATALOG, 'no export_game tool to check');
  else if (/window\.estella\.project\.exportGame/.test(tool[0])) {
    say(CATALOG, 'export_game calls the bridge exporter directly — it must go through the adjudicated door');
  }
}

// 5d. The dialog asks the same adjudicator rather than keeping its own copy.
const dialog = has(DIALOG) ? read(DIALOG) : '';
const build = /const build = async \(\) => \{([\s\S]*?)\n  \};/.exec(dialog);
if (!build) say(DIALOG, 'no build() to check — the gate cannot be located');
else if (!/preflightBuild\([\s\S]{0,300}?return;/.test(build[1])) {
  say(DIALOG, 'build() does not return on a refused preflight — a refusal that packages anyway is not a refusal');
} else if (/blockers\([^)]*\)\.length/.test(build[1])) {
  say(DIALOG, 'build() decides on blockers itself — two doors with their own copy of the rule is how they came to disagree');
}

// That the report is not CACHED is not checked here: every static shape of it
// was position-sensitive, and a rule sabotage cannot redden is worse than none.
// The editor check breaks a project, repairs it, and asks again.

// 6. The reader reports what it could not obtain. A check that did not run and
//    a check that passed are opposite answers about the same project.
if (has(READER) && !/unavailable/.test(read(READER))) {
  say(READER, 'nothing is ever reported unavailable — an unobtainable fact is passing silently');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`check-project-health: ${problems.length} finding(s).`);
  process.exit(1);
}
console.log(
  `check-project-health: ${ids.length} declared check(s), one report, `
  + `${Object.keys(CONSUMERS).length} consumers — none of them decides for itself.`);
