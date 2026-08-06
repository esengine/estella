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
/** Root-relative paths that legitimately sit outside the docs base. */
const EXTERNAL_ROOTS = ['/favicon', '/_astro/', '/pagefind/', '/sitemap'];

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

/** The file a `/docs/...` path is served from, or null if nothing emits it. */
function pageFile(urlPath) {
  const rel = urlPath.slice(BASE.length).replace(/^\/+/, '').replace(/\/+$/, '');
  // The Doxygen C++ API is merged in by the site build script, not by Astro.
  if (rel.startsWith('api/')) return 'external';
  const asDir = join(DIST, ...rel.split('/'), 'index.html');
  if (existsSync(asDir)) return asDir;
  const asFile = join(DIST, ...rel.split('/'));
  if (existsSync(asFile) && statSync(asFile).isFile()) return asFile;
  return null;
}

/** Heading ids a page offers, so `#anchor` links are checked too — a heading's
 *  slug is not guessable by hand ("Bodies & colliders" is `bodies--colliders`,
 *  with two hyphens), which makes hand-written anchors quietly wrong. */
const idCache = new Map();
function idsOf(file) {
  let ids = idCache.get(file);
  if (!ids) {
    ids = new Set();
    const html = readFileSync(file, 'utf8');
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
    idCache.set(file, ids);
  }
  return ids;
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
    // Every page on this site lives under /docs. A root-relative href that does
    // not is a typo that no amount of resolving will fix — `/zh-cn/docs/x/` for
    // `/docs/zh-cn/x/` renders as a link off the site, and checking only
    // well-formed ones is how two of those survived.
    for (const m of html.matchAll(/href="(\/(?!docs\/)[^"?:]*)"/g)) {
      const target = m[1];
      if (target === '/' || EXTERNAL_ROOTS.some((p) => target.startsWith(p))) continue;
      checked++;
      const problem = `${target}  (root-relative, but every page is under ${BASE})`;
      if (!dead.has(problem)) dead.set(problem, new Set());
      dead.get(problem).add(relative(DIST, page).replaceAll(sep, '/'));
    }
    for (const m of html.matchAll(/href="(\/docs\/[^"?]*)"/g)) {
      const [path, fragment] = m[1].split('#');
      checked++;
      const file = pageFile(path);
      let problem = null;
      if (!file) problem = m[1];
      else if (fragment && file !== 'external' && !idsOf(file).has(decodeURIComponent(fragment))) {
        problem = `${path}#${fragment}  (page exists, no such heading)`;
      }
      if (!problem) continue;
      if (!dead.has(problem)) dead.set(problem, new Set());
      dead.get(problem).add(relative(DIST, page).replaceAll(sep, '/'));
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
