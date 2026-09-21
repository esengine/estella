#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every packaging setting a project can declare survives being read.
 *
 * `parseManifest` is the one authority on what a project means — the CLI's own
 * comment says a setting read straight off the JSON would be a second answer.
 * It reads the block field by field, and seven of the eighteen `ProjectPackaging`
 * declares were never in that list: `compressWasm` and `engineSubpackage` among
 * them, so the settings that move the engine binary off a mini-game's 4MB main
 * package had no effect anywhere, in the editor or on a build server.
 *
 * `assetCompression` was one of them too, which is the reason this is a gate and
 * not a fix: the previous round of this same bug was closed by deriving cook
 * options from that field, and the field the derivation reads was never
 * populated. A hand-written reader needs something that counts its fields.
 *
 *   node tools/check-packaging-settings.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = 'pipeline/src/project/format.ts';

const src = readFileSync(path.join(ROOT, FORMAT), 'utf8');

const shape = /interface ProjectPackaging\s*\{([\s\S]*?)\n\}/.exec(src);
if (!shape) {
  console.error(`check-packaging-settings: no ProjectPackaging in ${FORMAT} — the shape moved.`);
  process.exit(1);
}
const declared = [...shape[1].matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*)\??[:?]/gm)].map(([, f]) => f);

const reader = /if \(o\.packaging && typeof o\.packaging === 'object'\) \{([\s\S]*?)\n {2}\}/.exec(src);
if (!reader) {
  console.error(`check-packaging-settings: no packaging block in parseManifest — the reader moved.`);
  process.exit(1);
}

/** Read as `p.<field>`, or assigned as `pkg.<field>` by a migration. */
const reads = (field) =>
  new RegExp(`\\bp\\.${field}\\b`).test(reader[1]) || new RegExp(`\\bpkg\\.${field}\\b`).test(reader[1]);

const dropped = declared.filter((f) => !reads(f));
if (declared.length === 0) {
  console.error('check-packaging-settings: ProjectPackaging declares nothing — the shape cannot be read.');
  process.exit(1);
}

if (dropped.length > 0) {
  for (const f of dropped) {
    console.error(`  ${FORMAT}: packaging.${f} is declared and parseManifest never reads it — `
      + 'a project setting it gets the default everywhere, silently');
  }
  console.error(`check-packaging-settings: ${dropped.length} setting(s) declared but dropped on load.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// …and the other end: a setting that survives the load can still be missing
// from the MEASUREMENT record, where the symptom is a build-over-build
// comparison that blames content for a packing change. Three did.
// ---------------------------------------------------------------------------

const HISTORY = 'pipeline/src/export/sizeHistory.ts';
const history = readFileSync(path.join(ROOT, HISTORY), 'utf8');

const roleBlock = /PACKAGING_SIZE_ROLE[^=]*=\s*\{([\s\S]*?)\n\};/.exec(history);
if (!roleBlock) {
  console.error(`check-packaging-settings: no PACKAGING_SIZE_ROLE in ${HISTORY} — the table moved.`);
  process.exit(1);
}
const roles = new Map(
  [...roleBlock[1].matchAll(/^\s{4}([a-zA-Z][A-Za-z0-9]*):\s*'([^']+)'/gm)].map(([, f, r]) => [f, r]),
);

const settingsBlock = /interface SizeSettings\s*\{([\s\S]*?)\n\}/.exec(history);
if (!settingsBlock) {
  console.error(`check-packaging-settings: no SizeSettings in ${HISTORY} — the record moved.`);
  process.exit(1);
}
const recorded = new Set(
  [...settingsBlock[1].matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*)\??:/gm)].map(([, f]) => f),
);

const problems = [];
for (const f of declared) {
  const role = roles.get(f);
  if (!role) {
    problems.push(`  ${HISTORY}: packaging.${f} has no role — say which SizeSettings key records it, `
      + "or 'content' (it ships different files) or 'inert' (it cannot move a byte)");
    continue;
  }
  if (role !== 'content' && role !== 'inert' && !recorded.has(role)) {
    problems.push(`  ${HISTORY}: packaging.${f} says it is recorded as "${role}", `
      + 'which SizeSettings does not declare');
  }
}
for (const f of roles.keys()) {
  if (!declared.includes(f)) {
    problems.push(`  ${HISTORY}: PACKAGING_SIZE_ROLE names "${f}", which ProjectPackaging no longer declares`);
  }
}

if (problems.length > 0) {
  for (const line of problems) console.error(line);
  console.error(`check-packaging-settings: ${problems.length} setting(s) whose effect on a measurement `
    + 'is undeclared — a comparison against the last build would blame the wrong thing.');
  process.exit(1);
}

const levers = [...roles.values()].filter((r) => r !== 'content' && r !== 'inert').length;
console.log(`check-packaging-settings: ${declared.length} packaging setting(s), each one read back `
  + `and each one's effect on a measurement declared (${levers} recorded with it).`);
