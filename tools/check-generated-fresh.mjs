#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-generated-fresh.mjs — the committed *.generated.* files are what
 *        the generator produces today.
 *
 * EHT's outputs are checked in, because the SDK and the editor build without
 * running it. That is a cache with no invalidation: edit the generator, forget to
 * regenerate, and the authority says one thing while the artifact everyone
 * compiles says the older one, with nothing between them to notice.
 *
 * So a whole set is generated into a scratch tree and compared. Nothing is
 * written into the repo, which is what lets this run on a dirty checkout and
 * report on the generator rather than on the working directory.
 *
 * The artifact list is EHT's own stdout ("Generating: <path>"), not a table here:
 * a new generated file is covered the day it exists.
 *
 *   node tools/check-generated-fresh.mjs   (exit 1 on drift, 2 if unanswerable)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolvePython } = await import('../build-tools/utils/emscripten.js');
const { ENGINE_BINDING_HEADERS } = await import('../build-tools/tasks/native.js');

const python = await resolvePython();
if (!python) {
    // Not a pass and not a failure: this machine cannot answer the question.
    console.log('check-generated-fresh: no Python 3 on PATH — cannot run EHT, so nothing was checked.');
    process.exit(2);
}

const out = mkdtempSync(path.join(tmpdir(), 'estella-eht-'));
const eht = path.join(ROOT, 'tools', 'eht.py');
const run = (args) => execFileSync(python, [eht, ...args], { cwd: ROOT, stdio: 'pipe' }).toString();

/** Where a scratch output root maps back to in the repo. */
const ROOTS = [
    [path.join(out, 'bindings'), 'src/esengine/bindings'],
    [path.join(out, 'aot'), 'src/esengine/aot'],
    [path.join(out, 'ts'), 'sdk'],
];

let stdout;
try {
    stdout = run([
        '--input', path.join(ROOT, 'src/esengine/ecs/components'),
        '--entity-header', path.join(ROOT, 'src/esengine/core/Types.hpp'),
        '--const-root', path.join(ROOT, 'src/esengine'),
        '--output', path.join(out, 'bindings'),
        '--ts-output', path.join(out, 'ts'),
        '--aot-output', path.join(out, 'aot'),
    ]);
    // The TS half of the native entry-point surface is committed too, and only a
    // native build refreshes it — the one generated file with no local reason to
    // be regenerated, which is the one most able to rot.
    const nativeTs = path.join(out, 'nativeEngineApi.generated.ts');
    run([
        '--native-functions', ...ENGINE_BINDING_HEADERS.map((h) => path.join(ROOT, 'src/esengine/bindings', h)),
        '--native-functions-ts', nativeTs,
        '--native-shim', 'esn_shim.hpp',
    ]);
    stdout += `Generating: ${nativeTs}\n`;
    ROOTS.push([out, 'sdk/src/ecs/bridge']);
} catch (e) {
    console.error('EHT failed:\n' + String(e.stderr || e.stdout || e.message));
    rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    process.exit(1);
}

const emitted = [...stdout.matchAll(/^Generating: (.+)$/gm)].map((m) => m[1].trim())
    .filter((p) => p.startsWith(out));
const stale = [];
const unmapped = [];
for (const file of emitted) {
    const root = ROOTS.find(([scratch]) => file.startsWith(scratch + path.sep));
    if (!root) { unmapped.push(file); continue; }
    const rel = path.join(root[1], path.relative(root[0], file));
    const committed = path.join(ROOT, rel);
    if (!existsSync(committed)) { stale.push([rel, 'not committed at all']); continue; }
    if (readFileSync(committed).equals(readFileSync(file))) continue;
    stale.push([rel, 'differs from what the generator produces now']);
}
rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

if (emitted.length === 0) {
    console.error('check-generated-fresh: EHT emitted nothing — the run said no file was generated.');
    process.exit(1);
}
if (unmapped.length) {
    console.error('check-generated-fresh: EHT emitted a file this gate cannot map back to the repo:');
    for (const p of unmapped) console.error(`  ${p}`);
    console.error('\nAdd its output root to ROOTS — an unmapped artifact is an unchecked one.');
    process.exit(1);
}
if (stale.length) {
    console.error('Committed generated files are not what the generator produces:\n');
    for (const [rel, why] of stale) console.error(`  ${rel} — ${why}`);
    console.error('\nRegenerate: node build-tools/cli.js eht --no-cache');
    console.error('(the native TS surface, if listed, comes from a native build — see build-tools/tasks/native.js)');
    process.exit(1);
}
console.log(`generated files fresh: ${emitted.length} artifact(s) match the generator.`);
