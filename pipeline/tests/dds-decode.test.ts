// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  DDS level 0 decodes to the pixels its blocks encode.
 */
import { describe, it, expect } from 'vitest';
import { decodeDds, isDds } from '../src/assets/ddsDecode';

function dds(opts: { w: number; h: number; fourcc?: string; dxgi?: number; rgbMask?: number }, data: number[]): Uint8Array {
    const head = new Uint8Array(opts.dxgi !== undefined ? 148 : 128);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x20534444, true);
    v.setUint32(4, 124, true);
    v.setUint32(12, opts.h, true);
    v.setUint32(16, opts.w, true);
    v.setUint32(76, 32, true);
    const four = opts.dxgi !== undefined ? 'DX10' : opts.fourcc;
    if (four) {
        v.setUint32(80, 0x4, true);
        for (let i = 0; i < 4; i++) head[84 + i] = four.charCodeAt(i);
        if (opts.dxgi !== undefined) v.setUint32(128, opts.dxgi, true);
    } else {
        v.setUint32(80, 0x40 | 0x1, true);
        v.setUint32(88, 32, true);
        v.setUint32(92, opts.rgbMask ?? 0x000000ff, true);
    }
    return new Uint8Array([...head, ...data]);
}

const px = (d: { rgba: Uint8Array; width: number }, x: number, y: number) => [...d.rgba.subarray((y * d.width + x) * 4, (y * d.width + x) * 4 + 4)];

describe('decoding a DDS', () => {
    it('reads a BC1 block through its four-colour palette', () => {
        // c0 = pure red (565: 0xF800) > c1 = pure blue (0x001F): four opaque colours.
        // Row 0 indices 0,1,2,3; the other rows 0.
        const d = decodeDds(dds({ w: 4, h: 4, fourcc: 'DXT1' }, [0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]));
        expect(isDds(dds({ w: 4, h: 4, fourcc: 'DXT1' }, new Array(8).fill(0)))).toBe(true);
        expect([px(d, 0, 0), px(d, 1, 0), px(d, 2, 0), px(d, 3, 0)])
            .toEqual([[255, 0, 0, 255], [0, 0, 255, 255], [170, 0, 85, 255], [85, 0, 170, 255]]);
        expect(px(d, 0, 3)).toEqual([255, 0, 0, 255]);
    });

    it("reads BC1's three-colour mode with its transparent black", () => {
        const d = decodeDds(dds({ w: 4, h: 4, fourcc: 'DXT1' }, [0x1f, 0x00, 0x00, 0xf8, 0b11100100, 0, 0, 0]));
        expect(px(d, 2, 0)).toEqual([128, 0, 128, 255]);
        expect(px(d, 3, 0)).toEqual([0, 0, 0, 0]);
    });

    it('interpolates BC3 alpha between its two ends', () => {
        // Alpha ends 255 and 0 (a0 > a1: eight-value mode); texel 0 index 0, texel 1 index 2.
        const alpha = [255, 0, 0b010000, 0, 0, 0, 0, 0];
        const color = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        const d = decodeDds(dds({ w: 4, h: 4, fourcc: 'DXT5' }, [...alpha, ...color]));
        expect(px(d, 0, 0)[3]).toBe(255);
        expect(px(d, 1, 0)[3]).toBe(Math.round((6 * 255) / 7));
        expect(px(d, 0, 0).slice(0, 3)).toEqual([255, 255, 255]);
    });

    it("rebuilds a BC5 normal's Z so it is unit length", () => {
        // X and Y both at the 128 midpoint (a flat normal): Z must come out at the top.
        const ch = [128, 128, 0, 0, 0, 0, 0, 0];
        const d = decodeDds(dds({ w: 4, h: 4, fourcc: 'ATI2' }, [...ch, ...ch]));
        expect(px(d, 0, 0)).toEqual([128, 128, 255, 255]);
    });

    it('swaps BGRA to RGBA, and names a format it does not decode', () => {
        const d = decodeDds(dds({ w: 1, h: 1, rgbMask: 0x00ff0000 }, [10, 20, 30, 40]));
        expect(px(d, 0, 0)).toEqual([30, 20, 10, 40]);
        expect(() => decodeDds(dds({ w: 4, h: 4, dxgi: 98 }, new Array(16).fill(0)))).toThrow(/BC7/);
    });
});
