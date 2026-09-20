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

console.log(`check-packaging-settings: ${declared.length} packaging setting(s), each one read back.`);
