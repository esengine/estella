// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { bakeGradient, GRADIENT_LUT_SIZE } from '../src/particle/gradient';

const red = { r: 1, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 1, a: 0 };

describe('bakeGradient', () => {
    it('returns null for an empty or absent gradient (sim falls back to start/end)', () => {
        expect(bakeGradient(null)).toBeNull();
        expect(bakeGradient({ stops: [] })).toBeNull();
    });

    it('bakes N×4 RGBA samples spanning the stops', () => {
        const lut = bakeGradient({ stops: [{ t: 0, color: red }, { t: 1, color: blue }] })!;
        expect(lut.length).toBe(GRADIENT_LUT_SIZE * 4);
        // First sample = red (t=0), last = blue (t=1).
        expect([lut[0], lut[1], lut[2], lut[3]]).toEqual([1, 0, 0, 1]);
        const n = GRADIENT_LUT_SIZE - 1;
        expect([lut[n * 4], lut[n * 4 + 1], lut[n * 4 + 2], lut[n * 4 + 3]]).toEqual([0, 0, 1, 0]);
        // Midpoint linearly interpolates (incl. alpha 1→0).
        const mid = Math.round(n / 2);
        expect(lut[mid * 4]).toBeCloseTo(0.5, 1);
        expect(lut[mid * 4 + 2]).toBeCloseTo(0.5, 1);
        expect(lut[mid * 4 + 3]).toBeCloseTo(0.5, 1);
    });

    it('sorts unordered stops and clamps before the first / after the last', () => {
        const lut = bakeGradient({ stops: [{ t: 1, color: blue }, { t: 0, color: red }] })!;
        expect([lut[0], lut[2]]).toEqual([1, 0]); // still red at t=0 after sorting
    });
});
