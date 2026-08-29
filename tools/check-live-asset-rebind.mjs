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
 * So the rules guarded here are that there is no list, and that a caller who
 * holds receipts does not fall back to naming paths:
 *
 *   1. No file on the rebind path names an asset-bearing component type.
 *   2. The walk goes through the registry and reads `assetFields`.
 *   3. The rebind path acquires by receipt. A `load*` hands back no receipt, so
 *      what it takes out of the ledger is a row nobody can give back — that is
 *      the leak the rebinder had, one row per successful hot update.
 *   4. The runtime scene loader hands the scene its receipts, not its paths.
 *   5. A loader holding a texture past its own load() acquires it, for the same
 *      reason: it releases at unload, by which time the path may name two eras.
 *   6. Who owns what an entity holds is answered in ONE place. A second copy of
 *      that rule is how a promoted entity's replacement went to the app scope,
 *      which ends only when the app does.
 *   7. A loader has exactly ONE door: `load`/`unload` for an asset a component
 *      holds by handle, `registry` for one it holds by ref. Two doors to the
 *      same asset is two answers about who owns it — and the registry door
 *      exists because publication has to be the slot's, not an era's.
 *
 * Run: node tools/check-live-asset-rebind.mjs   (exit 1 on violation)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files that answer "which live fields hold this asset?". */
const REBIND_PATH = [
  'sdk/src/asset/liveAssetBindings.ts',
  'sdk/src/asset/liveAssetRebind.ts',
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

// A replacement is acquired, never merely loaded: `load*` hands back no receipt.
for (const file of REBIND_PATH) {
  const code = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
  const call = /\bload(?:Texture|Material|Font|Audio|Typed|Prefab|Mesh)\s*\(/.exec(code);
  if (call) {
    findings.push(`${file}:${code.slice(0, call.index).split('\n').length}  takes an asset out with a load*, which hands back no receipt — acquire it.`);
  }
}

// A caller holding receipts must not hand over paths: a path-addressed release
// after a hot update gives back the oldest era, and what the paths omit is
// never given back at all.
const LOADER = 'sdk/src/runtime/runtimeLoader.ts';
const loader = stripComments(readFileSync(path.join(ROOT, LOADER), 'utf8'));
if (!/\bpreloadSceneAssets\(/.test(loader)) {
  findings.push(`${LOADER}  no longer preloads scene assets — this guard is reading the wrong file.`);
} else {
  const call = /\btrackAssets\(/.exec(loader);
  if (call) {
    findings.push(`${LOADER}:${loader.slice(0, call.index).split('\n').length}  hands the scene PATHS while holding the preload's receipts — use trackAssetScope.`);
  }
}

// The same rule one layer down: a loader that keeps a texture releases it at
// unload, which is exactly when a path has stopped naming one instance.
const LOADERS = path.join(ROOT, 'sdk/src/asset/loaders');
for (const name of readdirSync(LOADERS).filter((f) => f.endsWith('.ts'))) {
  const code = stripComments(readFileSync(path.join(LOADERS, name), 'utf8'));
  const call = /\bctx\.releaseTexture\s*\(/.exec(code);
  if (call) {
    findings.push(`sdk/src/asset/loaders/${name}:${code.slice(0, call.index).split('\n').length}  gives a held texture back by PATH — keep the receipt acquireTexture hands you.`);
  }
}

// Owner resolution has one source of truth: assetScopeForEntity. A rebinder
// working it out from the scene tag cannot know about an entity that owns its
// assets itself.
const OWNER_RULE = /\bSceneOwner\b|\bappScope\b|\bassetScopeFor\s*\(/;
for (const file of REBIND_PATH) {
  const code = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
  const hit = OWNER_RULE.exec(code);
  if (!hit) continue;
  findings.push(`${file}:${code.slice(0, hit.index).split('\n').length}  works out who owns an entity's assets for itself — call assetScopeForEntity.`);
}

// One door per loader. A registry-backed loader that also published from a
// `load` would be an era writing the registry, which is how a retiring one
// deletes the entry its successor just put under the same name.
const LOADERS_DIR = path.join(ROOT, 'sdk/src/asset/loaders');
let loaders = 0;
for (const name of readdirSync(LOADERS_DIR).filter((f) => f.endsWith('.ts'))) {
  const code = stripComments(readFileSync(path.join(LOADERS_DIR, name), 'utf8'));
  if (!/implements AssetLoader</.test(code)) continue;
  loaders++;
  const registry = /\breadonly registry\b/.test(code);
  const direct = /^\s{4}(?:async )?load\s*\(/m.test(code);
  if (registry === direct) {
    findings.push(`sdk/src/asset/loaders/${name}  has ${registry ? 'BOTH doors' : 'neither door'} — a loader answers with load/unload or with registry, never both.`);
  }
}
if (loaders < 10) {
  console.error(`check-live-asset-rebind: found only ${loaders} loader(s) — the parser no longer matches how they are declared.`);
  process.exit(1);
}

if (findings.length === 0) {
  console.log(`check-live-asset-rebind: the rebind path reads the declaration for all ${components.size} asset-bearing components, acquires by receipt, asks one place who owns what, and each of the ${loaders} loaders has one door.`);
  process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nLive assets are addressed by what DECLARES them: the asset field for a binding, the receipt for an acquisition.');
process.exit(1);
