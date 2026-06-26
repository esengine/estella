// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { bakeCurve } from '../src/particle/curve';
import { GRADIENT_LUT_SIZE } from '../src/particle/gradient';

describe('bakeCurve', () => {
    it('returns null for an empty or absent curve (sim falls back to start/end)', () => {
        expect(bakeCurve(null)).toBeNull();
        expect(bakeCurve({ keys: [] })).toBeNull();
    });

    it('bakes N scalar samples, piecewise-linear between keys', () => {
        const lut = bakeCurve({ keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] })!;
        expect(lut.length).toBe(GRADIENT_LUT_SIZE);
        expect(lut[0]).toBeCloseTo(1, 5); // v=1 at t=0
        expect(lut[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(0, 5); // v=0 at t=1
        expect(lut[Math.round((GRADIENT_LUT_SIZE - 1) / 2)]).toBeCloseTo(0.5, 1); // midpoint
    });

    it('clamps before the first key / after the last + sorts unordered keys', () => {
        const lut = bakeCurve({ keys: [{ t: 1, v: 0.2 }, { t: 0.5, v: 1 }] })!;
        expect(lut[0]).toBeCloseTo(1, 5); // before the first sorted key (t=0.5) holds its value
        expect(lut[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(0.2, 5);
    });
});
