// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    web-spine-provider.test.ts
 * @brief   WebSpineWasmProvider fetches the per-version spine side modules from
 *          the configured base URL — the browser seam that lets 3.8/4.1 assets
 *          load (createWebApp wires it from the wasmBaseUrl option).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSpineWasmProvider } from '../src/spine/WebSpineWasmProvider';

afterEach(() => vi.unstubAllGlobals());

function mockFetch(body: { text?: string; bytes?: ArrayBuffer; ok?: boolean; status?: number }) {
    const fn = vi.fn(async (url: string) => ({
        ok: body.ok ?? true,
        status: body.status ?? 200,
        text: async () => body.text ?? '',
        arrayBuffer: async () => body.bytes ?? new ArrayBuffer(0),
    }));
    vi.stubGlobal('fetch', fn);
    return fn;
}

describe('WebSpineWasmProvider', () => {
    it('fetches spine{NN}.js as text from the base URL (trailing slash tolerated)', async () => {
        const fetchFn = mockFetch({ text: 'SPINE_JS_SOURCE' });
        const p = new WebSpineWasmProvider('/wasm/');
        expect(await p.loadJs('3.8')).toBe('SPINE_JS_SOURCE');
        expect(fetchFn).toHaveBeenCalledWith('/wasm/spine38.js');
    });

    it('fetches spine{NN}.wasm as an ArrayBuffer', async () => {
        const bytes = new Uint8Array([0, 0x61, 0x73, 0x6d]).buffer; // "\0asm"
        const fetchFn = mockFetch({ bytes });
        const p = new WebSpineWasmProvider('https://cdn.example.com/assets');
        expect(await p.loadWasm('4.1')).toBe(bytes);
        expect(fetchFn).toHaveBeenCalledWith('https://cdn.example.com/assets/spine41.wasm');
    });

    it('throws a clear error on a non-ok response instead of feeding garbage to the loader', async () => {
        mockFetch({ ok: false, status: 404 });
        const p = new WebSpineWasmProvider('/wasm');
        await expect(p.loadJs('4.2')).rejects.toThrow(/spine42\.js \(404\)/);
    });
});
