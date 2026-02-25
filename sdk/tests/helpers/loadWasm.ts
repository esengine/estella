import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ESEngineModule } from '../../src/wasm';

const WASM_DIR = resolve(__dirname, '../../../desktop/public/wasm');

let cachedModule: ESEngineModule | null = null;

export async function loadWasmModule(): Promise<ESEngineModule> {
    if (cachedModule) return cachedModule;
    const wasmBinary = readFileSync(resolve(WASM_DIR, 'esengine.wasm'));
    const factory = (await import(resolve(WASM_DIR, 'esengine.js'))).default;
    cachedModule = await factory({ wasmBinary }) as ESEngineModule;
    return cachedModule;
}
