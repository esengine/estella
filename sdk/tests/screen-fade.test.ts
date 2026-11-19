// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ScreenFade: the strongest fade is the one drawn, clamped to whole; none is none.
 */
import { describe, it, expect } from 'vitest';
import { strongestFade } from '../src/ui/core/screen-fade';

describe('strongestFade', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 }, white = { r: 1, g: 1, b: 1, a: 1 };
    it('takes the strongest fade with its colour, and none when nothing fades', () => {
        expect(strongestFade([{ amount: 0.2, color: black }, { amount: 0.7, color: white }])).toEqual({ amount: 0.7, color: white });
        expect(strongestFade([{ amount: 0, color: black }])).toBeNull();
        expect(strongestFade([])).toBeNull();
    });
    it('clamps a fade past whole to whole', () => {
        expect(strongestFade([{ amount: 3, color: black }])!.amount).toBe(1);
    });
});
