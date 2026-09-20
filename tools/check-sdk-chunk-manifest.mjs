#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The chunk manifest says the same thing the emitted bytes do.
 *
 * Eleven SDK entries share one code-split graph, so `dist/shared/` is their
 * union — a web package that copies the directory carries the WeChat and native
 * runtimes too. `dist/chunks.json` is the bundler's record of which chunks each
 * entry reaches, and the exporter ships exactly that.
 *
 * Which makes a manifest that under-reports a chunk into a package missing a
 * module, and the export layer once refused to walk the import graph for this
 * very reason: exact, but silent when wrong. So it is not trusted on its own —
 * this reads the emitted `import` statements back and the two answers have to
 * agree. Two derivations of one fact, one from the bundler's metadata and one
 * from the bytes it wrote.
 *
 *   node tools/check-sdk-chunk-manifest.mjs
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'sdk/dist');
const MANIFEST = path.join(DIST, 'chunks.json');

if (!existsSync(MANIFEST)) {
  console.error(`check-sdk-chunk-manifest: ${path.relative(ROOT, MANIFEST)} missing — `
    + 'build the SDK (pnpm --filter ./sdk build).');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

/**
 * Every static specifier in an emitted chunk. Minified output writes `}from"x"`
 * with no space, and a literal dynamic `import("x")` reaches a chunk just as a
 * static one does.
 */
function specifiers(file) {
  const src = readFileSync(file, 'utf8');
  const found = new Set();
  for (const re of [
    /\b(?:import|export)\b[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    let m;
    while ((m = re.exec(src)) !== null) found.add(m[1]);
  }
  return [...found];
}

const rel = (abs) => path.relative(DIST, abs).split(path.sep).join('/');

/** What `entry` reaches, read off the bytes rather than off the manifest. */
function reached(entry) {
  const seen = new Set();
  const queue = [path.join(DIST, entry)];
  const missing = [];
  while (queue.length > 0) {
    const file = queue.pop();
    const name = rel(file);
    if (seen.has(name)) continue;
    if (!existsSync(file)) { missing.push(name); continue; }
    seen.add(name);
    for (const spec of specifiers(file)) {
      if (spec.startsWith('.')) queue.push(path.resolve(path.dirname(file), spec));
    }
  }
  seen.delete(entry);
  return { seen, missing };
}

const problems = [];

/** An entry the manifest forgot is an entry the exporter ships with no chunks. */
const entries = readdirSync(DIST, { recursive: true })
  .map((f) => String(f).split(path.sep).join('/'))
  .filter((f) => /\.js$/.test(f) && !f.startsWith('shared/') && statSync(path.join(DIST, f)).isFile());

for (const entry of Object.keys(manifest)) {
  if (!existsSync(path.join(DIST, entry))) {
    problems.push(`chunks.json names ${entry}, which dist does not have`);
    continue;
  }
  const { seen, missing } = reached(entry);
  for (const m of missing) problems.push(`${entry} imports ${m}, which dist does not have`);
  const claimed = new Set(manifest[entry]);
  for (const f of seen) {
    if (!claimed.has(f)) {
      problems.push(`${entry} reaches ${f} and chunks.json does not list it — `
        + 'an export trusting the manifest ships a package missing that module');
    }
  }
  for (const f of claimed) {
    if (!seen.has(f)) problems.push(`chunks.json says ${entry} needs ${f}, and nothing in it imports that`);
  }
}

// Entries that produce no chunk of their own still have to be listed, or the
// exporter cannot tell "needs nothing" from "never built".
const unlisted = entries.filter((f) => !(f in manifest) && !/\.bundled\.js$/.test(f)
  && !/^index\.(node|wechat\.cjs)\.js$/.test(f) && f !== 'open-data.js');
for (const f of unlisted) problems.push(`${f} is an entry in dist and chunks.json does not mention it`);

if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`check-sdk-chunk-manifest: ${problems.length} disagreement(s) between the manifest and the bytes.`);
  process.exit(1);
}

const chunks = new Set(Object.values(manifest).flat());
console.log(`check-sdk-chunk-manifest: ${Object.keys(manifest).length} entr(ies) over ${chunks.size} shared chunk(s), `
  + 'manifest and emitted imports agree.');
