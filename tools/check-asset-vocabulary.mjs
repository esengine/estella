// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-asset-vocabulary.mjs — the cook names types an importer writes.
 *
 * The cook decides what to scan for dependencies by reading a `.meta`'s `type`,
 * and the editor decides what a `.meta` says by looking the file's extension up
 * in its own table. Two lists, one vocabulary — and a value in the cook's that
 * the editor never writes is a rule that cannot fire.
 *
 * That is not hypothetical: the bitmap-font scan compared against `bitmapFont`,
 * the editor had no `.fnt` type at all, and the pipeline test wrote `bitmapFont`
 * into its own fixture — so the rule, the test and nothing else agreed about a
 * value no real asset could carry, and a build shipped a font whose page had
 * been culled. The test could not catch it: it supplied both halves.
 *
 * Run: node tools/check-asset-vocabulary.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COOK = path.join(ROOT, 'pipeline', 'src', 'assets', 'assetDb.ts');
const EDITOR_TYPES = path.join(ROOT, 'desktop', 'src', 'types.ts');

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

if (!existsSync(EDITOR_TYPES)) {
  console.log(`check-asset-vocabulary: no editor checkout — ${found.length} cook-side type(s) went unchecked.`);
  process.exit(0);
}
const editor = readFileSync(EDITOR_TYPES, 'utf8');
const union = editor.match(/export type BuiltinAssetType =([\s\S]*?);/);
if (!union) {
  console.error('check-asset-vocabulary: BuiltinAssetType is not where this reads it from.');
  process.exit(1);
}
const written = new Set([...union[1].matchAll(/'([a-zA-Z-]+)'/g)].map((m) => m[1]));

const problems = [];
for (const type of found) {
  if (written.has(type)) continue;
  const why = NOT_META_TYPES[type];
  if (why) continue;
  problems.push(`the cook reads "${type}", which the editor never writes into a .meta`
    + ' — no import produces it, so the rule it gates cannot fire'
    + ' (add it to BuiltinAssetType + ASSET_TYPES, or say why it is not a meta type here)');
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
