// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { BasisTranscoderImpl, createBasisTranscoder, type BasisWasmModule } from '../src/asset/basisTranscoder';
import { CompressedTextureFormat } from '../src/asset/compressed';

interface MockOpts {
    width?: number; height?: number; transcodedSize?: number;
    openOk?: boolean; transcodeOk?: boolean; fillByte?: number;
}

function makeMockBasis(opts: MockOpts = {}) {
    const width = opts.width ?? 8, height = opts.height ?? 8, size = opts.transcodedSize ?? 32;
    const heap = new Uint8Array(1 << 16);
    let next = 16;
    const calls = { transcodeCode: -1, openPtr: -1, openLen: -1, freed: [] as number[] };
    const mod: BasisWasmModule = {
        _es_basis_init: vi.fn(),
        _es_basis_open: vi.fn((ptr: number, len: number) => {
            calls.openPtr = ptr; calls.openLen = len; return opts.openOk === false ? 0 : 1;
        }),
        _es_basis_get_width: vi.fn(() => width),
        _es_basis_get_height: vi.fn(() => height),
        _es_basis_transcoded_size: vi.fn(() => size),
        _es_basis_transcode: vi.fn((code: number, outPtr: number, outLen: number) => {
            calls.transcodeCode = code;
            if (opts.transcodeOk === false) return 0;
            for (let i = 0; i < outLen; i++) heap[outPtr + i] = opts.fillByte ?? 0xcd;
            return 1;
        }),
        _es_basis_close: vi.fn(),
        _malloc: vi.fn((s: number) => { const p = next; next += s; return p; }),
        _free: vi.fn((p: number) => { calls.freed.push(p); }),
        get HEAPU8() { return heap; },
    };
    return { mod, heap, calls };
}

describe('BasisTranscoderImpl', () => {
    it('copies input into the heap, transcodes to the requested format, copies output out', () => {
        const { mod, heap, calls } = makeMockBasis({ width: 16, height: 8, transcodedSize: 24, fillByte: 0xab });
        const ktx2 = new Uint8Array([1, 2, 3, 4, 5]);
        const r = new BasisTranscoderImpl(mod).transcode(ktx2, CompressedTextureFormat.ASTC_4x4);

        expect(r).not.toBeNull();
        expect(r!.width).toBe(16);
        expect(r!.height).toBe(8);
        expect(r!.data.length).toBe(24);
        expect(Array.from(r!.data)).toEqual(new Array(24).fill(0xab));
        // input was copied into the heap at the opened pointer
        expect(Array.from(heap.slice(calls.openPtr, calls.openPtr + 5))).toEqual([1, 2, 3, 4, 5]);
        expect(calls.openLen).toBe(5);
        // ASTC_4x4 maps to format code 1
        expect(calls.transcodeCode).toBe(1);
        expect(mod._es_basis_close).toHaveBeenCalledOnce();
        // both the input and output buffers were freed
        expect(calls.freed.length).toBe(2);
    });

    it('uses format code 3 (RGBA8) for the fallback path', () => {
        const { mod, calls } = makeMockBasis();
        new BasisTranscoderImpl(mod).transcodeToRgba(new Uint8Array([9]));
        expect(calls.transcodeCode).toBe(3);
    });

    it('maps each compressed format to its contract code', () => {
        const cases: [CompressedTextureFormat, number][] = [
            [CompressedTextureFormat.ETC2_RGBA8, 0],
            [CompressedTextureFormat.ASTC_4x4, 1],
            [CompressedTextureFormat.S3TC_DXT5, 2],
        ];
        for (const [fmt, code] of cases) {
            const { mod, calls } = makeMockBasis();
            new BasisTranscoderImpl(mod).transcode(new Uint8Array([0]), fmt);
            expect(calls.transcodeCode).toBe(code);
        }
    });

    it('returns null when open fails (and still frees the input)', () => {
        const { mod, calls } = makeMockBasis({ openOk: false });
        expect(new BasisTranscoderImpl(mod).transcode(new Uint8Array([0]), CompressedTextureFormat.ETC2_RGBA8)).toBeNull();
        expect(calls.freed.length).toBe(1);
        expect(mod._es_basis_close).not.toHaveBeenCalled();
    });

    it('returns null when the transcoded size is 0', () => {
        const { mod } = makeMockBasis({ transcodedSize: 0 });
        expect(new BasisTranscoderImpl(mod).transcode(new Uint8Array([0]), CompressedTextureFormat.ETC2_RGBA8)).toBeNull();
    });

    it('returns null when transcode fails (and frees both buffers + closes)', () => {
        const { mod, calls } = makeMockBasis({ transcodeOk: false });
        expect(new BasisTranscoderImpl(mod).transcode(new Uint8Array([0]), CompressedTextureFormat.ETC2_RGBA8)).toBeNull();
        expect(mod._es_basis_close).toHaveBeenCalledOnce();
        expect(calls.freed.length).toBe(2);
    });
});

describe('createBasisTranscoder', () => {
    it('instantiates via the factory and initializes the tables', async () => {
        const { mod } = makeMockBasis();
        const factory = vi.fn(async () => mod);
        const t = await createBasisTranscoder(factory);
        expect(factory).toHaveBeenCalledOnce();
        expect(mod._es_basis_init).toHaveBeenCalledOnce();
        expect(t).toBeInstanceOf(BasisTranscoderImpl);
    });
});
