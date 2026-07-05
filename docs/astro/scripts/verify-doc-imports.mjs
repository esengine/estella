// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify-doc-imports.mjs
 * @brief   Guard against documentation API drift: every symbol the guides import
 *          from the main `esengine` barrel must be a real SDK export.
 *
 * Scans the SDK source (`sdk/src`, always present in the docs CI checkout — the
 * built `dist/` is gitignored) for every exported identifier, and fails if a guide
 * imports a symbol from the main `esengine` barrel that the SDK never exports (a
 * renamed / removed / fabricated API). The source scan is a *superset* of the barrel
 * (it also sees internal exports), so the check only ever errs toward NOT blocking —
 * it never fails a guide that uses a real API. Subpath imports (`esengine/physics`,
 * …) are out of scope — this checks the main barrel.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = join(here, '..', 'src', 'content', 'docs');
const SDK_SRC = join(here, '..', '..', '..', 'sdk', 'src');

/** Recursively list .ts source files (skipping .d.ts and tests). */
function tsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

/** Collect every exported identifier declared or re-exported anywhere under sdk/src. */
function sdkExports() {
  const names = new Set();
  const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); };
  let files;
  try {
    files = tsFiles(SDK_SRC);
  } catch {
    console.error(`✖ cannot read ${relative(process.cwd(), SDK_SRC)} — is the SDK checked out?`);
    process.exit(2);
  }
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
    // export { A, B as C, type D } [from '…']
    for (const blk of src.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (let part of blk[1].split(',')) {
        part = part.trim().replace(/^type\s+/, '');
        if (part) add(part.split(/\s+as\s+/).pop().trim());
      }
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
