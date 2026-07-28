// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-layers.mjs — the foundation stays underneath.
 *
 * `util/` and `math/` are what everything else is built ON: a helper, a vector.
 * Neither has any business knowing that scenes, audio or physics exist. Let one
 * reach upward and it stops being a foundation — the cheap import of a helper
 * starts dragging a subsystem behind it.
 *
 * That is ALL this checks, and the scope was earned the hard way. A full
 * low-to-high layering was tried and rejected: it flagged 149 imports, and the
 * overwhelming majority were correct — `asset/loaders/AudioAssetLoader`
 * importing `audio/` IS what an asset loader does, and every `*Plugin.ts`
 * importing `app/` is what a plugin is. `platform/` and `wasm/` were then tried
 * as foundation too and are NOT: a platform adapter exists to implement audio,
 * video and net for one host, and the wasm bridge routes aborts through the
 * app's context. Both are legitimately above the domains they name.
 *
 * A rule that is wrong 149 times teaches everyone to ignore it. This one is
 * narrow enough to be true.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sdk', 'src');

// Checked: may not import a domain.
const FOUNDATION = new Set(['util', 'math']);
// Allowed as a target but not checked as a source. `platform/` is two things at
// once — the host's primitives (storage, fetch) AND that host's audio/video/net
// adapters. A helper reaching for a primitive is fine; the adapter half is why
// platform itself cannot be held to the foundation rule.
const ALLOWED = new Set([...FOUNDATION, 'platform']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (e.name.endsWith('.ts')) out.push(abs);
  }
  return out;
}

/** Top-level directory a file sits in, or null when it is in the package root. */
const areaOf = (abs) => {
  const rel = path.relative(SRC, abs);
  return rel.includes(path.sep) ? rel.split(path.sep)[0] : null;
};

const SPEC_RE = /\bfrom\s*['"](\.[^'"]*)['"]/g;
const violations = [];

for (const file of walk(SRC)) {
  const from = areaOf(file);
  if (!FOUNDATION.has(from)) continue;
  for (const [, spec] of readFileSync(file, 'utf8').matchAll(SPEC_RE)) {
    const resolved = path.resolve(path.dirname(file), spec.split('?')[0]);
    if (!resolved.startsWith(SRC)) continue;
    const isDir = statSync(resolved, { throwIfNoEntry: false })?.isDirectory();
    const to = areaOf(isDir ? path.join(resolved, 'index.ts') : resolved);
    if (to === null || ALLOWED.has(to)) continue;
    violations.push(`${path.relative(SRC, file)}  →  ${to}/`);
  }
}

if (violations.length > 0) {
  console.log(`check-layers: ${violations.length} import(s) out of the foundation:`);
  for (const v of violations) console.log('  ' + v);
  console.log('\nMove the shared piece down, or the importing code up. Do not widen FOUNDATION.');
  process.exit(1);
}
console.log(`check-layers: foundation (${[...FOUNDATION].join(', ')}) imports nothing above it.`);
