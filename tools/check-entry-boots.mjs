// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  check-entry-boots.mjs — an entry still installs its platform after a
 *        bundler has been through it.
 *
 * `sideEffects` in package.json is a list of FILES, and which file a statement
 * ends up in is the BUNDLER's choice. Move an entry's prologue into a module the
 * entries share and it lands in a chunk nobody whitelisted, where tree-shaking
 * drops it — the code is still in `dist`, so every text probe says it shipped.
 * It has cost two boots: a lean-entry WeChat package, and the editor, which came
 * up on "Platform not initialized".
 *
 * So this bundles a CONSUMER the way one really resolves the package — through
 * node_modules, so `sideEffects` applies — and RUNS it.
 *
 *   node tools/check-entry-boots.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SDK = path.join(ROOT, 'sdk');

/** Each entry a consumer can resolve, and the platform it must have installed. */
const ENTRIES = [
    { specifier: 'esengine', platform: 'web' },
    { specifier: 'esengine/lean', file: 'dist/index.lean.js', platform: 'web' },
];

const work = mkdtempSync(path.join(tmpdir(), 'estella-entry-boots-'));
const fail = (message, detail) => {
    console.error(`check-entry-boots: ${message}`);
    if (detail) console.error(String(detail).trim());
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    process.exit(1);
};

if (!existsSync(path.join(SDK, 'dist', 'index.js'))) {
    fail('no SDK build at sdk/dist — build it first (pnpm --filter ./sdk build).');
}

mkdirSync(path.join(work, 'node_modules'), { recursive: true });
symlinkSync(SDK, path.join(work, 'node_modules', 'esengine'), 'dir');

const { build } = await import('esbuild');
const results = [];
for (const entry of ENTRIES) {
    const name = entry.specifier.replace(/\W+/g, '-');
    const src = path.join(work, `${name}.mjs`);
    const out = path.join(work, `${name}.bundle.mjs`);
    writeFileSync(src, `import { getPlatformType } from ${JSON.stringify(entry.specifier)};\n`
        + `console.log(getPlatformType());\n`);
    try {
        await build({
            entryPoints: [src], outfile: out, bundle: true, format: 'esm',
            platform: 'node', logLevel: 'silent',
            // A subpath the package does not publish still has to be reachable
            // by the file it is: this asks what the BUILD produced.
            ...(entry.file ? { alias: { [entry.specifier]: path.join(SDK, entry.file) } } : {}),
        });
    } catch (err) {
        fail(`${entry.specifier} did not bundle.`, err?.message ?? err);
    }
    const run = spawnSync(process.execPath, [out], { encoding: 'utf8' });
    const got = (run.stdout ?? '').trim();
    if (run.status !== 0) fail(`${entry.specifier} threw on import.`, run.stderr);
    if (got !== entry.platform) {
        fail(`${entry.specifier} installed no platform after bundling — got ${got || '(nothing)'},`
            + ` expected ${entry.platform}.\n\nIts prologue is a statement in a module the bundler`
            + ' put in an unlisted chunk. Make it a call the entry makes (runtime/webEntry.ts),'
            + ' or list that file in sdk/package.json "sideEffects".');
    }
    results.push(`${entry.specifier} → ${got}`);
}

// One process can hold two entries: a node tool reaches `esengine` through
// modules a browser also runs. They share one core, so the host that declared
// itself must keep the platform whichever order they arrive in.
for (const [first, second] of [['esengine', 'esengine/node'], ['esengine/node', 'esengine']]) {
    const src = path.join(work, `order-${first.replace(/\W+/g, '-')}.mjs`);
    const out = `${src}.bundle.mjs`;
    writeFileSync(src, `import ${JSON.stringify(first)};\n`
        + `import { getPlatformType } from ${JSON.stringify(second)};\n`
        + `console.log(getPlatformType());\n`);
    await build({ entryPoints: [src], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
    const run = spawnSync(process.execPath, [out], { encoding: 'utf8' });
    const got = (run.stdout ?? '').trim();
    if (got !== 'node') {
        fail(`loading ${first} then ${second} left the platform as ${got || '(nothing)'}, not node.`
            + '\n\nA host entry claims the platform outright; the web entry installs one only when'
            + ' nobody has (runtime/webEntry.ts). A node process that ends up on the web adapter'
            + ' reads files over fetch and throws on localStorage.');
    }
    results.push(`${first}+${second} → ${got}`);
}

rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
console.log(`check-entry-boots: ${results.length} case(s) bundled and run — ${results.join(', ')}.`);
