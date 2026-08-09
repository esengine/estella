// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-engine-gaps.mjs — the flagship game uses the engine as a user does.
 *
 * Celestial Heights only proves something about Estella if it was built the way
 * a user could build it. Two things quietly break that: reaching past the public
 * SDK surface, and solving in the game what the engine should have solved. Both
 * leave the release with a game that works and an engine that does not.
 *
 * So this gate asserts the game is an ordinary consumer — imports only what a
 * user can import — and that every departure is written down in the project's
 * ledger, in both directions: no undeclared marker, no unmarked entry. The
 * ledger's own contract (and why `fix` is required) is in engine-gaps.mjs.
 *
 * With --empty it additionally requires the ledger to be empty, which is the
 * release criterion: the game ships with nothing left that Estella should have
 * done itself.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'examples', 'celestial-heights');
const SRC = path.join(PROJECT, 'src');
const LEDGER = path.join(PROJECT, 'engine-gaps.mjs');

const problems = [];
const fail = (msg) => problems.push(msg);

const rel = (p) => path.relative(ROOT, p);

/** Every `.ts` under the project's src, so the walk cannot miss a subdirectory. */
function sources(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * The subpaths a user can actually import, from the SDK's own export map — a
 * second list here would be a list that drifts.
 */
function publicSpecifiers() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf8'));
  return new Set(
    Object.keys(pkg.exports ?? { '.': {} })
      .map((k) => (k === '.' ? 'esengine' : `esengine/${k.replace(/^\.\//, '')}`)),
  );
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const MARKER_RE = /\/\/\s*ENGINE-GAP\(([^)]*)\)\s*:(.*)/g;

if (!existsSync(LEDGER)) {
  console.error(`check-engine-gaps: no ledger at ${rel(LEDGER)} — the project must carry one, even empty.`);
  process.exit(1);
}

const { GAPS } = await import(pathToFileURL(LEDGER).href);
if (!Array.isArray(GAPS)) {
  console.error(`check-engine-gaps: ${rel(LEDGER)} does not export a GAPS array.`);
  process.exit(1);
}

// 1. The ledger holds up on its own terms.
const declared = new Map();
for (const g of GAPS) {
  const id = g?.id;
  if (typeof id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    fail(`an entry has id ${JSON.stringify(id)} — expected kebab-case, and it must match the marker at the site`);
    continue;
  }
  if (declared.has(id)) fail(`"${id}" is listed twice`);
  declared.set(id, g);
  for (const field of ['hurts', 'workaround', 'fix']) {
    if (typeof g[field] !== 'string' || !g[field].trim()) {
      fail(`"${id}" has no ${field} — ${field === 'fix'
        ? 'an entry that cannot name what the engine should do instead is a game decision, not an engine gap'
        : `say ${field === 'hurts' ? 'what hurt' : 'what the game does instead'}`}`);
    }
  }
  if (g.allows !== undefined && !(Array.isArray(g.allows) && g.allows.every((a) => typeof a === 'string' && a))) {
    fail(`"${id}" has an allows that is not a list of import specifiers`);
  }
}

// 2. Every marker in the game names an entry, and 3. every entry is still used.
const marked = new Map();
const files = sources(SRC);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [, id, note] of text.matchAll(MARKER_RE)) {
    const where = `${rel(file)}`;
    if (!id.trim()) {
      fail(`${where}: an ENGINE-GAP marker names no id`);
      continue;
    }
    if (!note.trim()) fail(`${where}: ENGINE-GAP(${id}) says nothing — one sentence on what it is doing here`);
    if (!declared.has(id)) {
      fail(`${where}: ENGINE-GAP(${id}) is not in ${rel(LEDGER)} — a workaround is allowed, going undeclared is not`);
    }
    marked.set(id, (marked.get(id) ?? 0) + 1);
  }
}
for (const id of declared.keys()) {
  if (!marked.has(id)) {
    fail(`"${id}" is in the ledger but nothing in the game is marked with it — the workaround is gone, so drop the entry`);
  }
}

// 4. The game imports what a user can import, and nothing else.
const allowed = publicSpecifiers();
for (const g of GAPS) for (const a of g.allows ?? []) allowed.add(a);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [, spec] of text.matchAll(IMPORT_RE)) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    if (allowed.has(spec)) continue;
    const reachingIn = spec === 'esengine' || spec.startsWith('esengine/');
    fail(`${rel(file)}: imports "${spec}" — ${reachingIn
      ? 'not a subpath the SDK exports, so no user could import it'
      : 'outside the engine surface; if the game genuinely needs it, declare a gap and list it in that entry\'s allows'}`);
  }
}

if (problems.length) {
  console.error('check-engine-gaps: the flagship is not being built the way a user would.\n');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

if (process.argv.includes('--empty') && GAPS.length > 0) {
  console.error(
    `check-engine-gaps: ${GAPS.length} engine gap(s) still open — the release does not ship a game that had to route around it.\n`,
  );
  for (const g of GAPS) console.error(`  ${g.id}: ${g.hurts}\n    fix: ${g.fix}`);
  process.exit(1);
}

const sites = [...marked.values()].reduce((a, b) => a + b, 0);
console.log(
  `check-engine-gaps: ${files.length} game source file(s) import only the public surface`
  + `; ${GAPS.length} declared gap(s) across ${sites} site(s) — ok`,
);
for (const g of GAPS) console.log(`  ${g.id}: ${g.fix}`);
