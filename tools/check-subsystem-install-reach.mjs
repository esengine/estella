#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Every optional subsystem an entry can install, some entry installs.
 *
 * A subsystem behind a subpath is paid for only by the packages that import it —
 * and a package that should have imported it and did not renders a scene with a
 * piece missing and says nothing. Moving tilemap out of the fixed plugin set did
 * exactly that to the web export, which builds from the whole entry and has no
 * subpath step: the example drew its player and none of its ground, with an
 * empty console.
 *
 * So the whole entry installs everything: `installOptionalPlugins` names every
 * `register…Support` there is. A new subsystem that forgets is a build that is
 * quietly missing half a scene.
 *
 *   node tools/check-subsystem-install-reach.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk/src');
const INSTALLER = 'sdk/src/runtime/optionalPlugins.ts';

/** Every `register<X>Support` a subsystem exports, by the file that exports it. */
const supports = [];
for (const dir of readdirSync(SRC, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const name of readdirSync(path.join(SRC, dir.name))) {
    if (!/Support\.ts$/.test(name)) continue;
    const src = readFileSync(path.join(SRC, dir.name, name), 'utf8');
    for (const m of src.matchAll(/export function (register\w*Support)\s*\(/g)) {
      supports.push({ fn: m[1], from: `${dir.name}/${name}` });
    }
  }
}

if (supports.length === 0) {
  console.error('check-subsystem-install-reach: no register…Support found — they moved.');
  process.exit(1);
}

const installer = readFileSync(path.join(ROOT, INSTALLER), 'utf8');
const missing = supports.filter((s) => !new RegExp(`\\b${s.fn}\\s*\\(\\s*\\)`).test(installer));

if (missing.length > 0) {
  for (const s of missing) {
    console.error(`  ${INSTALLER} never calls ${s.fn}() — a package built from the whole `
      + `entry would render ${s.from.split('/')[0]} content with the subsystem absent, silently`);
  }
  console.error(`check-subsystem-install-reach: ${missing.length} subsystem(s) the whole entry forgets.`);
  process.exit(1);
}

console.log(`check-subsystem-install-reach: ${supports.length} optional subsystem(s), `
  + 'each installed by the entry that claims to carry them all.');
