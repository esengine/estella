#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-live-asset-rebind.mjs — hot update reads the declaration, not a list.
 *
 * `component.assetFields` is what says a field carries an asset: discovery,
 * cook inclusion and `@uuid` resolution all read it. The rebinder did not — it
 * named Sprite and MeshRenderer — so five of the seven built-in texture fields
 * were never swapped on a hot update, and no project or plugin component was
 * either. Nothing failed; the game just kept drawing the old image.
 *
 * A list like that cannot be kept correct, because the thing it must agree with
 * is authored somewhere else (a C++ ES_PROPERTY, a project's defineComponent).
 * So the rule guarded here is that there is no list:
 *
 *   1. No file on the rebind path names an asset-bearing component type.
 *   2. The walk goes through the registry and reads `assetFields`.
 *
 * Run: node tools/check-live-asset-rebind.mjs   (exit 1 on violation)
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files that answer "which live fields hold this asset?". */
const REBIND_PATH = [
  'sdk/src/asset/liveAssetBindings.ts',
  'sdk/src/hotUpdateRebind.ts',
];

const GENERATED = 'sdk/src/ecs/component.generated.ts';

const missing = [...REBIND_PATH, GENERATED].filter((f) => !existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error(`check-live-asset-rebind is stale: ${missing.join(', ')} does not exist.`);
  process.exit(1);
}

/** Comments out, line numbers intact — a finding names a line someone reads. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

/**
 * Components that declare an asset field, from the two places they are authored:
 * the generated C++ metadata, and `defineComponent` in the SDK. These are the
 * names a rebinder is tempted to write down.
 */
function assetBearingComponents() {
  const names = new Set();
  const generated = readFileSync(path.join(ROOT, GENERATED), 'utf8');
  const entry = /^ {4}([A-Za-z0-9_]+): \{$/gm;
  let m;
  const marks = [];
  while ((m = entry.exec(generated))) marks.push({ name: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const body = generated.slice(marks[i].at, marks[i + 1]?.at ?? generated.length);
    if (/assetFields: \[\s*\{/.test(body)) names.add(marks[i].name);
  }
  // SDK-side components declare theirs at the defineComponent call.
  const src = readFileSync(path.join(ROOT, 'sdk/src/ecs/component.ts'), 'utf8');
  const call = /defineComponent<[^>]*>\(\s*'([A-Za-z0-9_]+)'([\s\S]{0,2000}?)\n\}\);/g;
  while ((m = call.exec(src))) {
    if (m[2].includes('assetFields')) names.add(m[1]);
  }
  return names;
}

const components = assetBearingComponents();
// An empty set would pass every check below without reading a thing.
if (components.size < 6) {
  console.error(`check-live-asset-rebind: found only ${components.size} asset-bearing component(s) — the parser no longer matches how they are declared.`);
  process.exit(1);
}

const findings = [];
for (const file of REBIND_PATH) {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const code = stripComments(text);
  for (const name of components) {
    const hit = new RegExp(`\\b${name}\\b`).exec(code);
    if (!hit) continue;
    const line = code.slice(0, hit.index).split('\n').length;
    findings.push(`${file}:${line}  names the component type "${name}".`);
  }
}

/** One exported function's body, braces balanced. */
function functionBody(text, name) {
  const m = new RegExp(`export function ${name}\\b`).exec(text);
  if (!m) return null;
  let i = text.indexOf('{', m.index);
  if (i < 0) return null;
  const start = i;
  for (let depth = 0; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) break;
  }
  return text.slice(start + 1, i);
}

// Per function, not per file: the file kept the word `assetFields` in a
// neighbouring helper while the walk itself had been replaced by a literal.
const discovery = stripComments(readFileSync(path.join(ROOT, REBIND_PATH[0]), 'utf8'));
for (const fn of ['findLiveAssetBindings', 'componentsBindingAssetType']) {
  const body = functionBody(discovery, fn);
  if (body === null) {
    findings.push(`${REBIND_PATH[0]}  ${fn}() is gone — the rebind path's only door to the declaration.`);
    continue;
  }
  if (!/getComponentRegistry\(/.test(body) || !/\.assetFields\b/.test(body)) {
    findings.push(`${REBIND_PATH[0]}  ${fn}() no longer walks getComponentRegistry() reading assetFields — the declaration is the only thing that knows which fields carry an asset.`);
  }
}

if (findings.length === 0) {
  console.log(`check-live-asset-rebind: the rebind path names none of the ${components.size} asset-bearing components, and reads the declaration.`);
  process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nRebinding is per DECLARED asset field. Widen the walk instead of adding a case.');
process.exit(1);
