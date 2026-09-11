// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, vi } from 'vitest';
import { bakeCurve } from '../src/particle/curve';
import { GRADIENT_LUT_SIZE } from '../src/particle/gradient';
import { InterpType, linearKey } from '../src/math/keyframes';

describe('bakeCurve', () => {
    it('returns null for an empty or absent curve (sim falls back to start/end)', () => {
        expect(bakeCurve(null)).toBeNull();
        expect(bakeCurve({ keys: [] })).toBeNull();
    });

    it('bakes N scalar samples, piecewise-linear between keys', () => {
        const lut = bakeCurve({ keys: [linearKey(0, 1), linearKey(1, 0)] })!;
        expect(lut.length).toBe(GRADIENT_LUT_SIZE);
        expect(lut[0]).toBeCloseTo(1, 5);
        expect(lut[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(0, 5);
        expect(lut[Math.round((GRADIENT_LUT_SIZE - 1) / 2)]).toBeCloseTo(0.5, 1);
    });

    it('clamps before the first key / after the last + sorts unordered keys', () => {
        const lut = bakeCurve({ keys: [linearKey(1, 0.2), linearKey(0.5, 1)] })!;
        expect(lut[0]).toBeCloseTo(1, 5);
        expect(lut[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(0.2, 5);
    });

    // A particle curve can ease. The MIDPOINT is what separates the two — both agree
    // at the ends whatever the interpolation says.
    it('eases when a key says to, where a linear key would not', () => {
        const mid = Math.round((GRADIENT_LUT_SIZE - 1) / 2);
        const linear = bakeCurve({ keys: [linearKey(0, 0), linearKey(1, 1)] })!;
        const eased = bakeCurve({
            keys: [
                { time: 0, value: 0, inTangent: 0, outTangent: 0, interpolation: InterpType.EaseIn },
                { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: InterpType.EaseIn },
            ],
        })!;
        expect(linear[mid]).toBeCloseTo(0.5, 1);
        expect(eased[mid]).toBeCloseTo(0.25, 1);
        expect(eased[0]).toBeCloseTo(linear[0], 5);
        expect(eased[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(linear[GRADIENT_LUT_SIZE - 1], 5);
    });

    // A curve whose keys are not numbers must not bake NaN: a particle sized NaN draws
    // nothing, so the emitter would disappear with nothing said. Refusing it falls back
    // to start/end — wrong, but visible.
    it('refuses keys that are not finite rather than baking NaN', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(bakeCurve({ keys: [{ t: 0, v: 1 }, { t: 1, v: 0 }] } as never)).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('holds a value flat until the next key when a key steps', () => {
        const lut = bakeCurve({
            keys: [
                { time: 0, value: 0.25, inTangent: 0, outTangent: 0, interpolation: InterpType.Step },
                { time: 1, value: 1, inTangent: 0, outTangent: 0, interpolation: InterpType.Step },
            ],
        })!;
        expect(lut[Math.round((GRADIENT_LUT_SIZE - 1) * 0.9)]).toBeCloseTo(0.25, 5);
        expect(lut[GRADIENT_LUT_SIZE - 1]).toBeCloseTo(1, 5);
    });
});
