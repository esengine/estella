// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-pipeline-boundary.mjs — the build does not need a window.
 *
 * Cooking a project and packaging it is what a build server does, so the
 * pipeline has to run where there is no Electron, no React and no editor state.
 * Nothing in the language stops one import of the editor's store from sneaking
 * in; the day it does, the CLI and CI stop being able to build at all, and the
 * failure shows up as a module resolution error nobody reads as an architecture
 * decision.
 *
 * So the direction is checked instead: the pipeline may reach DOWN (the engine's
 * sources, the packaging utilities) and never UP.
 *
 *   node tools/check-pipeline-boundary.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIPELINE = path.join(ROOT, 'pipeline');
const SOURCE = /\.(ts|mts|js|mjs)$/;

/** Repo areas the pipeline is allowed to read: the engine it packages, and the
 *  format writers it packages with. */
const REACHABLE = ['sdk/src', 'build-tools', 'tools'];

/** Packages that only exist inside a running editor. */
const HOST_ONLY = new Set(['electron', 'react', 'react-dom', 'react-dom/client', 'zustand', 'dockview']);

const SPECIFIERS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Why this specifier is something a windowless build cannot have, or null. */
function problem(spec, file) {
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec);
    if (target === PIPELINE || target.startsWith(PIPELINE + path.sep)) return null;
    const rel = path.relative(ROOT, target).split(path.sep).join('/');
    if (REACHABLE.some((area) => rel === area || rel.startsWith(area + '/'))) return null;
    return `reaches ${rel} — the pipeline may read ${REACHABLE.join(', ')}, nothing else`;
  }
  if (spec.startsWith('@/')) return "the editor's path alias — the pipeline has no editor to alias into";
  if (HOST_ONLY.has(spec)) return `${spec} only exists inside the editor process`;
  return null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(PIPELINE);
const findings = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const re of SPECIFIERS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i])) !== null) {
        const why = problem(m[1], file);
        if (why) findings.push({ file: path.relative(ROOT, file), line: i + 1, spec: m[1], why });
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`check-pipeline-boundary: ${files.length} file(s) — the pipeline reaches nothing above it.`);
  process.exit(0);
}
for (const f of findings) {
  console.error(`${f.file}:${f.line}  "${f.spec}" ${f.why}`);
}
console.error(`\ncheck-pipeline-boundary: ${findings.length} finding(s). Move the shared piece down, or keep the caller up.`);
process.exit(1);
