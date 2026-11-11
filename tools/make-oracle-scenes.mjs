// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  make-oracle-scenes.mjs — write the oracle scenes under fixtures/scenes/, or `--check` that they are as generated.
 *
 * The expectations live in tools/oracle/ beside the scene that earns them, so a scene and the number it must draw cannot drift.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORACLE } from './oracle/index.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scenes');
const check = process.argv.includes('--check');
mkdirSync(OUT, { recursive: true });
let stale = 0;
for (const o of ORACLE) {
  const file = path.join(OUT, `${o.id}.esscene`);
  const text = JSON.stringify(o.doc, null, 1) + '\n';
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text) { console.error(`stale: ${o.id}`); stale++; }
  } else writeFileSync(file, text);
  // Files a scene loads beside it (a material), written the same way.
  for (const [name, body] of Object.entries(o.files ?? {})) {
    const extra = path.join(OUT, name), content = JSON.stringify(body, null, 2) + String.fromCharCode(10);
    if (check) {
      if (!existsSync(extra) || readFileSync(extra, 'utf8').split(String.fromCharCode(13)).join('') !== content) { console.error(`stale: ${name}`); stale++; }
    } else writeFileSync(extra, content);
  }
}
if (check && stale) { console.error('make-oracle-scenes: run `node tools/make-oracle-scenes.mjs`'); process.exit(1); }
console.log(`make-oracle-scenes: ${ORACLE.length} scene(s) ${check ? 'up to date' : 'written'}`);
