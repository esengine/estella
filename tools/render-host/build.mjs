// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  build.mjs — bundles the engine's render host into build/render-host/.
 *
 * Self-contained on purpose: the host directory is what a runner serves, so the
 * wasm glue is copied in beside the bundle rather than resolved out of the
 * engine tree at request time. One root to serve, one thing to delete.
 *
 *   node tools/render-host/build.mjs
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(ROOT, 'build', 'render-host');
const WASM_SRC = path.join(ROOT, 'build', 'wasm', 'web');

const exists = async (p) => access(p).then(() => true, () => false);

if (!(await exists(path.join(ROOT, 'sdk', 'dist', 'index.js')))) {
    console.error('render-host: the SDK is not built — run `pnpm --filter ./sdk build` first.');
    process.exit(2);
}
if (!(await exists(path.join(WASM_SRC, 'esengine.wasm')))) {
    console.error('render-host: the engine wasm is not built — run `node build-tools/cli.js build -t web` first.');
    process.exit(2);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await build({
    entryPoints: [path.join(HERE, 'host.ts')],
    outfile: path.join(OUT, 'host.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    sourcemap: true,
    logLevel: 'info',
    // The glue is fetched from the served origin at runtime (it is a sibling of
    // the .wasm it locates), so it must not be resolved at bundle time.
    external: ['/wasm/*'],
    // The repo root's package.json is also named "esengine", so a bare specifier
    // resolves to the root rather than to the SDK. Point at the built entries the
    // SDK's own exports name.
    alias: {
        esengine: path.join(ROOT, 'sdk', 'dist', 'index.js'),
        'esengine/spine': path.join(ROOT, 'sdk', 'dist', 'spine', 'index.js'),
        'esengine/dragonbones': path.join(ROOT, 'sdk', 'dist', 'dragonbones', 'index.js'),
        'esengine/wasm': path.join(ROOT, 'sdk', 'dist', 'wasm.js'),
    },
});

await cp(path.join(HERE, 'index.html'), path.join(OUT, 'index.html'));
await cp(WASM_SRC, path.join(OUT, 'wasm'), { recursive: true });
console.log(`render-host: built into ${path.relative(ROOT, OUT)}`);
