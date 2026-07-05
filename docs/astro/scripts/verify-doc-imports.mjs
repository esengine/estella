// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify-doc-imports.mjs
 * @brief   Guard against documentation API drift: every symbol the guides import
 *          from the main `esengine` barrel must be a real SDK export.
 *
 * Reads the committed public type surface (`sdk/dist/index.d.ts`) and every
 * `import { … } from 'esengine'` in the docs, and fails if a guide references a
 * symbol the SDK doesn't export (a renamed / removed / fabricated API). Subpath
 * imports (`esengine/physics`, …) are out of scope — this checks the main barrel.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, '..', 'src', 'content', 'docs');
const DTS = join(here, '..', '..', '..', 'sdk', 'dist', 'index.d.ts');

/** Collect the names the bundled d.ts exports. */
function sdkExports() {
  let dts;
  try {
    dts = readFileSync(DTS, 'utf8');
  } catch {
    console.error(`✖ cannot read ${relative(process.cwd(), DTS)} — build the SDK first (pnpm --filter ./sdk build).`);
    process.exit(2);
  }
  const names = new Set();
  const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); };
  for (const m of dts.matchAll(/export\s+declare\s+(?:abstract\s+)?(?:class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of dts.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const blk of dts.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let part of blk[1].split(',')) {
      part = part.trim().replace(/^type\s+/, '');
      if (part) add(part.split(/\s+as\s+/).pop().trim());
    }
  }
  return names;
}

/** Walk the docs tree for .mdx files. */
function mdxFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...mdxFiles(p));
    else if (e.name.endsWith('.mdx')) out.push(p);
  }
  return out;
}

const exports = sdkExports();
// [^{}] keeps the match inside ONE brace pair, so it can't run across a
// neighbouring `import {…} from '@astrojs/...'` into an unrelated block.
const importRe = /import\s*\{([^{}]*)\}\s*from\s*'esengine'/g;
const used = new Map(); // symbol -> Set(files)

for (const f of mdxFiles(DOCS)) {
  const txt = readFileSync(f, 'utf8');
  for (const m of txt.matchAll(importRe)) {
    for (let part of m[1].split(',')) {
      part = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(part)) {
        (used.get(part) ?? used.set(part, new Set()).get(part)).add(relative(DOCS, f));
      }
    }
  }
}

const missing = [...used].filter(([s]) => !exports.has(s));
console.log(`SDK exports: ${exports.size} · doc-imported symbols: ${used.size}`);
if (missing.length === 0) {
  console.log('✓ Every esengine symbol the docs import is a real SDK export.');
  process.exit(0);
}
console.error(`\n✖ ${missing.length} doc-imported symbol(s) are NOT exported by esengine:`);
for (const [s, files] of missing.sort((a, b) => a[0].localeCompare(b[0]))) {
  console.error(`  ${s}  ←  ${[...files].sort().join(', ')}`);
}
process.exit(1);
