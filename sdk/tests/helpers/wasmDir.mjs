// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  wasmDir.mjs — where the plain-node smoke scripts find the built WASM.
 *
 * The .mjs smokes cannot import the TypeScript {@link ../loadWasm.ts}, so this
 * mirrors its resolution order. `build/wasm/web` is the authoritative build
 * output; `desktop/public/wasm` is a synced copy that only exists when the
 * editor submodule is checked out, so nothing engine-side may require it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

/** First candidate that actually holds `probe`; falls back to the build output. */
export function resolveWasmDir(probe = 'esengine.wasm') {
    const candidates = [
        process.env.ESENGINE_WASM_DIR,
        path.join(ROOT, 'build/wasm/web'),
        path.join(ROOT, 'desktop/public/wasm'),
    ].filter(Boolean);
    for (const dir of candidates) {
        if (existsSync(path.join(dir, probe))) return dir;
    }
    return path.join(ROOT, 'build/wasm/web');
}

/**
 * Skips the caller (exit 0) when the engine has not been built. A smoke that
 * cannot find the binary has verified nothing; exiting non-zero would make an
 * unbuilt checkout indistinguishable from a real regression.
 */
export function requireWasm(probe) {
    const dir = resolveWasmDir(probe);
    if (!existsSync(path.join(dir, probe))) {
        console.log(`SKIP  ${probe} is not built (looked in ${dir}) — run \`node build-tools/cli.js build -t web\``);
        process.exit(0);
    }
    return dir;
}
