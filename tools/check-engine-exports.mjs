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
import { fileURLToPath } from 'node:url';
import { listTrackedSources } from './lib/sourceRoots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/esengine/bindings/WebSDKEntry.cpp';

const entry = readFileSync(path.join(ROOT, ENTRY), 'utf8');
const exported = [...entry.matchAll(/emscripten::function\("(\w+)"/g)].map((m) => m[1]);

// The pointer accessors are reached by NAME, out of the generated layout table —
// derived from it rather than listed here, so a new component cannot look dead.
const layouts = readFileSync(path.join(ROOT, 'sdk/src/wasm/ptrLayouts.generated.ts'), 'utf8');
const byName = new Set([...layouts.matchAll(/ptrFn:\s*'(\w+)'/g)].map((m) => m[1]));

// Tests count as callers here: what a binding does to a registry can only be
// read back through another binding. `wasm.ts` declares the surface rather than
// calling it, and generated files name every entry by construction.
const { files, missing } = listTrackedSources(
    ['sdk/src', 'sdk/tests', 'desktop/src', 'desktop/electron', 'desktop/tests', 'tools', 'pipeline/src']);
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

if (unreachable.length > 0) {
    console.error(`${unreachable.length} engine export(s) no host calls:\n`);
    for (const n of unreachable) console.error(`  ${n}`);
    console.error(`\nEither wire it up or drop it from ${ENTRY}: an export with no caller`
        + ' is a capability nothing can find wrong.');
    process.exit(1);
}

console.log(`check-engine-exports: ${exported.length} export(s), every one of them reachable`
    + ` (${byName.size} through the generated pointer table).`);
