// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { ESEngineModule } from '../../src/wasm';

/**
 * Single source of truth for where the boundary integration tests find the
 * built WASM SDK (esengine.js + esengine.wasm). Resolution order:
 *   1. $ESENGINE_WASM_DIR        — explicit override (CI passes the build dir)
 *   2. <repo>/build/wasm/web     — the in-repo CMake/Emscripten output
 *   3. <repo>/desktop/public/wasm — the copy synced into the editor, when checked out
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

/**
 * The side modules the SDK's suites load, beside the engine itself. Declared so
 * one place can say what a run will and will not cover.
 */
export const SIDE_MODULES = [
    'physics', 'physics3d', 'dragonbones', 'basis', 'videodec',
    'spine21', 'spine38', 'spine41', 'spine42', 'spine43',
] as const;

/**
 * Whether this run DECLARED that it has no engine build — the only reason a
 * boundary suite may skip.
 *
 * Inferred from the filesystem, "missing" and "unreachable" both came out as
 * `skipped`, which reads as "not applicable" rather than "unavailable".
 */
export const NO_WASM_MODE = process.env.SDK_TEST_MODE === 'no-wasm';

/** True unless this run declared it has no engine build. */
export const HAS_WASM = !NO_WASM_MODE;


let cachedModule: ESEngineModule | null = null;

export async function loadWasmModule(): Promise<ESEngineModule> {
    if (cachedModule) return cachedModule;
    const wasmBinary = readFileSync(WASM_FILE);
    const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
    cachedModule = await factory({ wasmBinary }) as ESEngineModule;
    return cachedModule;
}

/**
 * A side module (physics, spine38, …), loaded the same way: bytes handed
 * straight to the factory.
 *
 * `locateFile` is the other way emscripten glue finds its binary, and it is the
 * wrong one here — under the happy-dom test environment the glue takes itself
 * for a browser and fetches the path, which resolves against localhost and is
 * refused. The physics benchmarks measured nothing for exactly that reason.
 */
export async function loadSideModule<T>(name: string): Promise<T> {
    const wasmBinary = readFileSync(resolve(WASM_DIR, `${name}.wasm`));
    const factory = (await import(resolve(WASM_DIR, `${name}.js`))).default;
    return await factory({ wasmBinary }) as T;
}

/** Whether a side module was built alongside the engine. False for every module
 *  in a declared no-wasm run, so one flag turns the whole corpus off. */
export const hasSideModule = (name: string): boolean =>
    !NO_WASM_MODE && existsSync(resolve(WASM_DIR, `${name}.wasm`));
