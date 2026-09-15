#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-asset-refs.mjs — a ref a package cannot resolve is a ref to nothing.
 *
 * `component.assetFields` is what makes a field an asset reference: cook
 * inclusion, dependency tracking and `@uuid:` resolution all read it. What a
 * document may SPELL in one is a `@uuid:`, a `builtin:`, or a path from the
 * PROJECT root. An export renames every asset to its content hash and addresses
 * it by one of those, so anything else resolves only in the editor, which reads
 * the file off the disk it is sitting on.
 *
 * That is how a bake shipped dark. `bake-scene` wrote the atlas's bare file
 * name, which means something beside the scene and nothing anywhere else; the
 * packaged game asked its server for `main_lightmap.png` and got a 404, with
 * every gate green — the editor drew the room correctly, and the only tier that
 * launches that project is one CI does not run.
 *
 *   node tools/check-asset-refs.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The shipped corpus: what a creator opens, and what a release argues from. */
const CORPUS = ['examples', 'templates', 'sdk/src', 'tools/fixtures'];

/** Which fields carry an asset, read from the declaration rather than listed
 *  here: a list would be a second author, and it is the one that goes stale. */
function assetFieldsByComponent() {
  const gen = readFileSync(path.join(ROOT, 'sdk/src/ecs/component.generated.ts'), 'utf8');
  const entry = /^ {4}([A-Za-z0-9_]+): \{$/gm;
  const marks = [];
  let m;
  while ((m = entry.exec(gen))) marks.push({ name: m[1], at: m.index });
  const out = new Map();
  for (let i = 0; i < marks.length; i++) {
    const body = gen.slice(marks[i].at, marks[i + 1]?.at ?? gen.length);
    const decl = /assetFields: \[(.*?)\],\n/s.exec(body);
    if (!decl) continue;
    const fields = [...decl[1].matchAll(/field: '([^']+)'/g)].map((x) => x[1]);
    if (fields.length > 0) out.set(marks[i].name, fields);
  }
  return out;
}

function documents() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(esscene|esprefab)$/i.test(e.name)) out.push(p);
    }
  };
  for (const d of CORPUS) walk(path.join(ROOT, d));
  return out;
}

/** A path ref is relative to the project, which is the directory the asset
 *  browser shows — not to the document, which is why this walks up. */
function projectRootOf(file) {
  let dir = path.dirname(file);
  while (dir.startsWith(ROOT) && dir !== ROOT) {
    if (existsSync(path.join(dir, 'project.esproject'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const fieldsOf = assetFieldsByComponent();
if (fieldsOf.size === 0) {
  console.error('check-asset-refs: read no assetFields declarations — the reader is broken,'
    + ' not the corpus');
  process.exit(1);
}

const problems = [];
let refs = 0;
let loose = 0;
const docs = documents();
for (const file of docs) {
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
  const root = projectRootOf(file);
  const rel = path.relative(ROOT, file);
  const visit = (node) => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node === null || typeof node !== 'object') return;
    const fields = typeof node.type === 'string' ? fieldsOf.get(node.type) : undefined;
    if (fields && node.data !== null && typeof node.data === 'object') {
      for (const field of fields) {
        const value = node.data[field];
        if (typeof value !== 'string' || value === '') continue;
        refs++;
        if (value.startsWith('@uuid:') || value.startsWith('builtin:')) continue;
        // Outside a project there is no root to resolve against, so the shape is
        // all that can be judged. Counted rather than skipped silently.
        if (!root) { loose++; continue; }
        if (existsSync(path.join(root, value))) continue;
        const beside = path.join(path.dirname(file), value);
        problems.push(`${rel}: ${node.type}.${field} = "${value}" resolves to nothing`
          + (existsSync(beside) ? ' from the project root (it names a file beside the document —'
            + ' a ref is project-relative, and a package carries no such path)' : ''));
      }
    }
    for (const v of Object.values(node)) visit(v);
  };
  visit(doc);
}

if (problems.length > 0) {
  console.error(`\ncheck-asset-refs: ${problems.length} ref(s) a package cannot resolve\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  A ref is "@uuid:<uuid>", "builtin:<name>", or a path from the project root.\n');
  process.exit(1);
}

console.log(`check-asset-refs: ${refs} asset ref(s) over ${docs.length} document(s) all resolve`
  + `${loose > 0 ? `; ${loose} outside any project, judged by shape only` : ''}.`);
