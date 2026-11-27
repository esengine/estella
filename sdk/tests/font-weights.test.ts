// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The weights a shipped font is registered as covering: a variable font's `wght` axis, read from TrueType, WOFF and WOFF2
 *        directories; a font of one weight, or bytes that are no font, none.
 */
import { describe, it, expect } from 'vitest';
import { fontWeightRange } from '../src/platform/fontWeights';

const ascii = (v: DataView, at: number, s: string) => { for (let i = 0; i < 4; i++) v.setUint8(at + i, s.charCodeAt(i)); };

/** An `fvar` table with a `wdth` axis and then a `wght` axis from `min` to `max`. */
function fvar(min: number, max: number): Uint8Array {
    const out = new Uint8Array(16 + 2 * 20);
    const v = new DataView(out.buffer);
    v.setUint16(0, 1); v.setUint16(4, 16); v.setUint16(8, 2); v.setUint16(10, 20);
    ascii(v, 16, 'wdth'); v.setInt32(20, 75 * 65536); v.setInt32(28, 125 * 65536);
    ascii(v, 36, 'wght'); v.setInt32(40, min * 65536); v.setInt32(44, 400 * 65536); v.setInt32(48, max * 65536);
    return out;
}

/** A TrueType file of the tables given, each at its own offset after the directory. */
function truetype(tables: [string, Uint8Array][]): ArrayBuffer {
    const dir = 12 + tables.length * 16;
    const size = dir + tables.reduce((n, [, t]) => n + t.length, 0);
    const out = new Uint8Array(size), v = new DataView(out.buffer);
    v.setUint32(0, 0x00010000); v.setUint16(4, tables.length);
    let at = dir;
    tables.forEach(([name, data], i) => {
        ascii(v, 12 + i * 16, name); v.setUint32(12 + i * 16 + 8, at); v.setUint32(12 + i * 16 + 12, data.length);
        out.set(data, at); at += data.length;
    });
    return out.buffer;
}

describe('the weights a font file draws', () => {
    it('are the wght axis of a variable TrueType font', () => {
        expect(fontWeightRange(truetype([['cmap', new Uint8Array(8)], ['fvar', fvar(100, 900)]]))).toEqual([100, 900]);
        expect(fontWeightRange(truetype([['fvar', fvar(200, 700)]]))).toEqual([200, 700]);
    });

    it('are none for a font of one weight, or bytes that are no font', () => {
        expect(fontWeightRange(truetype([['cmap', new Uint8Array(8)], ['glyf', new Uint8Array(8)]]))).toBeNull();
        expect(fontWeightRange(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
        expect(fontWeightRange(new Uint8Array(64).buffer)).toBeNull();
    });

    it('read an uncompressed WOFF fvar, and say the whole scale for a compressed one', () => {
        const table = fvar(300, 800);
        const make = (compressed: number) => {
            const out = new Uint8Array(44 + 20 + table.length), v = new DataView(out.buffer);
            ascii(v, 0, 'wOFF'); v.setUint16(12, 1);
            ascii(v, 44, 'fvar'); v.setUint32(48, 64); v.setUint32(52, compressed); v.setUint32(56, table.length);
            out.set(table, 64);
            return out.buffer;
        };
        expect(fontWeightRange(make(table.length))).toEqual([300, 800]);
        expect(fontWeightRange(make(table.length - 4))).toEqual([1, 1000]);
    });

    it('find fvar among a WOFF2 font\'s known tables, past a transformed glyf', () => {
        const make = (last: number) => {
            // cmap (0), glyf (10) transformed by version 0 with a transform length, then the last table.
            const entries = [0, 3, 10, 100, 60, last, 16];
            const out = new Uint8Array(48 + entries.length), v = new DataView(out.buffer);
            ascii(v, 0, 'wOF2'); v.setUint16(12, 3);
            out.set(entries, 48);
            return out.buffer;
        };
        expect(fontWeightRange(make(47))).toEqual([1, 1000]);
        expect(fontWeightRange(make(28))).toBeNull();
    });
});
