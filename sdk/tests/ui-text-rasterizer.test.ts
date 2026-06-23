// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.3b — the pure pixel transforms of the Canvas2D glyph
 *        rasterizer (extractAlpha + sdfToAtlasRgba) and their round-trip through
 *        the C++ SDF. The Canvas2D fillText/measure is a happy-dom stub, so
 *        rasterize() itself is render-time-verified; here we cover the parts that
 *        can be checked headless.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { extractAlpha, sdfToAtlasRgba } from '../src/ui/text/glyph-rasterizer';
import { sdfFromAlpha } from '../src/ui/text/sdf';

describe('REARCH_GUI P1.3b: glyph rasterizer pure transforms', () => {
    it('extractAlpha pulls every 4th byte into a tight buffer', () => {
        const rgba = new Uint8Array([1, 2, 3, 10, 4, 5, 6, 20, 7, 8, 9, 30, 0, 0, 0, 40]);
        expect(Array.from(extractAlpha(rgba, 2, 2))).toEqual([10, 20, 30, 40]);
    });

    it('sdfToAtlasRgba puts the SDF in alpha with white RGB', () => {
        const out = sdfToAtlasRgba(new Uint8Array([100, 200]), 2, 1);
        expect(Array.from(out)).toEqual([255, 255, 255, 100, 255, 255, 255, 200]);
    });

    describe.skipIf(!HAS_WASM)('round-trip alpha → SDF → atlas RGBA', () => {
        let module: ESEngineModule;
        beforeAll(async () => { module = await loadWasmModule(); });

        it('atlas tile carries the SDF in alpha, white in RGB', () => {
            const W = 16, H = 16;
            const alpha = new Uint8Array(W * H);
            for (let y = 4; y <= 11; y++) for (let x = 4; x <= 11; x++) alpha[y * W + x] = 255;
            const sdf = sdfFromAlpha(module, alpha, W, H, 4)!;
            const tile = sdfToAtlasRgba(sdf, W, H);
            expect(tile.length).toBe(W * H * 4);
            // interior texel: RGB white, A == its SDF value (>128 inside)
            const c = (8 * W + 8);
            expect(tile[c * 4]).toBe(255);
            expect(tile[c * 4 + 3]).toBe(sdf[c]);
            expect(sdf[c]).toBeGreaterThan(128);
        });
    });
});
