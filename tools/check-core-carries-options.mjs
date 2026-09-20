// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-core-carries-options.mjs — what the non-optional half of the SDK
 *        drags in from the optional subsystems.
 *
 * A mini-game inlines the SDK, and a bundler can only drop a chunk nothing
 * reaches. So every value import from outside a subsystem into its SOLVER is a
 * subsystem every package carries, whatever the project contains.
 *
 * The scope is what makes this true or noise. Watching two files read zero while
 * `ai/perception` and `gameplay` reached the solvers; watching all of `sdk/src`
 * counted six edges in native-only modules no mini-game package contains. So it
 * walks out from the LEANEST mini-game entry: a file that entry cannot reach is
 * not in the package, whatever it imports.
 *
 * DECLARATIONS vs SOLVER is not a list kept here: a subsystem draws that line
 * itself, in the entry point named below, and anything it does not export is
 * solver. A subsystem with no such entry is solver all the way through.
 *
 * A ratchet, not a demand for zero — some of these are real features (navigation
 * reads 3D collider shapes). New ones are what it refuses.
 *
 *   node tools/check-core-carries-options.mjs
 *   node tools/check-core-carries-options.mjs --update   # bank the current state
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');
const BASELINE = path.join(ROOT, 'tools', 'baselines', 'core-carries-options.json');

/** The optional subsystems, and the entry each uses to say which of its modules
 *  are DECLARATIONS. A missing entry means the whole subsystem is solver. */
const SUBSYSTEMS = {
  physics: 'components.ts',
  physics3d: null,
  spine: null,
  dragonbones: null,
  video: null,
};

/** The ids above are checked against SIDE_MODULES, so renaming one there fails
 *  here rather than silently dropping a subsystem from what this watches. */
const registry = readFileSync(path.join(SRC, 'sideModules/registry.ts'), 'utf8');
const declaredIds = new Set(
  [...registry.matchAll(/^\s{4}'?([a-z0-9:.]+)'?:\s*\{\s*file:/gim)].map((m) => m[1].split(':')[0]),
);
// `video` ships as the `videodec` module and `spine` as `spine:<version>`; both
// are the subsystem's directory name, which is what an import path spells.
const ALIAS = { video: 'videodec' };
const unknown = Object.keys(SUBSYSTEMS).filter((id) => !declaredIds.has(ALIAS[id] ?? id));
if (unknown.length > 0) {
  console.error(`check-core-carries-options: not in SIDE_MODULES any more: ${unknown.join(', ')}`);
  process.exit(1);
}

/** The modules a subsystem's declaration entry re-exports — its public "data" half. */
function declarationsOf(dir, entry) {
  if (!entry) return new Set();
  const file = path.join(SRC, dir, entry);
  if (!existsSync(file)) {
    console.error(`check-core-carries-options: ${dir}/${entry} is gone — the subsystem`
      + ' no longer says where its declarations end.');
    process.exit(1);
  }
  const src = readFileSync(file, 'utf8');
  return new Set([...src.matchAll(/from\s*'\.\/([A-Za-z0-9]+)'/g)].map((m) => m[1]));
}

const DECLARATIONS = Object.fromEntries(
  Object.entries(SUBSYSTEMS).map(([dir, entry]) => [dir, declarationsOf(dir, entry)]),
);

/** The entry a package carries least of: no optional subsystem installed, so
 *  everything it reaches is something EVERY mini-game package holds. */
const LEAN_ENTRY = 'index.wechat.lean.ts';

/** Resolve a relative specifier from `fromRel` to a file under sdk/src, or null. */
function resolveLocal(fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.join(path.dirname(path.join(SRC, fromRel)), spec);
  for (const cand of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return path.relative(SRC, cand);
  }
  return null;
}

/**
 * Every value import or re-export in `rel`, as [specifier, resolvedRelPath|null].
 *
 * `export … from` counts: an entry that only re-exports still carries every
 * module it names. Reading imports alone walked out of the lean entry — which is
 * one `export * from` — and reported zero edges for the whole SDK.
 */
function importsOf(rel) {
  const src = readFileSync(path.join(SRC, rel), 'utf8');
  const out = [];
  for (const m of src.matchAll(/^(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/gim)) {
    if (m[1]) continue;
    const named = (m[2] ?? '').match(/\{([^}]*)\}/);
    // `{ type X }` alone erases; `{ type X, Y }` still pulls Y.
    if (named && named[1].split(',').every((t) => t.trim() === '' || /^type\s/.test(t.trim()))) continue;
    out.push([m[3], resolveLocal(rel, m[3])]);
  }
  return out;
}

/** Files the lean entry reaches, which is what every package carries. */
function sources() {
  if (!existsSync(path.join(SRC, LEAN_ENTRY))) {
    console.error(`check-core-carries-options: ${LEAN_ENTRY} is gone — this no longer`
      + ' knows what a minimal package contains.');
    process.exit(1);
  }
  const seen = new Set([LEAN_ENTRY]);
  const queue = [LEAN_ENTRY];
  while (queue.length > 0) {
    for (const [, next] of importsOf(queue.pop())) {
      if (next && !seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen];
}

/** The installer's whole job is to reach them, so it is not a finding. It is the
 *  one file an entry imports to decide it ships them — see runtime/optionalPlugins. */
const INSTALLER = path.join('runtime', 'optionalPlugins.ts');

const edges = [];
for (const rel of sources()) {
  if (rel === INSTALLER) continue;
  const owner = rel.split(path.sep)[0];
  // A subsystem reaching its own solver is the subsystem, not the core.
  for (const [spec] of importsOf(rel)) {
    for (const [dir, decls] of Object.entries(DECLARATIONS)) {
      const hit = new RegExp(`(^|/)${dir}(/([A-Za-z0-9]+))?$`).exec(spec);
      if (!hit || owner === dir) continue;
      // The barrel itself is solver: importing it installs the subsystem.
      const module = hit[3];
      if (module && decls.has(module)) continue;
      edges.push(`${rel.split(path.sep).join('/')} -> ${spec}`);
    }
  }
}

const now = [...new Set(edges)].sort();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify({ edges: now }, null, 2)}\n`);
  console.log(`check-core-carries-options: banked ${now.length} edge(s).`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error('check-core-carries-options: no baseline — run with --update once.');
  process.exit(2);
}
const before = new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).edges);
const added = now.filter((e) => !before.has(e));
const gone = [...before].filter((e) => !now.includes(e));

if (added.length > 0) {
  console.error(`check-core-carries-options: ${added.length} new reach(es) into an optional`
    + ' subsystem\'s solver:\n');
  for (const e of added) console.error(`  ${e}`);
  console.error('\nEvery package carries the reaching side, so it now carries that solver too.'
    + ' Reach it through a seam (runtime/sceneOptionals), take only what the subsystem'
    + ' declares, or bank this with --update and say why in the commit.');
  process.exit(1);
}

console.log(`check-core-carries-options: ${now.length} reach(es) into optional solvers`
  + `${gone.length > 0 ? `, ${gone.length} fewer than banked (run --update)` : ''}`);
