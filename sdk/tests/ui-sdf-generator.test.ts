// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  REARCH_GUI P1.1 — verifies the C++ signed-distance-field generator
 *        (text/SdfGenerator.cpp: exact EDT with antialiased-coverage sub-texel
 *        seeding) end-to-end through the `sdfFromAlpha` embind binding + TS
 *        wrapper. Pure compute, so it is fully verifiable headless (unlike
 *        Canvas2D glyph rasterization).
 *
 *        Requires the built WASM SDK (build/wasm/web). Skips if absent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { ESEngineModule } from '../src/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';
import { sdfFromAlpha } from '../src/ui/text/sdf';

const W = 16;
const H = 16;
const at = (x: number, y: number) => y * W + x;

describe.skipIf(!HAS_WASM)('REARCH_GUI P1.1: SDF generator', () => {
    let module: ESEngineModule;
    let sdf: Uint8Array;

    beforeAll(async () => {
        module = await loadWasmModule();
        // A centered 8x8 filled square (cols/rows 4..11 inside) in a 16x16 grid.
        const alpha = new Uint8Array(W * H);
        for (let y = 4; y <= 11; y++) {
            for (let x = 4; x <= 11; x++) alpha[at(x, y)] = 255;
        }
        const out = sdfFromAlpha(module, alpha, W, H, 4);
        expect(out).not.toBeNull();
        sdf = out!;
    });

    it('returns a width*height buffer', () => {
        expect(sdf.length).toBe(W * H);
    });

    it('encodes deep interior high and far exterior low', () => {
        expect(sdf[at(8, 8)]).toBeGreaterThan(200);  // center: deep inside
        expect(sdf[at(0, 0)]).toBeLessThan(56);       // corner: far outside
    });

    it('crosses the 128 edge between an inside and an adjacent outside texel', () => {
        const inside = sdf[at(4, 8)];   // first inside column
        const outside = sdf[at(3, 8)];  // adjacent outside column
        expect(inside).toBeGreaterThan(128);
        expect(outside).toBeLessThan(128);
        expect(inside).toBeGreaterThan(outside);
    });

    it('is monotonic inward along a row (closer to center ⇒ larger SDF)', () => {
        // x = 3 (outside) < 4 (edge) < 6 (deeper) < 8 (center)
        expect(sdf[at(3, 8)]).toBeLessThan(sdf[at(4, 8)]);
        expect(sdf[at(4, 8)]).toBeLessThan(sdf[at(6, 8)]);
        expect(sdf[at(6, 8)]).toBeLessThanOrEqual(sdf[at(8, 8)]);
    });

    it('uses antialiased coverage for sub-texel edge placement (not a 0.5 threshold)', () => {
        // Same square, but the leading edge column carries partial coverage.
        // Under the old binarized 8SSEDT both variants collapsed to the same
        // field (64 < 128 ⇒ outside, 192 ≥ 128 ⇒ inside, full step apart);
        // with coverage seeding the encoded edge shifts fractionally.
        const make = (edgeAlpha: number): Uint8Array => {
            const alpha = new Uint8Array(W * H);
            for (let y = 4; y <= 11; y++) {
                alpha[at(4, y)] = edgeAlpha;
                for (let x = 5; x <= 11; x++) alpha[at(x, y)] = 255;
            }
            return sdfFromAlpha(module, alpha, W, H, 4)!;
        };

        const quarter = make(64);   // edge column 25% covered
        const threeQ = make(192);   // edge column 75% covered

        // More coverage ⇒ that texel is deeper inside ⇒ larger SDF value.
        expect(threeQ[at(4, 8)]).toBeGreaterThan(quarter[at(4, 8)]);
        // Both must land strictly between "far outside" and "fully inside" —
        // i.e. fractional, not snapped a full texel apart on the 0.5 cliff.
        const step = 127 / 4; // one texel in encoded units at spread 4
        expect(Math.abs(threeQ[at(4, 8)] - quarter[at(4, 8)])).toBeLessThan(step);
        // And the fractional shift propagates to the neighbouring texels.
        expect(threeQ[at(3, 8)]).toBeGreaterThanOrEqual(quarter[at(3, 8)]);
        expect(threeQ[at(5, 8)]).toBeGreaterThanOrEqual(quarter[at(5, 8)]);
    });
});
