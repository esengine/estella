#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-tilemap-realm.mjs — tilemap answers for one app, and owns what it took.
 *
 * The tilemap subsystem was the last place four retired shapes still lived: a
 * module-global asset cache, a loader taking textures with no receipt, a
 * module-level "active runtime" pointer, and a shared plugin object holding
 * World-local state. Each of them is cheaper to write back than to do right, so
 * each is refused by name:
 *
 *   1. No module-level cache of a loaded map or resolved tileset. The realm's
 *      slot table is where the current era of a ref-bound asset lives.
 *   2. The tilemap/tileset loaders acquire (a receipt) or compose (an owned
 *      texture) — never `loadTexture`, which hands back nothing to release and
 *      records no dependency.
 *   3. No module-level mutable "active" binding in the tilemap sources: an
 *      editor world and a play world are two apps, and a pointer answers one.
 *   4. `TilemapPlugin` holds no state. What it installs is per app.
 *
 * Run: node tools/check-tilemap-realm.mjs   (exit 1 on violation)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'sdk/src/tilemap');
const LOADERS = [
  'sdk/src/asset/loaders/TilemapAssetLoader.ts',
  'sdk/src/asset/loaders/TilesetAssetLoader.ts',
];

const missing = [...LOADERS, 'sdk/src/tilemap/tilemapPlugin.ts'].filter(
  (f) => !existsSync(path.join(ROOT, f)));
if (missing.length) {
  console.error(`check-tilemap-realm is stale: ${missing.join(', ')} does not exist.`);
  process.exit(1);
}

/** Comments out, line numbers intact. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');

const findings = [];
const at = (code, index) => code.slice(0, index).split('\n').length;

// --- 1 + 3. no module-level asset cache, no module-level "active" binding ---
const RETIRED = [
  [/^const \w*(?:[Cc]ache|Store)\w* = new Map</m, 'a module-level asset cache — the realm\'s slot table holds the current era'],
  [/^let (?:apply|active)\w*\s*[:=]/m, 'a module-level "active runtime" pointer — an editor world and a play world are two apps'],
];
let scanned = 0;
for (const name of readdirSync(DIR).filter((f) => f.endsWith('.ts'))) {
  const code = stripComments(readFileSync(path.join(DIR, name), 'utf8'));
  scanned++;
  for (const [pattern, why] of RETIRED) {
    const hit = pattern.exec(code);
    if (hit) findings.push(`sdk/src/tilemap/${name}:${at(code, hit.index)}  ${why}.`);
  }
}
if (scanned < 8) {
  console.error(`check-tilemap-realm: read only ${scanned} tilemap source(s) — the guard is looking in the wrong place.`);
  process.exit(1);
}

// --- 2. the loaders take a receipt, or compose something they own -----------
for (const file of LOADERS) {
  const code = stripComments(readFileSync(path.join(ROOT, file), 'utf8'));
  const loose = /\bctx\.(?:loadTexture|createTextureFromPixels)\s*\(/.exec(code);
  if (loose) {
    findings.push(`${file}:${at(code, loose.index)}  takes a texture with no owner (${loose[0].trim()}) — acquireTexture for one that has a path, createOwnedTexture for one this composes.`);
  }
  if (!/\bctx\.(?:acquireTexture|createOwnedTexture)\s*\(/.test(code)) {
    findings.push(`${file}  takes no texture through a recorded door — whatever it resolves is pinned for the life of the app, and its era owns nothing.`);
  }
}

// --- 4. the plugin is an installer, not a holder ----------------------------
const plugin = stripComments(readFileSync(path.join(ROOT, 'sdk/src/tilemap/tilemapPlugin.ts'), 'utf8'));
const cls = /export class TilemapPlugin implements Plugin \{([\s\S]*?)\n\}/.exec(plugin);
if (!cls) {
  console.error('check-tilemap-realm: cannot read TilemapPlugin — this guard parses its body.');
  process.exit(1);
}
const field = /^\s{4}(?:private |readonly |private readonly )*(\w+)\s*[:=]/m.exec(cls[1].replace(/^\s*name = 'tilemap';$/m, ''));
if (field && field[1] !== 'name') {
  findings.push(`sdk/src/tilemap/tilemapPlugin.ts  TilemapPlugin holds \`${field[1]}\` — one plugin object installs into many apps, and every collection here is World-local.`);
}

if (findings.length === 0) {
  console.log(`check-tilemap-realm: ${scanned} tilemap source(s) hold no module-level asset state, both loaders own what they take, and the plugin holds nothing.`);
  process.exit(0);
}
for (const f of findings) console.error(f);
console.error('\nA tilemap belongs to the app that loaded it, and an era owns what it resolved.');
process.exit(1);
