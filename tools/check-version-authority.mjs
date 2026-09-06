// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-version-authority.mjs — the editor offers the versions the engine
 *        actually ships, because it reads the same list.
 *
 * Which Spine runtime a project bundles decides what a .skel can be and what the
 * package weighs. The set of them is SPINE_VERSIONS, which the plugin loads
 * modules from and the cook packs by — and the editor had two hand-written
 * copies of it, one validating writes and one that would have filled a dropdown.
 *
 * A copy does not fail on the day it is made. It fails the week a release is
 * vendored: the runtime gains 4.3, an agent can set it because the manifest is
 * just a string, and the person opening Project Settings is offered 4.2 as the
 * newest thing that exists. Nothing anywhere reports that.
 *
 * So the rule is not "the lists agree" — two lists that agree today is exactly
 * the state this describes. It is that there is ONE list, and the editor names
 * no version of its own.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'sdk/src/sideModules/registry.ts';
const EDITOR = path.join(ROOT, 'desktop', 'src');

const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

if (!existsSync(EDITOR)) {
  console.log('check-version-authority: no editor checkout — nothing was judged.');
  process.exit(0);
}

// The authority, read rather than restated here too: this gate naming its own
// versions would be the third copy.
const declared = /export const SPINE_VERSIONS[^=]*=\s*\[([^\]]*)\]/.exec(read(REGISTRY));
if (!declared) {
  console.error(`check-version-authority: SPINE_VERSIONS is not declared in ${REGISTRY} — has it moved?`);
  process.exit(1);
}
const versions = [...declared[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
if (versions.length === 0) {
  console.error('check-version-authority: SPINE_VERSIONS parsed as empty, which cannot be right');
  process.exit(1);
}

function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const problems = [];
let scanned = 0;
// Two or more of them quoted in one file is a list, whatever it is called. One
// on its own is a version somebody mentioned — a comment, a migration, a test.
for (const file of sources(EDITOR)) {
  scanned++;
  const src = readFileSync(file, 'utf8');
  const named = versions.filter((v) => src.includes(`'${v}'`));
  if (named.length < 2) continue;
  problems.push(`${path.relative(ROOT, file)} names ${named.length} spine versions of its own`
    + ` (${named.join(', ')}) — read SPINE_VERSIONS instead, or the editor keeps offering the set`
    + ' it was written with');
}

// Word-bounded: a bare `includes` is satisfied by `SPINE_VERSIONS_X`, which is
// how two earlier gates in this campaign passed their own sabotage.
if (!/\bSPINE_VERSIONS\b/.test(read('desktop/src/project/ProjectStore.ts'))) {
  problems.push('desktop/src/project/ProjectStore.ts no longer reads SPINE_VERSIONS — whatever it'
    + ' validates a write against is its own opinion of what the engine ships');
}

if (problems.length) {
  console.error(`check-version-authority: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-version-authority: ${versions.length} spine version(s) declared once;`
  + ` ${scanned} editor file(s) name none of their own.`);
