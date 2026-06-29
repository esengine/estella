// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Content hash. XXH64 is the canonical `contentHash`
 *        algorithm; correctness is anchored on the official empty-input vector,
 *        with determinism / sensitivity / branch-coverage guards around it.
 */
import { describe, it, expect } from 'vitest';
import { xxh64, contentHashHex, contentHashOf } from '../src/asset/contentHash';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('xxh64 content hash', () => {
    it('matches the official XXH64("") vector', () => {
        // The one externally-authoritative vector: validates the finalize path.
        expect(xxh64(new Uint8Array(0))).toBe(0xef46db3751d8e999n);
        expect(contentHashHex(new Uint8Array(0))).toBe('ef46db3751d8e999');
    });

    it('is deterministic for the same bytes', () => {
        const a = bytes('the quick brown fox jumps over the lazy dog');
        expect(contentHashHex(a)).toBe(contentHashHex(a.slice()));
    });

    it('changes when a single byte changes (avalanche)', () => {
        const a = bytes('estella-asset-pipeline-rc6');
        const b = a.slice();
        b[5] ^= 0x01;
        expect(contentHashHex(b)).not.toBe(contentHashHex(a));
    });

    it('exercises every length branch (<4, 4–7, 8–31, ≥32 + tail) deterministically', () => {
        // 0,1,3 → per-byte tail; 4,7 → 4-byte tail; 8,31 → 8-byte tail (<32 path);
        // 32,33,40,64 → main 32-byte loop, then mixed tails.
        const lengths = [0, 1, 3, 4, 7, 8, 31, 32, 33, 40, 64];
        const seen = new Set<string>();
        for (const n of lengths) {
            const buf = new Uint8Array(n);
            for (let i = 0; i < n; i++) buf[i] = (i * 37 + 11) & 0xff;
            const h = contentHashHex(buf);
            expect(h).toMatch(/^[0-9a-f]{16}$/);
            expect(contentHashHex(buf.slice())).toBe(h); // deterministic per length
            seen.add(h);
        }
        // Distinct content (length + bytes) → distinct hashes (no collisions here).
        expect(seen.size).toBe(lengths.length);
    });

    it('hashes a 32-byte-block boundary input distinctly from its truncation', () => {
        const buf = new Uint8Array(64);
        for (let i = 0; i < 64; i++) buf[i] = i;
        expect(contentHashHex(buf)).not.toBe(contentHashHex(buf.subarray(0, 63)));
    });

    it('contentHashOf accepts strings (UTF-8) and bytes equivalently', () => {
        const s = 'héllo-世界';
        expect(contentHashOf(s)).toBe(contentHashHex(bytes(s)));
    });

    it('produces 16 lower-case hex digits, zero-padded', () => {
        for (let i = 0; i < 200; i++) {
            const buf = new Uint8Array([i, (i * 3) & 0xff, (i * 7) & 0xff]);
            expect(contentHashHex(buf)).toMatch(/^[0-9a-f]{16}$/);
        }
    });
});
