// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.3a — verifies the SDF glyph-quad submit binding
 *        (renderer_submitTextBatch) is registered on the engine module. The
 *        actual batched draw needs a GL frame (covered end-to-end at P1.3c via
 *        the headless render host); here we confirm the C++ submitTextBatch +
 *        binding + registration compiled and is reachable from TS.
 *
 *        Requires the built WASM SDK (build/wasm/web). Skips if absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

describe.skipIf(!HAS_WASM)('REARCH_GUI P1.3a: text batch submit binding', () => {
    let module: ESEngineModule;
    beforeAll(async () => { module = await loadWasmModule(); });

    it('module exposes renderer_submitTextBatch (embind registered, ungated)', () => {
        expect(typeof (module as unknown as { renderer_submitTextBatch?: unknown })
            .renderer_submitTextBatch).toBe('function');
    });

    it('the TS wrapper no-ops safely without a render frame (guards, no throw)', async () => {
        const { submitTextBatch } = await import('../src/ui/text/submit');
        const verts = new Float32Array(4 * 8);   // one quad
        const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
        const xform = new Float32Array(16); xform[0] = xform[5] = xform[10] = xform[15] = 1;
        // No active render frame headless → binding guards (g_renderFrame null) → no draw, no throw.
        expect(() => submitTextBatch(module, verts, idx, 1, xform, 0, 0, 0)).not.toThrow();
    });
});
