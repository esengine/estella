// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-entries-install-options.mjs — an SDK entry says whether it ships
 *        the optional subsystems, and never leaves it to chance.
 *
 * `createWebApp` no longer names Spine or DragonBones; an entry installs them by
 * CALLING `installOptionalPlugins()`. That is what makes them droppable — and
 * also what makes forgetting it silent: the app builds, the scene loads, and the
 * Spine entities simply never animate.
 *
 * The call is what counts, not the import. This gate read the import, and was
 * green through the whole time the registrations were being tree-shaken away:
 * `import './runtime/optionalPlugins'` was there in every entry and ran in none
 * of the built bundles, because a bare side-effect import is a file's private
 * business and a bundler is entitled to drop it.
 *
 * So every entry either calls it or is listed here as lean, with a reason.
 *
 * And every entry the package PUBLISHES is declared side-effectful, for the same
 * reason one layer down: `esengine/physics3d` registers 3D physics by being
 * imported, and a consumer's bundler drops an import whose bindings go unused
 * unless the package says that file is impure. Five of the eleven were not said.
 *
 *   node tools/check-entries-install-options.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');
const INSTALLER = './runtime/optionalPlugins';
const CALL = 'installOptionalPlugins()';

/** Entries that deliberately ship without the optional subsystems, and why. */
const LEAN = {
  'index.wechat.lean.ts': 'ships no optional subsystem; a package imports back the'
    + ' subpaths its own content uses',
  'index.wechat.base.ts': 'not an entry anyone builds from — the shared half of'
    + ' index.wechat and index.wechat.lean',
};

// Two dotted segments, not one: `index.wechat.lean.ts` did not match a
// single-segment pattern, so the very entry this check exists for was the one
// it never looked at — while still counting it as declared.
const entries = readdirSync(SRC).filter((f) => /^index(\.[a-z0-9]+)*\.ts$/.test(f));
if (entries.length === 0) {
  console.error('check-entries-install-options: no sdk/src/index*.ts — the entries moved.');
  process.exit(1);
}

const missing = [];
for (const file of entries) {
  if (file in LEAN) continue;
  const src = readFileSync(path.join(SRC, file), 'utf8');
  const imports = src.includes(`'${INSTALLER}'`) || src.includes(`"${INSTALLER}"`);
  if (!imports || !src.includes(CALL)) missing.push(file);
}

if (missing.length > 0) {
  console.error(`check-entries-install-options: ${missing.length} entry(ies) install no optional`
    + ` subsystems and are not declared lean:\n`);
  for (const f of missing) console.error(`  sdk/src/${f}`);
  console.error(`\nImport ${CALL.slice(0, -2)} from '${INSTALLER}' AND call it, so apps built`
    + ' from it carry Spine and DragonBones, or list it in LEAN with the reason it'
    + ' ships without them.');
  process.exit(1);
}

/**
 * An entry a consumer can import must be declared impure. Conservative on
 * purpose: an entry is the thing that initializes, and a consumer pays for one
 * only by importing it, so the question "does THIS entry have a side effect
 * today" is one the package should not have to keep answering correctly.
 */
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf8'));
const published = [...new Set(Object.values(pkg.exports ?? {})
  .map((e) => (typeof e === 'string' ? e : e?.import))
  .filter(Boolean))];
const undeclared = published.filter((e) => !(pkg.sideEffects ?? []).includes(e));
if (undeclared.length > 0) {
  console.error(`check-entries-install-options: ${undeclared.length} published entry(ies) are not`
    + ' in sdk/package.json "sideEffects", so a consumer\'s bundler may drop them whole:\n');
  for (const e of undeclared) console.error(`  ${e}`);
  process.exit(1);
}

// Counted over the entries that EXIST, so a stale LEAN key cannot inflate it.
const lean = entries.filter((f) => f in LEAN).length;
const stale = Object.keys(LEAN).filter((f) => !entries.includes(f));
if (stale.length > 0) {
  console.error(`check-entries-install-options: LEAN names ${stale.length} entry(ies) that are`
    + ` not there: ${stale.join(', ')}`);
  process.exit(1);
}
console.log(`check-entries-install-options: ${entries.length} entry(ies) — ${entries.length - lean}`
  + ` install the optional subsystems${lean > 0 ? `, ${lean} declared lean` : ''};`
  + ` ${published.length} published entry(ies), all declared side-effectful.`);
