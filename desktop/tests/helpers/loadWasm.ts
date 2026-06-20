import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import type { ESEngineModule } from 'esengine';

// Where the editor's engine-coupled tests find the built WASM SDK. Mirrors the
// SDK test helper: the in-repo CMake/Emscripten output, then desktop/public
// (the synced copy). Tests skip via `describe.skipIf(!HAS_WASM)` if absent.
const __dirname = fileURLToPath(new URL('.', import.meta.url));
function resolveWasmDir(): string {
    const candidates = [
        process.env.ESENGINE_WASM_DIR,
        resolve(__dirname, '../../../build/wasm/web'),
        resolve(__dirname, '../../public/wasm'),
    ].filter((c): c is string => Boolean(c));
    for (const dir of candidates) {
        if (existsSync(resolve(dir, 'esengine.wasm'))) return dir;
    }
    return resolve(__dirname, '../../../build/wasm/web');
}

export const WASM_DIR = resolveWasmDir();
export const WASM_FILE = resolve(WASM_DIR, 'esengine.wasm');
export const HAS_WASM = existsSync(WASM_FILE);

let cached: ESEngineModule | null = null;
export async function loadWasmModule(): Promise<ESEngineModule> {
    if (cached) return cached;
    const wasmBinary = readFileSync(WASM_FILE);
    const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
    cached = (await factory({ wasmBinary })) as ESEngineModule;
    return cached;
}
