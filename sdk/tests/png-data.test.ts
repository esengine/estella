// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePngData } from '../src/asset/pngData';
import { Assets } from '../src/asset/AssetPlugin';
import type { App } from '../src/app/app';
import { imagePixelsAt } from '../src/terrain/layerArrays';

/** A PNG of unfiltered row bytes, written with the specified PNG row filters. */
function png(width: number, height: number, type: 0 | 2 | 4 | 6, rows: number[][], filters: number | readonly number[] = 0, depth = 8): Uint8Array {
    const stride = { 0: 1, 2: 3, 4: 2, 6: 4 }[type] * depth / 8;
    const raw: number[] = [];
    rows.forEach((row, y) => {
        const filter = typeof filters === 'number' ? filters : filters[y]!;
        raw.push(filter);
        row.forEach((v, x) => {
            const a = x >= stride ? row[x - stride]! : 0;
            const b = y > 0 ? rows[y - 1]![x]! : 0;
            const c = x >= stride && y > 0 ? rows[y - 1]![x - stride]! : 0;
            const p = a + b - c;
            const pred = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1
                : filter === 4 ? (Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c) : 0;
            raw.push((v - pred) & 255);
        });
    });
    const chunk = (name: string, data: Uint8Array): number[] => {
        const len = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
        return [...len, ...Array.from(name, (ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
    };
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, width);
    new DataView(ihdr.buffer).setUint32(4, height);
    ihdr[8] = depth; ihdr[9] = type;
    return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', deflateSync(Buffer.from(raw))), ...chunk('IEND', new Uint8Array())]);
}

describe('a PNG read as data', () => {
    it('reads terrain PNG samples exactly without DOM bitmap or decompression APIs', async () => {
        const bytes = png(2, 2, 0, [[0x12, 0x34, 0xff, 0xfe], [0x80, 0x01, 0, 0]], 4, 16);
        const fetchBinary = vi.fn(async () => bytes.slice().buffer);
        const app = { hasResource: (r: unknown) => r === Assets, getResource: () => ({
            fetchBinary, resolveLoadPath: () => 'assets/ground.png',
        }) } as unknown as App;
        vi.stubGlobal('createImageBitmap', undefined);
        vi.stubGlobal('DecompressionStream', undefined);
        vi.stubGlobal('Blob', undefined);
        try {
            const image = await imagePixelsAt(app, '@uuid:heightmap');
            expect(image?.wide).toEqual(Uint16Array.of(0x1234, 0xfffe, 0x8001, 0));
            expect(fetchBinary).toHaveBeenCalledWith('@uuid:heightmap');
            const splat = await decodePngData(png(1, 1, 6, [[255, 0, 0, 0]]));
            expect(splat?.pixels).toEqual(Uint8Array.of(255, 0, 0, 0));
        } finally { vi.unstubAllGlobals(); }
    });

    it('rejects bad zlib checksums and inflated sizes on the portable path', async () => {
        const badChecksum = png(1, 1, 0, [[200]]);
        const length = new DataView(badChecksum.buffer).getUint32(33);
        badChecksum[41 + length - 1]! ^= 1;
        const badSize = png(1, 1, 0, [[200, 100]]);
        vi.stubGlobal('DecompressionStream', undefined);
        try {
            await expect(decodePngData(badChecksum)).rejects.toThrow('checksum');
            await expect(decodePngData(badSize)).rejects.toThrow(/too much|stored block length/);
        } finally { vi.unstubAllGlobals(); }
    });

    it('keeps all portable height samples across rows with and without repeated values', async () => {
        const side = 65;
        const values = Uint16Array.from({ length: side * side }, (_, i) =>
            Math.floor(i / side) % 2 ? Math.imul(i, 2654435761) & 0xffff : 0xa512);
        const rows = Array.from({ length: side }, (_, row) =>
            Array.from(values.subarray(row * side, (row + 1) * side)).flatMap(sample => [sample >>> 8, sample & 255]));
        vi.stubGlobal('DecompressionStream', undefined);
        try {
            expect((await decodePngData(png(side, side, 0, rows, 1, 16)))?.wide).toEqual(values);
        } finally { vi.unstubAllGlobals(); }
    });

    it('keeps red, green and blue where alpha is zero, which a canvas premultiplies away', async () => {
        // A splatmap texel with no rock (alpha 0) and all grass: the grass weight must survive.
        const out = await decodePngData(png(2, 1, 6, [[255, 0, 0, 0, 10, 200, 30, 0]]));
        expect(Array.from(out!.pixels)).toEqual([255, 0, 0, 0, 10, 200, 30, 0]);
    });

    it('undoes every row filter', async () => {
        const rows = [[10, 20, 30, 40, 50, 60, 70, 80], [90, 100, 110, 120, 130, 140, 150, 160], [5, 250, 7, 9, 200, 3, 128, 64]];
        for (const filter of [0, 1, 2, 3, 4]) {
            const out = await decodePngData(png(2, 3, 6, rows, filter));
            expect(Array.from(out!.pixels), `filter ${filter}`).toEqual(rows.flat());
        }
    });

    it('widens grey and RGB to RGBA with an opaque alpha', async () => {
        expect(Array.from((await decodePngData(png(2, 1, 0, [[7, 200]])))!.pixels)).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
        expect(Array.from((await decodePngData(png(1, 1, 2, [[1, 2, 3]])))!.pixels)).toEqual([1, 2, 3, 255]);
    });

    it.each([
        [0, 1, [40, 40, 40, 255]],
        [2, 3, [40, 80, 120, 255]],
        [4, 2, [40, 40, 40, 80]],
        [6, 4, [40, 80, 120, 160]],
    ] as const)('assembles colour type %i consistently across mixed filters', async (type, channels, expected) => {
        const high = Array.from({ length: channels }, (_, i) => 40 * (i + 1));
        const wide = high.flatMap((v, i) => [v, 230 + i]);
        const filters = [4, 1, 0, 2, 3, 4];
        for (const depth of [8, 16]) {
            const pixel = depth === 16 ? wide : high;
            const rows = filters.map(() => [...pixel, ...pixel]);
            const result = (await decodePngData(png(2, rows.length, type, rows, filters, depth)))!;
            expect(Array.from(result.pixels)).toEqual(rows.flatMap(() => [...expected, ...expected]));
            if (depth === 16) expect(result.wide).toEqual(new Uint16Array(rows.length * 2).fill((40 << 8) | 230));
        }
    });

    it('declines what it does not read, so the image path decodes it', async () => {
        expect(await decodePngData(new Uint8Array([1, 2, 3]))).toBeNull();
    });

    it('reads a 16-bit grey PNG at its full depth, keeping each high byte in the RGBA bytes', async () => {
        const values = [0, 0x1234, 0xffff, 0x8001];
        const raw: number[] = [];
        for (let y = 0; y < 2; y++) { raw.push(0); for (let x = 0; x < 2; x++) { const v = values[y * 2 + x]!; raw.push(v >> 8, v & 255); } }
        const chunk = (name: string, data: Uint8Array): number[] => {
            const len = [data.length >>> 24, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255];
            return [...len, ...Array.from(name, (ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
        };
        const ihdr = new Uint8Array(13);
        new DataView(ihdr.buffer).setUint32(0, 2);
        new DataView(ihdr.buffer).setUint32(4, 2);
        ihdr[8] = 16; ihdr[9] = 0;
        const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('IDAT', deflateSync(Buffer.from(raw))), ...chunk('IEND', new Uint8Array())]);
        const out = await decodePngData(bytes);
        expect(Array.from(out!.wide!)).toEqual(values);
        expect(out!.pixels[4]).toBe(0x12);
        expect(out!.pixels[7]).toBe(255);
    });
});
