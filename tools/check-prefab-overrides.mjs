// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-prefab-overrides.mjs — every override a shipped scene writes on a
 *        prefab instance names an entity that prefab has.
 *
 * An override is addressed by id, and one whose id names nothing is applied
 * nowhere: the engine warns at load, but a scene nobody opens warns nobody. The
 * character-rig example carried two such overrides — its hero's position and its
 * Animator — so the hero never stood where the scene put it and never moved.
 *
 *   node tools/check-prefab-overrides.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_DIRS = ['examples', 'templates'].flatMap((d) =>
  readdirSync(path.join(ROOT, d)).map((p) => path.join(ROOT, d, p)).filter((p) => existsSync(path.join(p, 'project.esproject'))));

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const problems = [];
let instances = 0;
let overrides = 0;

for (const project of PROJECT_DIRS) {
  const files = walk(project);
  const byUuid = new Map();
  for (const f of files.filter((f) => f.endsWith('.meta'))) {
    try { byUuid.set(JSON.parse(readFileSync(f, 'utf8')).uuid, f.slice(0, -'.meta'.length)); } catch { /* not ours */ }
  }
  const resolve = (ref) => {
    if (typeof ref !== 'string') return null;
    if (ref.startsWith('@uuid:')) return byUuid.get(ref.slice('@uuid:'.length)) ?? null;
    const p = path.join(project, ref);
    return existsSync(p) && statSync(p).isFile() ? p : null;
  };

  /** Every address an override may name in the prefab at @p file: its own
   *  entities, a nested slot's entities under `slot/`, and a variant's base. */
  const addressesOf = (file, seen = new Set()) => {
    if (seen.has(file)) return new Set();
    seen.add(file);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const out = new Set();
    if (data.basePrefab) {
      const base = resolve(data.basePrefab);
      if (base) for (const a of addressesOf(base, seen)) out.add(a);
    }
    for (const e of data.entities ?? []) {
      out.add(e.prefabEntityId);
      const nested = e.nestedPrefab && resolve(e.nestedPrefab.prefabPath);
      if (nested) for (const a of addressesOf(nested, new Set(seen))) out.add(`${e.prefabEntityId}/${a}`);
    }
    return out;
  };

  for (const scene of files.filter((f) => f.endsWith('.esscene'))) {
    let data;
    try { data = JSON.parse(readFileSync(scene, 'utf8')); } catch { continue; }
    for (const entry of data.entities ?? []) {
      if (!entry.prefab) continue;
      instances++;
      const where = `${path.relative(ROOT, scene)} (instance ${entry.id} of ${entry.prefab})`;
      const prefab = resolve(entry.prefab);
      if (!prefab) {
        problems.push(`${where}: the prefab it instances does not exist`);
        continue;
      }
      const addresses = addressesOf(prefab);
      for (const o of entry.overrides ?? []) {
        overrides++;
        if (!addresses.has(o.prefabEntityId)) {
          problems.push(`${where}: a ${o.type} override on "${o.prefabEntityId}"${o.componentType ? ` (${o.componentType})` : ''}, which the prefab has no entity for`);
        }
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`\ncheck-prefab-overrides: ${problems.length} override(s) change nothing.`);
  process.exit(1);
}
console.log(`check-prefab-overrides: ${overrides} override(s) on ${instances} prefab instance(s) in ${PROJECT_DIRS.length} project(s), each naming an entity its prefab has.`);
