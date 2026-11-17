#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    check-engine-exports.mjs
 * @brief   Every entry point the engine offers a host must have a caller.
 * @details An export nobody calls is a capability that cannot be wrong, because
 *          nothing exercises it — and it reads as one the engine supports. This
 *          found five submit entry points whose bodies were `(void)registry;`.
 *
 * Run: node tools/check-engine-exports.mjs   (exit 1 on an unreachable export)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { listTrackedSources } from './lib/sourceRoots.mjs';
import { ROOT } from './lib/repo.mjs';

const ENTRY = 'src/esengine/bindings/WebSDKEntry.cpp';

const entry = readFileSync(path.join(ROOT, ENTRY), 'utf8');
const exported = [...entry.matchAll(/emscripten::function\("(\w+)"/g)].map((m) => m[1]);

// The pointer accessors are reached by NAME, out of the generated layout table —
// derived from it rather than listed here, so a new component cannot look dead.
const layouts = readFileSync(path.join(ROOT, 'sdk/src/wasm/ptrLayouts.generated.ts'), 'utf8');
const byName = new Set([...layouts.matchAll(/ptrFn:\s*'(\w+)'/g)].map((m) => m[1]));

const GENERATED = 'src/esengine/bindings/WebBindings.generated.cpp';
const generatedPtrFns = new Set([...readFileSync(path.join(ROOT, GENERATED), 'utf8')
    .matchAll(/emscripten::function\("(get\w+Ptr)"/g)].map((m) => m[1]));
const layoutPtrNames = new Set([...layouts.matchAll(/^ {4}(\w+): \{$/gm)].map((m) => `get${m[1]}Ptr`));
const ptrDrift = [
    ...exported.filter((n) => layoutPtrNames.has(n)).map((n) => `${n} is hand-written in ${ENTRY}`),
    ...[...byName].filter((n) => !generatedPtrFns.has(n)).map((n) => `${n} is in the layout table but not exported by ${GENERATED}`),
    ...[...generatedPtrFns].filter((n) => !byName.has(n)).map((n) => `${n} is exported by ${GENERATED} but its layout has no ptrFn`),
];
if (ptrDrift.length > 0) {
    console.error(`${ptrDrift.length} component pointer function(s) disagree with the generated layout table:\n`);
    for (const d of ptrDrift) console.error(`  ${d}`);
    console.error('\nEHT is the only author of get<Component>Ptr: regenerate it, and export one only'
        + ' for a layout that covers every field of its component.');
    process.exit(1);
}

// Tests count as callers here: what a binding does to a registry can only be
// read back through another binding. `wasm.ts` declares the surface rather than
// calling it, and generated files name every entry by construction.
const { files, missing } = listTrackedSources(
    ['sdk/src', 'sdk/tests', 'desktop/src', 'desktop/electron', 'desktop/tests', 'tools', 'pipeline/src',
        // A bench is a host too, and some entry points exist to be measured
        // before anything is designed around them. Exercised is exercised.
        'bench']);
if (missing.length) {
    console.log(`check-engine-exports: no editor checkout — ${missing.join(', ')} not scanned for callers.`);
}
const texts = files
    .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.includes('.generated.') && f !== 'sdk/src/wasm.ts')
    .map((f) => readFileSync(path.join(ROOT, f), 'utf8'));

const unreachable = exported.filter((name) => {
    if (byName.has(name)) return false;
    const re = new RegExp(`\\b${name}\\b`);
    return !texts.some((t) => re.test(t));
});

// Without the editor's sources an export the inspector alone calls looks dead —
// the profiler's scope readers are exactly that. A verdict this checkout cannot
// reach is not a defect: report it, and leave it to a run that sees both sides.
if (unreachable.length > 0 && missing.length) {
    console.log(`check-engine-exports: ${unreachable.length} export(s) have no caller in the sources`
        + ' scanned here; an editor checkout is needed to judge them:');
    for (const n of unreachable) console.log(`  ${n}`);
} else if (unreachable.length > 0) {
    console.error(`${unreachable.length} engine export(s) no host calls:\n`);
    for (const n of unreachable) console.error(`  ${n}`);
    console.error(`\nEither wire it up or drop it from ${ENTRY}: an export with no caller`
        + ' is a capability nothing can find wrong.');
    process.exit(1);
}

const judged = exported.length - unreachable.length;
console.log(`check-engine-exports: ${judged} of ${exported.length} export(s) reachable`
    + ` (${byName.size} through the generated pointer table).`);
