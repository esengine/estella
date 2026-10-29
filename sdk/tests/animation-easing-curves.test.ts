// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The engine's easing curves: every named curve starts at 0 and ends at 1, in/out are mirrors, and a few well-known midpoints.
 *
 * The same functions exist in C++ (EasingFunctions.hpp) for tweens the engine runs itself; this pins the TypeScript side, which
 * the JS value tweens and the compatibility layer use.
 */
import { describe, expect, it } from 'vitest';
import { EasingType, applyEasing } from '../src/animation/Easing';

const CURVES: EasingType[] = Object.values(EasingType)
    .filter((v): v is EasingType => typeof v === 'number' && v !== EasingType.CubicBezier && v !== EasingType.Step);

describe('easing curves', () => {
    it('has every curve begin at 0 and end at 1', () => {
        for (const type of CURVES) {
            expect(applyEasing(type, 0), `${EasingType[type]}(0)`).toBeCloseTo(0, 6);
            expect(applyEasing(type, 1), `${EasingType[type]}(1)`).toBeCloseTo(1, 6);
        }
    });

    it('is continuous: no curve jumps between neighbouring samples', () => {
        for (const type of CURVES) {
            let prev = applyEasing(type, 0);
            for (let i = 1; i <= 200; i++) {
                const v = applyEasing(type, i / 200);
                expect(Math.abs(v - prev), `${EasingType[type]} at ${i / 200}`).toBeLessThan(0.35);
                prev = v;
            }
        }
    });

    it('mirrors in and out: out(t) = 1 - in(1 - t), for the symmetric families', () => {
        const pairs: Array<[EasingType, EasingType]> = [
            [EasingType.EaseInSine, EasingType.EaseOutSine], [EasingType.EaseInQuart, EasingType.EaseOutQuart],
            [EasingType.EaseInQuint, EasingType.EaseOutQuint], [EasingType.EaseInExpo, EasingType.EaseOutExpo],
            [EasingType.EaseInCirc, EasingType.EaseOutCirc], [EasingType.EaseInBounce, EasingType.EaseOutBounce],
        ];
        for (const [inn, out] of pairs) {
            for (const t of [0.1, 0.3, 0.5, 0.8]) {
                expect(applyEasing(out, t), `${EasingType[out]}(${t})`).toBeCloseTo(1 - applyEasing(inn, 1 - t), 4);
            }
        }
    });

    it('is half way at half for the symmetric in-out curves', () => {
        for (const type of [EasingType.EaseInOutSine, EasingType.EaseInOutQuart, EasingType.EaseInOutQuint, EasingType.EaseInOutExpo,
            EasingType.EaseInOutCirc, EasingType.EaseInOutBounce, EasingType.Smoothstep, EasingType.Smootherstep]) {
            expect(applyEasing(type, 0.5), EasingType[type]).toBeCloseTo(0.5, 6);
        }
    });

    it('has the well-known values', () => {
        expect(applyEasing(EasingType.EaseOutSine, 0.5)).toBeCloseTo(Math.SQRT1_2, 6);
        expect(applyEasing(EasingType.EaseInQuart, 0.5)).toBeCloseTo(0.0625, 6);
        expect(applyEasing(EasingType.EaseInQuint, 0.5)).toBeCloseTo(0.03125, 6);
        expect(applyEasing(EasingType.EaseOutCirc, 0.5)).toBeCloseTo(Math.sqrt(0.75), 6);
        expect(applyEasing(EasingType.Smoothstep, 0.25)).toBeCloseTo(0.15625, 6);
        expect(applyEasing(EasingType.Smootherstep, 0.25)).toBeCloseTo(0.103515625, 6);
    });

    it('keeps the numbers the curves already had, since scenes and the ABI store them', () => {
        expect(EasingType.Linear).toBe(0);
        expect(EasingType.EaseInQuad).toBe(1);
        expect(EasingType.EaseOutBounce).toBe(13);
        expect(EasingType.CubicBezier).toBe(14);
        expect(EasingType.Step).toBe(15);
    });
});
