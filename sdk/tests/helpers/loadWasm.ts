import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { ESEngineModule } from '../../src/wasm';

/**
 * Single source of truth for where the boundary integration tests find the
 * built WASM SDK (esengine.js + esengine.wasm). Resolution order:
 *   1. $ESENGINE_WASM_DIR        — explicit override (CI passes the build dir)
 *   2. <repo>/build/wasm/web     — the in-repo CMake/Emscripten output
 *   3. <repo>/desktop/public/wasm — legacy path when built inside the editor repo
 *
 * The first candidate that actually contains esengine.wasm wins. If none do,
 * {@link HAS_WASM} is false and the integration suites skip themselves via
 * `describe.skipIf(!HAS_WASM)` rather than throwing. Previously every test
 * hard-coded the (nonexistent in this repo) desktop path, so the entire
 * C++/TS boundary was never exercised here.
 */
function resolveWasmDir(): string {
    const candidates = [
        process.env.ESENGINE_WASM_DIR,
        resolve(__dirname, '../../../build/wasm/web'),
        resolve(__dirname, '../../../desktop/public/wasm'),
    ].filter((c): c is string => Boolean(c));

    for (const dir of candidates) {
        if (existsSync(resolve(dir, 'esengine.wasm'))) return dir;
    }
    // None found — return the canonical in-repo build output so HAS_WASM and
    // any diagnostics point at where the WASM is expected to be built.
    return resolve(__dirname, '../../../build/wasm/web');
}

/** Directory containing the built WASM SDK, per {@link resolveWasmDir}. */
export const WASM_DIR = resolveWasmDir();

/** Absolute path to the built esengine.wasm binary. */
export const WASM_FILE = resolve(WASM_DIR, 'esengine.wasm');

/** True when a built WASM SDK is available to run boundary integration tests. */
export const HAS_WASM = existsSync(WASM_FILE);

let cachedModule: ESEngineModule | null = null;

export async function loadWasmModule(): Promise<ESEngineModule> {
    if (cachedModule) return cachedModule;
    const wasmBinary = readFileSync(WASM_FILE);
    const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
    cachedModule = await factory({ wasmBinary }) as ESEngineModule;
    return cachedModule;
}
