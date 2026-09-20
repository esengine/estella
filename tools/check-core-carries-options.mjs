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
 * An earlier version of this watched two files and read zero — while
 * `ai/perception`, `gameplay` and `app` reached the solvers the whole time. It
 * watches the whole of `sdk/src` now, which is the only scope that can answer
 * the question it is asking.
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

/** Every .ts under sdk/src, as paths relative to it. */
function sources(dir = SRC, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) { sources(full, out); continue; }
    if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path.relative(SRC, full));
  }
  return out;
}

/** The installer's whole job is to reach them, so it is not a finding. It is the
 *  one file an entry imports to decide it ships them — see runtime/optionalPlugins. */
const INSTALLER = path.join('runtime', 'optionalPlugins.ts');

const edges = [];
for (const rel of sources()) {
  if (rel === INSTALLER) continue;
  const owner = rel.split(path.sep)[0];
  // A subsystem reaching its own solver is the subsystem, not the core.
  const src = readFileSync(path.join(SRC, rel), 'utf8');
  for (const m of src.matchAll(/^import\s+(type\s+)?([^;]*?)\s*from\s*'([^']+)'/gim)) {
    if (m[1]) continue;
    const clause = m[2] ?? '';
    const named = clause.match(/\{([^}]*)\}/);
    // `import { type X }` alone erases; `import { type X, Y }` still pulls Y.
    if (named && named[1].split(',').every((s) => s.trim() === '' || /^type\s/.test(s.trim()))) continue;
    for (const [dir, decls] of Object.entries(DECLARATIONS)) {
      const hit = new RegExp(`(^|/)${dir}(/([A-Za-z0-9]+))?$`).exec(m[3]);
      if (!hit || owner === dir) continue;
      // The barrel itself is solver: importing it installs the subsystem.
      const module = hit[3];
      if (module && decls.has(module)) continue;
      edges.push(`${rel.split(path.sep).join('/')} -> ${m[3]}`);
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
