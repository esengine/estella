// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-core-carries-options.mjs — the core runtime does not grow new
 *        static dependencies on optional subsystems.
 *
 * A mini-game inlines the SDK, and a bundler can only drop a chunk nothing
 * reaches. `runtime/webAppFactory.ts` and `runtime/runtimeLoader.ts` are in every
 * package there is, so every subsystem they `import` by value is too: measured on
 * examples/hello-world, that is 259KB of spine, physics, 3D physics, dragonbones
 * and video in a project using none of them.
 *
 * A ratchet, not a demand for zero — untangling those is the rest of RM-069, and
 * this exists so the number cannot quietly go up while that is being done. A
 * `import type` is free (TypeScript erases it) and is not counted.
 *
 *   node tools/check-core-carries-options.mjs
 *   node tools/check-core-carries-options.mjs --update   # bank the current state
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'tools', 'baselines', 'core-carries-options.json');

/**
 * The files that are in EVERY package: what a runtime must build an app with,
 * and what it must load a scene with. Named rather than derived — a reachability
 * walk would answer the same question and be the thing most likely to break
 * silently — and a rename fails this loudly below rather than reporting zero.
 */
const CORE = ['sdk/src/runtime/webAppFactory.ts', 'sdk/src/runtime/runtimeLoader.ts'];

/**
 * Which source directory each optional module's code lives in. The IDS are not
 * ours — they are checked against SIDE_MODULES below, so renaming one there
 * fails here instead of silently dropping a subsystem from this check.
 */
const DIR_OF = {
  physics: 'physics',
  physics3d: 'physics3d',
  dragonbones: 'dragonbones',
  videodec: 'video',
  basis: 'basis',
  'spine:4.3': 'spine',
};

const registry = readFileSync(path.join(ROOT, 'sdk/src/sideModules/registry.ts'), 'utf8');
const declared = new Set(
  [...registry.matchAll(/^\s{4}'?([a-z0-9:.]+)'?:\s*\{\s*file:/gim)].map((m) => m[1]),
);
const unknown = Object.keys(DIR_OF).filter((id) => !declared.has(id));
if (unknown.length > 0) {
  console.error('check-core-carries-options: these ids are no longer in SIDE_MODULES —'
    + ` the map above is stale: ${unknown.join(', ')}`);
  process.exit(1);
}

/** Value imports (not `import type`) out of @p file, as source-relative paths. */
function valueImports(file) {
  const src = readFileSync(path.join(ROOT, file), 'utf8');
  const out = [];
  for (const m of src.matchAll(/^import\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/gim)) {
    if (m[1]) continue;
    // `import { type X, Y }` still pulls Y; `import { type X }` alone does not.
    const clause = m[2] ?? '';
    const named = clause.match(/\{([^}]*)\}/);
    if (named && named[1].split(',').every((s) => s.trim() === '' || /^type\s/.test(s.trim()))) continue;
    out.push(m[3]);
  }
  return out;
}

const found = [];
for (const file of CORE) {
  if (!existsSync(path.join(ROOT, file))) {
    console.error(`check-core-carries-options: ${file} is not there — the core moved,`
      + ' and this check is reporting about a file that no longer exists.');
    process.exit(1);
  }
  for (const spec of valueImports(file)) {
    for (const [id, dir] of Object.entries(DIR_OF)) {
      if (new RegExp(`(^|/)\\.\\./${dir}(/|$)`).test(spec)) found.push({ file, dir, spec, id });
    }
  }
}

const key = (r) => `${r.file} -> ${r.spec}`;
const now = found.map(key).sort();

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
  console.error(`check-core-carries-options: ${added.length} new static dependency(ies)`
    + ' from the core runtime onto an optional subsystem:\n');
  for (const e of added) console.error(`  ${e}`);
  console.error('\nEvery package carries the core, so it now carries these too. Reach them'
    + ' through the plugin set the runtime is BUILT with, or bank this with --update'
    + ' and say why in the commit.');
  process.exit(1);
}

const byDir = new Map();
for (const r of found) byDir.set(r.dir, (byDir.get(r.dir) ?? 0) + 1);
const spread = [...byDir.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${d} ×${n}`);
console.log(`check-core-carries-options: ${now.length} edge(s) onto ${byDir.size} optional`
  + ` subsystem(s) — ${spread.join(', ')}`
  + `${gone.length > 0 ? `; ${gone.length} fewer than banked (run --update to keep it down)` : ''}`);
