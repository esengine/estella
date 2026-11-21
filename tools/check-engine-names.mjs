#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-engine-names.mjs — the source names no other engine: a comment, a string and a path say what Estella does.
 *
 * Scans every source file of the engine and the editor (code, comments, the strings the editor shows, a check's description) and
 * every path, tracked or new, for another engine's name. Allowed: Cocos, which names a feature (the importer of a Cocos project and
 * the runtime its scripts run on); Unity Ads, an ad network a playable is exported to; Amazon Lumberyard Bistro, an asset whose
 * licence asks for its name; the Godot bridge, a script run inside Godot to export a scene. Not scanned: third-party sources,
 * generated files, the release history (the changelog and its twin in tools/releaseNotes.mjs) and the documentation.
 *
 *   node tools/check-engine-names.mjs          every file, exit 1 on any finding
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { corpusRoots, censusFindings, sourceFiles } from './lib/sourceCensus.mjs';
import { ROOT } from './lib/repo.mjs';

const SOURCE = /\.(ts|tsx|mts|cts|mjs|cjs|js|jsx|cpp|cc|c|hpp|h|css|glsl|wgsl|esshader|html|py|sh|ps1|bat|cmake)$|(^|\/)CMakeLists\.txt$/;
const SKIP = /(^|\/)(node_modules|dist|build|third_party|\.git)\/|\.generated\.|generated\/|\.min\./;
const SELF = 'tools/check-engine-names.mjs';
/** Release history as published, kept as it was written: the changelog's twin. */
const HISTORY = new Set(['tools/releaseNotes.mjs']);

const NAMES = [
  ['Unreal', /\bunreal\b/i],
  ['UE', /\bUE(?:[45]|'s)?\b/],
  ['Unity', /\bunity\b/i],
  ['Godot', /\bgodot\b/i],
  ['CryEngine', /\bcry\s?engine\b/i],
  ['GameMaker', /\bgame\s?maker\b/i],
  ['Cinemachine', /\bcinemachine\b/i],
  ['Frostbite', /\bfrostbite\b/i],
  ['Lumberyard', /\blumberyard\b/i],
  ['Laya', /\blaya(?:air)?\b/i],
  ['Egret', /\begret\b/i],
  ['Phaser', /\bPhaser\b/],
  ['Defold', /\bdefold\b/i],
  ['O3DE', /\bo3de\b/i],
  ['Bevy', /\bbevy\b/i],
  ['Roblox', /\broblox\b/i],
  ['PlayCanvas', /\bplaycanvas\b/i],
  ['Babylon', /\bbabylon(?:\.?js)?\b/i],
];
/** Spans a name may stand in, removed before the names are looked for. */
const ALLOWED = [
  /\bunity\s+ads\b/gi,
  /\b[\w.-]*unity\.com\b[^\s)'"`]*/gi,
  /\bamazon[\s-]+lumberyard(?:[\s-]+bistro)?\b/gi,
  // A value another system defines, quoted whole: an ad network's id, a rigging service's skeleton spec.
  /(['"])(?:unity|unreal)\1/g,
];
/** Release notes as published (CHANGELOG.md): a string quoting one word for word is that history, not new prose. */
const PUBLISHED = (() => {
  try { return readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'); } catch { return ''; }
})();
const quotesHistory = (line) => line.replace(/(["'`])((?:(?!\1).){12,})\1/g, (all, _q, body) => (PUBLISHED.includes(body) ? '' : all));
/** A bridge a source project runs inside that engine, to export its scenes for the glTF import: named for what it runs in. */
const ALLOWED_PATHS = /^pipeline\/bridges\/godot\//;

const findings = [];
const roots = corpusRoots();
const census = censusFindings(roots);
for (const root of roots) {
  for (const file of sourceFiles(root)) {
    if (file === SELF || HISTORY.has(file) || SKIP.test(file) || ALLOWED_PATHS.test(file)) continue;
    for (const [name, re] of NAMES) {
      if (re.test(file.replace(/[-_./]/g, ' '))) findings.push(`${file}  the path names ${name}`);
    }
    if (!SOURCE.test(file)) continue;
    let text;
    try { text = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    text.split('\n').forEach((raw, i) => {
      let line = quotesHistory(raw);
      for (const allow of ALLOWED) line = line.replace(allow, '');
      for (const [name, re] of NAMES) {
        if (re.test(line)) findings.push(`${file}:${i + 1}  ${name}: ${raw.trim().slice(0, 140)}`);
      }
    });
  }
}

for (const f of census) console.error(`check-engine-names: ${f}`);
if (findings.length > 0) {
  for (const f of findings) console.error(`  ${f}`);
  console.error(`check-engine-names: ${findings.length} place(s) name another engine. Say what Estella does instead — the behaviour, the`
    + ' formula, the convention — without naming whose it is.');
  process.exit(1);
}
if (census.length > 0) process.exit(1);
console.log('check-engine-names: no source names another engine');
