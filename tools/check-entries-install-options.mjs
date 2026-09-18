// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-entries-install-options.mjs — an SDK entry says whether it ships
 *        the optional subsystems, and never leaves it to chance.
 *
 * `createWebApp` no longer names Spine or DragonBones; an entry installs them by
 * importing `runtime/optionalPlugins`. That is what makes them droppable — and
 * also what makes forgetting the import silent: the app builds, the scene loads,
 * and the Spine entities simply never animate.
 *
 * So every entry either imports it or is listed here as lean, with a reason.
 *
 *   node tools/check-entries-install-options.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'sdk', 'src');
const INSTALLER = './runtime/optionalPlugins';

/** Entries that deliberately ship without the optional subsystems, and why. */
const LEAN = {
  // (none yet — the export-side lean entry lands with the runtimeLoader half)
};

const entries = readdirSync(SRC).filter((f) => /^index(\.[a-z0-9]+)?\.ts$/.test(f));
if (entries.length === 0) {
  console.error('check-entries-install-options: no sdk/src/index*.ts — the entries moved.');
  process.exit(1);
}

const missing = [];
for (const file of entries) {
  if (file in LEAN) continue;
  const src = readFileSync(path.join(SRC, file), 'utf8');
  if (!src.includes(`'${INSTALLER}'`) && !src.includes(`"${INSTALLER}"`)) missing.push(file);
}

if (missing.length > 0) {
  console.error(`check-entries-install-options: ${missing.length} entry(ies) install no optional`
    + ` subsystems and are not declared lean:\n`);
  for (const f of missing) console.error(`  sdk/src/${f}`);
  console.error(`\nAdd \`import '${INSTALLER}';\` so apps built from it carry Spine and`
    + ' DragonBones, or list it in LEAN with the reason it ships without them.');
  process.exit(1);
}

const lean = Object.keys(LEAN).length;
console.log(`check-entries-install-options: ${entries.length} entry(ies) — ${entries.length - lean}`
  + ` install the optional subsystems${lean > 0 ? `, ${lean} declared lean` : ''}.`);
