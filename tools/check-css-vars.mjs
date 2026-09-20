#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every `var(--x)` names an `--x` that something defines.
 *
 * CSS has no unknown-variable error. A misspelled name resolves to nothing, the
 * property is simply not set, and the pixel that was meant to be filled is not —
 * so a checked toggle loses its fill and a dashed border is never drawn. Ten
 * such declarations were live in the editor, naming six variables from a
 * vocabulary it does not have.
 *
 * Three readers, one rule: the editor's own stylesheets, the plugins that style
 * against them, and the docs that teach them. The docs had it worst — they named
 * `--accent` and `--bg`, neither of which exists, so a plugin written to the
 * manual drew a black circle on a dark viewport.
 *
 * A `var()` WITH a fallback is not counted: it has an answer either way.
 *
 *   node tools/check-css-vars.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where a variable may be DEFINED, and where one may be USED. */
const DEFINES = ['desktop/src', 'plugins'];
const USES = [
  { dir: 'desktop/src', ext: /\.(css|tsx?)$/ },
  { dir: 'plugins', ext: /\.(css|tsx?)$/ },
  { dir: 'docs/astro/src/content/docs', ext: /\.mdx?$/ },
];

const SKIP = /^(node_modules|dist|build|\.astro|\.esengine|\.git)$/;

const everyFile = (dir, ext, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.test(e.name)) everyFile(p, ext, out); }
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
};

/** Comments out, offsets kept, so a name is never read out of one. */
const uncomment = (t) => t.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

const defined = new Set();
for (const dir of DEFINES) {
  for (const file of everyFile(path.join(ROOT, dir), /\.(css|tsx?)$/)) {
    const text = uncomment(readFileSync(file, 'utf8'));
    // A declaration is a declaration wherever it sits: reading only line starts
    // called `--ag-tone` dead, which `.ag-ask--confirm { --ag-tone: … }` defines.
    for (const m of text.matchAll(/(?:^|[{;\s])(--[A-Za-z0-9_-]+)\s*:/g)) defined.add(m[1]);
    // A script sets one as a style-object key or through setProperty — which is
    // how TilesetEditor gives each cell its `--tcolor`.
    for (const m of text.matchAll(/[`"'](--[A-Za-z0-9_-]+)[`"']/g)) defined.add(m[1]);
  }
}

if (defined.size === 0) {
  console.error('check-css-vars: no variable definitions found — the stylesheets moved.');
  process.exit(1);
}

const problems = [];
let uses = 0;
for (const { dir, ext } of USES) {
  for (const file of everyFile(path.join(ROOT, dir), ext)) {
    const rel = path.relative(ROOT, file).replaceAll(path.sep, '/');
    const text = uncomment(readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)) {
      uses += 1;
      if (m[2] === ',' || defined.has(m[1])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      problems.push(`${rel}:${line}: ${m[1]} is used and nothing defines it — `
        + 'the declaration resolves to nothing and draws nothing');
    }
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-css-vars: ${problems.length} finding(s).`);
  process.exit(1);
}

console.log(`check-css-vars: ${uses} var() over ${defined.size} defined variable(s) — `
  + 'every one names something, across the editor, its plugins and the docs.');
