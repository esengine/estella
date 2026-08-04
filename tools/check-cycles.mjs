// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-cycles.mjs — an import-cycle ratchet.
 *
 * A cycle between modules is not a style problem: ESM initializes a cycle's
 * members in an order nobody wrote down, so a `const` read during another
 * module's top-level evaluation is `undefined` rather than an error. That is the
 * failure mode behind "the component lost its identity after a re-import" and
 * behind resolvers that silently never run.
 *
 * ONLY VALUE IMPORTS COUNT. `import type` is erased before the module ever
 * exists, so a type-level cycle cannot misinitialize anything — counting them
 * (madge's default) reports dozens of "cycles" that no runtime has. Two modules
 * naming each other's types is normal and is not a defect to chase.
 *
 * Cycles are counted per entry and compared against `BUDGETS` below. Going OVER
 * fails; coming in UNDER also fails, with the instruction to lower the budget —
 * a ratchet only holds if it cannot silently slip back up after someone pays to
 * bring it down.
 */
import madge from 'madge';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lower these as cycles are broken; never raise them.
//
// The editor's remaining one is EngineHost → SceneLoader → Reconciler →
// EngineHost, and it is PRINCIPLED rather than pending: the three are one
// collaboration around the live World — the host owns it, the loader loads into
// it, the reconciler projects the scene model into it. Breaking it means either
// leaking the App out of EngineHost (worse encapsulation, for one caller) or
// threading a world argument through six modules of call sites. Both are worse
// than the cycle. Judge a NEW cycle on its own merits; do not read this budget
// as permission for one.
const BUDGETS = [
  { name: 'sdk', entry: 'sdk/src/index.ts', extensions: ['ts'], budget: 0 },
  { name: 'editor', entry: 'desktop/src/main.tsx', extensions: ['ts', 'tsx'], budget: 1 },
];

let failed = false;

for (const { name, entry, extensions, budget } of BUDGETS) {
  const res = await madge(path.join(ROOT, entry), {
    fileExtensions: extensions,
    tsConfig: path.join(ROOT, name === 'sdk' ? 'sdk' : 'desktop', 'tsconfig.json'),
    detectiveOptions: { ts: { skipTypeImports: true }, tsx: { skipTypeImports: true } },
  });
  const cycles = res.circular();
  const n = cycles.length;
  const verdict = n > budget ? 'OVER' : n < budget ? 'UNDER' : 'ok';
  console.log(`${name.padEnd(7)} ${String(n).padStart(3)} cycles (budget ${budget}) — ${verdict}`);

  if (n > budget) {
    failed = true;
    console.log(`  ${n - budget} new cycle(s). The shortest ones are usually the real edge:`);
    for (const c of [...cycles].sort((a, b) => a.length - b.length).slice(0, 5)) {
      console.log(`    ${c.join(' → ')} → ${c[0]}`);
    }
  } else if (n < budget) {
    failed = true;
    console.log(`  Cycles were removed — lower ${name}'s budget to ${n} in tools/check-cycles.mjs.`);
  }
}

if (failed) process.exit(1);
console.log('check-cycles: all entries within budget.');
