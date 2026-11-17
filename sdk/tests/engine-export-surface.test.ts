// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM, ENGINE_IS_ASMJS, WASM_FILE } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM || ENGINE_IS_ASMJS)('the shipped engine export surface', () => {
    let module: ESEngineModule;
    let wasmExports: string[];
    beforeAll(async () => {
        module = await loadWasmModule();
        wasmExports = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(WASM_FILE)))
            .map((e) => e.name);
    });

    it('exports no yoga C entry points', () => {
        expect(wasmExports.filter((name) => /^_?YG[A-Z]/.test(name))).toEqual([]);
    });

    it('registers no editor reflection bindings', () => {
        const names = Object.keys(module as unknown as Record<string, unknown>);
        expect(names.filter((name) => name.startsWith('editor_') || name === 'VectorString')).toEqual([]);
    });
});
