// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-plugin-boundary.mjs — the plugins we ship stay on the public side.
 *
 * A plugin in this repo sits next to the engine, so nothing stops it importing
 * `../../desktop/src/...` and working perfectly — here. Published, that import
 * resolves to nothing, and the API it was meant to prove was never exercised.
 *
 * So the plugins are held to what a third party can reach: their own files, and
 * packages. Anything naming this repo's internals is refused.
 *
 *   node tools/check-plugin-boundary.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = path.join(ROOT, 'plugins');
const SOURCE = /\.(ts|tsx|js|jsx|mjs)$/;

/** Import/require/export-from specifiers, in source order. */
const SPECIFIERS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * Why this specifier is not something a published plugin could resolve, or null.
 * `file` and `pkgDir` are absolute.
 */
function problem(spec, file, pkgDir) {
  if (spec.startsWith('.')) {
    const target = path.resolve(path.dirname(file), spec);
    return target.startsWith(pkgDir + path.sep) || target === pkgDir
      ? null
      : 'reaches outside the package — published, that path does not exist';
  }
  // A bare specifier is a package, which is fine — unless it names this repo.
  if (/^@\//.test(spec)) return 'the editor\'s own path alias — plugins have no such alias';
  if (/(^|\/)(desktop|sdk)\/src\//.test(spec)) return 'imports engine/editor sources directly';
  if (/^esengine\/dist\b/.test(spec)) return 'reaches into the SDK build — import `esengine` (or a documented subpath)';
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

const findings = [];
const packages = existsSync(PLUGINS)
  ? readdirSync(PLUGINS).filter((n) => statSync(path.join(PLUGINS, n)).isDirectory())
  : [];

for (const name of packages) {
  const pkgDir = path.join(PLUGINS, name);
  for (const file of walk(pkgDir)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const re of SPECIFIERS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(lines[i])) !== null) {
          const why = problem(m[1], file, pkgDir);
          if (why) findings.push({ file: path.relative(ROOT, file), line: i + 1, spec: m[1], why });
        }
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`check-plugin-boundary: ${packages.length} plugin(s) — every import is one a published plugin can resolve.`);
  process.exit(0);
}
for (const f of findings) {
  console.error(`${f.file}:${f.line}  "${f.spec}" ${f.why}`);
}
console.error(`\ncheck-plugin-boundary: ${findings.length} finding(s).`);
process.exit(1);
