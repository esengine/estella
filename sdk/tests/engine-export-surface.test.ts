// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM, ENGINE_IS_ASMJS, WASM_DIR } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM || ENGINE_IS_ASMJS)('the shipped engine export surface', () => {
    let module: ESEngineModule;
    let glue: string;
    beforeAll(async () => {
        module = await loadWasmModule();
        glue = readFileSync(resolve(WASM_DIR, 'esengine.js'), 'utf8');
    });

    it('exports no yoga C entry points', () => {
        expect([...new Set(glue.match(/\b_YG[A-Z]\w*/g) ?? [])]).toEqual([]);
    });

    it('registers no editor reflection bindings', () => {
        const names = Object.keys(module as unknown as Record<string, unknown>);
        expect(names.filter((name) => name.startsWith('editor_') || name === 'VectorString')).toEqual([]);
    });
});
