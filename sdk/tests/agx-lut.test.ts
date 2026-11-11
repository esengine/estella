// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { basicEffects } from '../src/postprocess/sources/basic';
import { getEffectDef } from '../src/postprocess/effects';
import { inflateRaw } from '../src/postprocess/inflate';
import { AGX_BASE_SIZE, AGX_LOOK_SIZE, agxAtlasColumns } from '../src/postprocess/agxTables';

describe('the AgX tables an effect brings itself', () => {
    const base = basicEffects.agxLut();
    const baseAt = (r: number, g: number, b: number): number[] => {
        const columns = agxAtlasColumns(AGX_BASE_SIZE);
        const x = (b % columns) * AGX_BASE_SIZE + r, y = Math.floor(b / columns) * AGX_BASE_SIZE + g, i = (y * base.width + x) * 4;
        return [base.pixels[i]!, base.pixels[i + 1]!, base.pixels[i + 2]!, base.pixels[i + 3]!];
    };

    it('is 57 slices of 57 by 57 in an atlas that stays under 512 either way, opaque', () => {
        expect([base.width, base.height]).toEqual([456, 456]);
        expect(base.pixels.length).toBe(456 * 456 * 4);
        for (let i = 3; i < base.pixels.length; i += 4) {
            const tile = Math.floor(i / 4 % base.width / AGX_BASE_SIZE) + 8 * Math.floor(Math.floor(i / 4 / base.width) / AGX_BASE_SIZE);
            if (tile < AGX_BASE_SIZE) expect(base.pixels[i]).toBe(255);
        }
    });

    it('maps a grey to a grey that rises with it, from black to near white', () => {
        let last = -1;
        for (let i = 0; i < AGX_BASE_SIZE; i++) {
            const [r, g, b] = baseAt(i, i, i);
            expect(Math.abs(r! - g!)).toBeLessThanOrEqual(2);
            expect(Math.abs(g! - b!)).toBeLessThanOrEqual(2);
            expect(g!).toBeGreaterThanOrEqual(last);
            last = g!;
        }
        expect(baseAt(0, 0, 0)[1]).toBeLessThan(8);
        expect(baseAt(AGX_BASE_SIZE - 1, AGX_BASE_SIZE - 1, AGX_BASE_SIZE - 1)[1]).toBeGreaterThan(245);
    });

    it('carries the look table as two textures that put back its twelve bits', () => {
        const high = basicEffects.agxLookHigh(), low = basicEffects.agxLookLow();
        const columns = agxAtlasColumns(AGX_LOOK_SIZE);
        expect([high.width, high.height, low.width, low.height]).toEqual([columns * AGX_LOOK_SIZE, Math.ceil(AGX_LOOK_SIZE / columns) * AGX_LOOK_SIZE, high.width, high.height]);
        // The corners of a luminance-compensation table: nothing in is nothing out, and a full-scale input stays near full.
        const value = (r: number, g: number, b: number, c: number): number => {
            const x = (b % columns) * AGX_LOOK_SIZE + r, y = Math.floor(b / columns) * AGX_LOOK_SIZE + g, i = (y * high.width + x) * 4 + c;
            return (high.pixels[i]! * 16 + (low.pixels[i]! >> 4)) / 4095;
        };
        for (let c = 0; c < 3; c++) {
            expect(value(0, 0, 0, c)).toBeLessThan(0.01);
            expect(value(AGX_LOOK_SIZE - 1, AGX_LOOK_SIZE - 1, AGX_LOOK_SIZE - 1, c)).toBeGreaterThan(0.95);
        }
    });

    it('is declared by the agx effect as its own, with the look as a contrast', () => {
        const def = getEffectDef('agx')!;
        expect(def.category).toBe('color');
        expect(Object.keys(def.builtinTextures ?? {})).toEqual(['u_lut', 'u_lookHigh', 'u_lookLow']);
        expect(def.uniforms.map((u) => u.name)).toEqual(['u_contrast']);
        expect(def.uniforms[0]!.defaultValue).toBe(1);
    });
});

describe('the deflate decoder the tables are unpacked with', () => {
    const roundTrip = (data: Uint8Array, level: number): Uint8Array => inflateRaw(new Uint8Array(deflateRawSync(data, { level })), data.length);

    it('returns what zlib packed, for runs, noise and text', () => {
        let seed = 7;
        const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
        const noise = Uint8Array.from({ length: 5000 }, () => Math.floor(random() * 256));
        const runs = Uint8Array.from({ length: 20000 }, (_, i) => (Math.floor(i / 97) % 5 === 0 ? 0 : 7));
        const text = new TextEncoder().encode('the quick brown fox jumps over the lazy dog '.repeat(300));
        for (const level of [0, 1, 6, 9]) {
            for (const data of [noise, runs, text]) expect(Array.from(roundTrip(data, level))).toEqual(Array.from(data));
        }
    });

    it('refuses a stream that ends early rather than returning half', () => {
        const packed = new Uint8Array(deflateRawSync(new TextEncoder().encode('x'.repeat(4000) + 'abcdefg'.repeat(500))));
        expect(() => inflateRaw(packed.subarray(0, 6), 7500)).toThrow();
    });
});
