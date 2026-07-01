// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { ProviderBackend } from '../src/asset/ProviderBackend';
import type { RuntimeAssetProvider } from '../src/runtimeAssets';

/** Minimal provider that resolves `@uuid:x` → `assets/x.png` (idempotent) and
 *  serves text/binary keyed by the resolved path. Mirrors the real providers'
 *  shape: readText/readBinary resolve internally; resolvePath is idempotent. */
function makeProvider(): RuntimeAssetProvider & { calls: string[] } {
    const store: Record<string, { text: string; bytes: Uint8Array }> = {
        'assets/a.png': { text: 'A', bytes: new Uint8Array([1, 2, 3]) },
    };
    const calls: string[] = [];
    const resolvePath = (ref: string): string =>
        ref.startsWith('@uuid:') ? `assets/${ref.slice('@uuid:'.length)}.png` : ref;
    return {
        calls,
        resolvePath,
        async loadPixels() { throw new Error('unused'); },
        readText(ref: string): string {
            calls.push(`readText:${ref}`);
            return store[resolvePath(ref)].text;
        },
        readBinary(ref: string): Uint8Array {
            calls.push(`readBinary:${ref}`);
            return store[resolvePath(ref)].bytes;
        },
    };
}

describe('ProviderBackend', () => {
    it('resolveUrl delegates to provider.resolvePath', () => {
        const backend = new ProviderBackend(makeProvider());
        expect(backend.resolveUrl('@uuid:a')).toBe('assets/a.png');
        expect(backend.resolveUrl('assets/a.png')).toBe('assets/a.png'); // idempotent
    });

    it('fetchText delegates to provider.readText', async () => {
        const backend = new ProviderBackend(makeProvider());
        expect(await backend.fetchText('assets/a.png')).toBe('A');
    });

    it('fetchBinary returns a standalone ArrayBuffer with the exact bytes', async () => {
        const backend = new ProviderBackend(makeProvider());
        const buf = await backend.fetchBinary('assets/a.png');
        expect(buf).toBeInstanceOf(ArrayBuffer);
        expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3]);
    });

    it('fetchBinary copies out a view into a larger pooled buffer', async () => {
        const pool = new Uint8Array([9, 9, 1, 2, 3, 9]); // asset bytes at offset 2, len 3
        const provider: RuntimeAssetProvider = {
            resolvePath: (r) => r,
            async loadPixels() { throw new Error('unused'); },
            readText: () => '',
            readBinary: () => pool.subarray(2, 5),
        };
        const buf = await new ProviderBackend(provider).fetchBinary('x');
        expect(buf.byteLength).toBe(3);
        expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3]);
        // Mutating the pool must not change the returned buffer (it's a copy).
        pool[2] = 0;
        expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3]);
    });

    it('awaits async provider methods', async () => {
        const provider: RuntimeAssetProvider = {
            resolvePath: (r) => r,
            async loadPixels() { throw new Error('unused'); },
            readText: async () => 'async-text',
            readBinary: async () => new Uint8Array([7]),
        };
        const backend = new ProviderBackend(provider);
        expect(await backend.fetchText('x')).toBe('async-text');
        expect(Array.from(new Uint8Array(await backend.fetchBinary('x')))).toEqual([7]);
    });
});
