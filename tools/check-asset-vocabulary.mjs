// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/repo.mjs';
import { EXT_TO_TYPE, SUFFIX_TO_TYPE, metaTypeForContent } from './assetMetaTable.js';

const COOK = path.join(ROOT, 'pipeline', 'src', 'assets', 'assetDb.ts');

/**
 * Cook-side values that are NOT `.meta` types, and what they are instead. An
 * entry is a claim that the value is checked against something else entirely.
 */
const NOT_META_TYPES = {
  'spine-atlas': "the SDK's editorType vocabulary, minted from the file's content",
  'dragonbones-atlas': 'as spine-atlas',
};

const cook = readFileSync(COOK, 'utf8');

/** Every string the cook compares a `.meta` type against. */
function cookTypes() {
  const out = new Set();
  const jsonRefs = cook.match(/const JSON_REF_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  const skeletal = cook.match(/const SKELETAL_ATLAS_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  for (const block of [jsonRefs?.[1], skeletal?.[1]]) {
    for (const m of (block ?? '').matchAll(/'([a-zA-Z-]+)'/g)) out.add(m[1]);
  }
  // Single-value constants compared to `entry.type`, named for what they hold.
  for (const m of cook.matchAll(/^const ([A-Z_]+) = '([a-zA-Z-]+)';$/gm)) {
    if (cook.includes(`entry.type === ${m[1]}`) || cook.includes(`e.type === ${m[1]}`)) out.add(m[2]);
  }
  return [...out].sort();
}

const found = cookTypes();
if (found.length === 0) {
  console.error('check-asset-vocabulary: read no type names out of the cook — the shapes it reads have moved.');
  process.exit(1);
}

const written = new Set([
  ...Object.values(EXT_TO_TYPE),
  ...Object.values(SUFFIX_TO_TYPE),
  metaTypeForContent('data.json', ''),
  metaTypeForContent('hero.json', '{"skeleton":{"spine":"4.2"}}'),
]);

const problems = [];
for (const type of found) {
  if (written.has(type)) continue;
  const why = NOT_META_TYPES[type];
  if (why) continue;
  problems.push(`the cook reads "${type}", which tools/assetMetaTable.js never mints into a .meta`
    + ' — no import produces it, so the rule it gates cannot fire'
    + ' (add it to the table, or say why it is not a meta type here)');
}
for (const type of Object.keys(NOT_META_TYPES)) {
  if (!found.includes(type)) {
    problems.push(`NOT_META_TYPES names "${type}", which the cook no longer reads`);
  }
}

if (problems.length) {
  console.error(`check-asset-vocabulary: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`check-asset-vocabulary: ${found.length} type(s) the cook reads, every one an importer writes`
  + ` (${Object.keys(NOT_META_TYPES).length} judged by another vocabulary).`);
