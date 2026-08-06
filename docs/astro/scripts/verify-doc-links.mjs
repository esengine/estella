// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    verify-doc-links.mjs
 * @brief   Guard against dead internal documentation links.
 *
 * Walks the built site and resolves every in-site `/docs/...` link against the
 * files the build actually emitted. A guide that links to a page someone
 * renamed — or an old URL whose `redirects` entry was dropped — fails here
 * instead of shipping a 404. Run after `astro build`, from `docs/astro/`:
 *
 *     node scripts/verify-doc-links.mjs
 *
 * Redirect pages count as real destinations: an old address stays valid as long
 * as the build still emits its redirect stub.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, '..', 'dist');
const BASE = '/docs';

/** Every .html file the build emitted. */
function htmlFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Does this in-site path resolve to something the build emitted? */
function resolves(urlPath) {
  const rel = urlPath.slice(BASE.length).replace(/^\/+/, '').replace(/\/+$/, '');
  const asDir = join(DIST, ...rel.split('/'), 'index.html');
  const asFile = join(DIST, ...rel.split('/'));
  if (existsSync(asDir)) return true;
  if (existsSync(asFile) && statSync(asFile).isFile()) return true;
  // The Doxygen C++ API is merged in by the site build script, not by Astro.
  if (rel.startsWith('api/')) return true;
  return false;
}

function main() {
  if (!existsSync(DIST)) {
    console.error(`no build to check at ${DIST} — run \`npm run build\` first`);
    process.exit(1);
  }
  const pages = htmlFiles(DIST);
  const dead = new Map(); // target -> pages that link to it
  let checked = 0;
  for (const page of pages) {
    // The generated TypeScript API is TypeDoc's own link graph, not ours — in
    // every locale it gets mirrored into (hence a segment test, not a prefix).
    if (relative(DIST, page).split(sep).includes('api-ts')) continue;
    const html = readFileSync(page, 'utf8');
    for (const m of html.matchAll(/href="(\/docs\/[^"#?]*)/g)) {
      const target = m[1];
      checked++;
      if (resolves(target)) continue;
      if (!dead.has(target)) dead.set(target, new Set());
      dead.get(target).add(relative(DIST, page).replaceAll(sep, '/'));
    }
  }
  console.log(`checked ${checked} internal links across ${pages.length} pages`);
  if (dead.size === 0) {
    console.log('all internal links resolve');
    return;
  }
  console.error(`\n${dead.size} dead link target(s):`);
  for (const [target, from] of dead) {
    console.error(`  ${target}`);
    for (const f of [...from].slice(0, 5)) console.error(`      linked from ${f}`);
    if (from.size > 5) console.error(`      …and ${from.size - 5} more`);
  }
  process.exit(1);
}

main();
