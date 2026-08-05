// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  run.mjs — the editor's authoring surface, gated.
 *
 * The engine has had a pixel gate for a long time (verify:render). The EDITOR
 * had none: every check that opens the real app was a script somebody ran once,
 * on the machine that wrote it, which is how depth layers shipped reaching the
 * play realm and neither the viewport nor a build.
 *
 * Each check is a module exporting `{ name, describes, run(ed) → failures[] }`
 * and gets its OWN editor (a boot is ~15s and a shared one would let the first
 * check's project decide the second's answers). Adding a check is adding a file.
 *
 *   node scripts/editor-checks/run.mjs            all of them
 *   node scripts/editor-checks/run.mjs depth      one by name
 *   OUT=<dir> …                                   keep the captures
 *   V=1 …                                         stream the editor's stderr
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEditor } from '../lib/editorDriver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const files = (await readdir(HERE)).filter((f) => f.endsWith('.mjs') && f !== 'run.mjs').sort();
const checks = [];
for (const file of files) {
  const mod = await import(new URL(file, `file://${HERE.replace(/\\/g, '/')}/`).href);
  if (typeof mod.run !== 'function') continue;
  const name = mod.name ?? path.basename(file, '.mjs');
  if (wanted.length && !wanted.some((w) => name.includes(w))) continue;
  checks.push({ name, describes: mod.describes ?? '', run: mod.run });
}

if (checks.length === 0) {
  console.error(`no editor checks matched ${wanted.join(', ') || '(none given)'}`);
  process.exit(1);
}

let failed = 0;
for (const check of checks) {
  const started = Date.now();
  process.stdout.write(`\n=== ${check.name}: ${check.describes}\n`);
  let failures;
  try {
    failures = await withEditor((ed) => check.run(ed), { client: check.name });
  } catch (err) {
    failures = [`threw: ${err instanceof Error ? err.message : String(err)}`];
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (failures?.length) {
    failed++;
    console.error(`FAIL ${check.name} (${secs}s)`);
    for (const f of failures) console.error(`  - ${f}`);
  } else {
    console.log(`PASS ${check.name} (${secs}s)`);
  }
}

console.log(`\neditor checks: ${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
