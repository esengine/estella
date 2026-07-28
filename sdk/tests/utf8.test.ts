// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The fallback is the whole point of this module, and it is the path that never
// runs here: node has TextEncoder, so importing utf8.ts normally exercises the
// platform's implementation and proves nothing about the device. So each case
// runs BOTH — the module imported with the globals deleted (the QuickJS shape)
// checked against the platform's own answer.
import { describe, it, expect, beforeAll, vi } from 'vitest';

type Utf8 = typeof import('../src/util/utf8');

/** utf8.ts as a host with no TextEncoder/TextDecoder sees it. */
async function importWithoutGlobals(): Promise<Utf8> {
    const encoder = globalThis.TextEncoder;
    const decoder = globalThis.TextDecoder;
    // The module caches the globals at load, so they must be gone BEFORE it is
    // evaluated — hence resetModules + a fresh import rather than a spy.
    delete (globalThis as { TextEncoder?: unknown }).TextEncoder;
    delete (globalThis as { TextDecoder?: unknown }).TextDecoder;
    try {
        vi.resetModules();
        return await import('../src/util/utf8?fallback');
    } finally {
        globalThis.TextEncoder = encoder;
        globalThis.TextDecoder = decoder;
    }
}

const CASES = [
    ['ascii', 'DragonBoy_tex.png'],
    ['empty', ''],
    ['latin-1 supplement (2 bytes)', 'café — naïve'],
    ['CJK (3 bytes)', '龙骨动画 · 忍野'],
    ['astral / surrogate pair (4 bytes)', 'a🐉b👨‍👩‍👧c'],
    ['mixed widths', 'xé中\u{1F409}y'],
    ['a whole JSON-ish blob', JSON.stringify({ name: '龙', frames: [1, 2, 3], note: 'ünïcödé 🐲' })],
] as const;

describe('utf8 without the web globals (the device path)', () => {
    let fallback: Utf8;
    beforeAll(async () => { fallback = await importWithoutGlobals(); });

    it('the fallback really is the fallback (no globals at load time)', () => {
        // A canary: if this file ever stops removing the globals, every assertion
        // below would compare the platform against itself and pass vacuously.
        expect(fallback.encodeUtf8).not.toBe((globalThis.TextEncoder.prototype.encode as unknown));
        expect(globalThis.TextEncoder).toBeDefined(); // restored for everyone else
    });

    for (const [label, input] of CASES) {
        it(`encodes ${label} exactly as TextEncoder does`, () => {
            expect(Array.from(fallback.encodeUtf8(input)))
                .toEqual(Array.from(new TextEncoder().encode(input)));
        });

        it(`round-trips ${label}`, () => {
            expect(fallback.decodeUtf8(fallback.encodeUtf8(input))).toBe(input);
        });

        it(`decodes ${label} exactly as TextDecoder does`, () => {
            const bytes = new TextEncoder().encode(input);
            expect(fallback.decodeUtf8(bytes)).toBe(new TextDecoder().decode(bytes));
        });
    }

    it('decodes a buffer larger than one chunk', () => {
        // The decoder emits in 4096-unit chunks; a skeleton file is far bigger, and
        // an off-by-one at the seam would corrupt exactly one character in 4096.
        const input = '龙'.repeat(5000) + 'tail';
        expect(fallback.decodeUtf8(new TextEncoder().encode(input))).toBe(input);
    });

    it('answers U+FFFD for malformed bytes rather than throwing', () => {
        // A truncated 3-byte sequence and a stray continuation byte.
        expect(fallback.decodeUtf8(new Uint8Array([0xe4, 0xb8]))).toBe('��');
        expect(fallback.decodeUtf8(new Uint8Array([0x41, 0x80, 0x42]))).toBe('A�B');
    });
});
