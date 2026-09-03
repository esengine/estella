// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  build.mjs — what frame-bench.mjs measures, produced once.
 *
 * The bench itself is plain .mjs so a JavaScriptCore runtime can run it (that is
 * the whole point: the no-JIT number is the one that decides AOT). Plain .mjs
 * cannot read TypeScript, and the pipeline that compiles a project IS
 * TypeScript — so the two are separated: this builds, the bench runs.
 *
 * It emits both halves of the comparison from ONE source file:
 *
 * .build/systems.wasm  the compiled twins (emcc, through the real AOT step)
 * .build/systems.json  the manifest a runtime installs them with
 * .build/systems.js    the same file as JavaScript, for the interpreted run
 *
 * The JS twin's `esengine` import is rewritten to the SDK entry the bench itself
 * loads. Left as a bare specifier it would resolve to the package's WEB entry —
 * a second SDK instance with its own component registry, and the two worlds
 * would not be running in the same engine at all.
 *
 * node bench/aot-frame/build.mjs
 */
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PROJECT = join(HERE, 'project');
const OUT = join(HERE, '.build');
const require = createRequire(join(REPO, 'package.json'));

/** The pipeline's AOT step, bundled the way the CLI bundles it. */
async function loadPipeline() {
    const esbuild = require('esbuild');
    const dir = mkdtempSync(join(REPO, 'pipeline', 'src', '.build-'));
    const outfile = join(dir, 'aot.mjs');
    await esbuild.build({
        stdin: {
            contents: "export { buildCompiledSystems } from './bundle/buildCompiledSystems';\n"
                + "export { resolveEmcc, runEmcc } from './bundle/emccPath';\n",
            resolveDir: join(REPO, 'pipeline', 'src'),
            loader: 'ts',
            sourcefile: 'aot-entry.ts',
        },
        outfile,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node20',
        // A CommonJS compiler inlined into an ESM bundle loses the `__filename` it
        // reads at load; external, it is the same package the tests run against.
        external: ['typescript'],
        logLevel: 'error',
    });
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) };
}

async function main() {
    const { mod, cleanup } = await loadPipeline();
    try {
        const emcc = mod.resolveEmcc();
        if (!emcc) throw new Error('no emcc — run `pnpm emsdk:setup`, or set EMSDK');
        console.log(`emcc: ${emcc}`);

        const built = await mod.buildCompiledSystems(PROJECT, { mode: 'release', emcc, run: mod.runEmcc });
        if (!built.ok) throw new Error(`the AOT step refused:\n  ${built.errors.join('\n  ')}`);
        if (!built.wasmPath) throw new Error('nothing was compiled — is the @compiled marker still there?');

        rmSync(OUT, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
        mkdirSync(OUT, { recursive: true });
        copyFileSync(built.wasmPath, join(OUT, 'systems.wasm'));
        writeFileSync(join(OUT, 'systems.json'), `${JSON.stringify(built.manifest, null, 2)}\n`);
        console.log(`compiled: ${built.manifest.systems.map((s) => s.name).join(', ')}`);

        const esbuild = require('esbuild');
        const source = readFileSync(join(PROJECT, 'src', 'systems.ts'), 'utf8');
        const js = (await esbuild.transform(source, { loader: 'ts', format: 'esm', target: 'node20' })).code;
        const sdk = join(REPO, 'sdk', 'dist', 'index.node.js');
        if (!existsSync(sdk)) throw new Error(`the SDK node entry is not built: ${sdk}`);
        writeFileSync(join(OUT, 'systems.js'),
            js.replace(/from\s*["']esengine["']/, `from ${JSON.stringify(pathToFileURL(sdk).href)}`));
        // The same twin for the browser runner, pointed at the SDK the server
        // mounts rather than at a file on this disk.
        writeFileSync(join(OUT, 'systems.web.js'),
            js.replace(/from\s*["']esengine["']/, "from '/sdk/index.js'"));
        console.log(`wrote ${OUT}`);
    } finally {
        cleanup();
    }
}

main().catch((e) => {
    console.error('build failed:', e?.stack || e);
    process.exitCode = 1;
});
